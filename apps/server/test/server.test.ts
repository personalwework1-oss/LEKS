import { readFile } from "node:fs/promises";
import { authMessage, PROTOCOL_VERSION } from "@leks/protocol";
import { verifyEd25519 } from "../src/security.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
import { databaseUrl, freshDatabase, TestClient } from "./helpers.js";

describe("config", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("applies defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/leks" });
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
    // An empty value from docker compose means "not set".
    expect(loadConfig({ DATABASE_URL: "postgres://localhost/leks", FCM_SERVICE_ACCOUNT: "" }).FCM_SERVICE_ACCOUNT).toBeUndefined();
  });
});

describe("device sign-in signatures", () => {
  it("accepts the signature the Rust core produces for the shared vector", async () => {
    const vector = JSON.parse(
      await readFile(new URL("../../../fixtures/auth-vector.json", import.meta.url), "utf8"),
    ) as Record<string, string>;
    const hex = (name: string) => Buffer.from(vector[name]!, "hex");
    const message = authMessage(hex("challengeHex"));
    expect(verifyEd25519(hex("publicKeyHex"), message, hex("signatureHex"))).toBe(true);

    const tampered = hex("signatureHex");
    tampered[0] = tampered[0]! ^ 1;
    expect(verifyEd25519(hex("publicKeyHex"), message, tampered)).toBe(false);
    expect(verifyEd25519(hex("publicKeyHex").subarray(1), message, hex("signatureHex"))).toBe(false);
  });
});

describe("health without a database", () => {
  it("reports degraded instead of crashing", async () => {
    const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
    const app = await buildApp({ pool, purgeIntervalMs: 0 });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", database: "unavailable" });
    await app.close();
    await pool.end();
  });
});

describe.skipIf(!databaseUrl)("server basics", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pool = await freshDatabase();
    app = await buildApp({ pool, purgeIntervalMs: 0 });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("applies migrations once and can re-run them safely", async () => {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((row) => row.name)).toEqual([
      "001_accounts_and_devices.sql",
      "002_auth_keys_and_delivery.sql",
      "003_passwords.sql",
      "004_blobs.sql",
    ]);
    expect(await migrate(pool)).toEqual([]);
  });

  it("GET /health reports ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok", protocol: PROTOCOL_VERSION, push: "off", calls: "off" });
  });

  it("WebSocket: hello returns a fresh 32-byte challenge each time", async () => {
    const client = await TestClient.open(app);
    const first = await client.hello();
    const second = await client.hello();
    expect(first.length).toBe(32);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    client.send({ type: "ping", nonce: "n1" });
    expect(await client.next("pong")).toEqual({ type: "pong", nonce: "n1" });
    client.close();
  });

  it("WebSocket: rejects malformed input without disconnecting", async () => {
    const client = await TestClient.open(app);
    client.sendRaw("{not json");
    expect(await client.next("error")).toEqual({ type: "error", code: "bad_json" });
    client.send({ type: "unknown", requestId: "r1" });
    expect(await client.next("error")).toEqual({ type: "error", code: "bad_frame", requestId: "r1" });
    expect((await client.hello()).length).toBe(32);
    client.close();
  });

  it("WebSocket: closes on an unsupported protocol version", async () => {
    const client = await TestClient.open(app);
    client.send({ type: "hello", protocol: PROTOCOL_VERSION + 1, client: { platform: "test", version: "0" } });
    expect(await client.next("error")).toEqual({ type: "error", code: "unsupported_protocol" });
    expect(await client.closed).toBe(4000);
  });

  it("WebSocket: limits how fast a connection may send", async () => {
    const client = await TestClient.open(app);
    for (let i = 0; i < 160; i++) client.send({ type: "ping", nonce: `n${i}` });
    expect(await client.next("error")).toEqual({ type: "error", code: "rate_limited" });
    client.close();
  });
});
