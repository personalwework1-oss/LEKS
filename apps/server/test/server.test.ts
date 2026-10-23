import { PROTOCOL_VERSION, type ServerFrame } from "@leks/protocol";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, migrate } from "../src/db.js";
import { databaseUrl, freshDatabase } from "./helpers.js";

/** Resolves with the next frame the server sends. */
function nextFrame(ws: WebSocket): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString()) as ServerFrame));
    ws.once("error", reject);
  });
}

function hello(protocol = PROTOCOL_VERSION) {
  return JSON.stringify({ type: "hello", protocol, client: { platform: "test", version: "0.0.0" } });
}

describe("config", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("applies defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/leks" });
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
  });
});

describe("health without a database", () => {
  it("reports degraded instead of crashing", async () => {
    const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none");
    const app = await buildApp({ pool });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", database: "unavailable" });
    await app.close();
    await pool.end();
  });
});

describe.skipIf(!databaseUrl)("server with PostgreSQL", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = await freshDatabase();
    app = await buildApp({ pool });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("migrations are applied once and can be re-run safely", async () => {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(rows.map((row) => row.name)).toContain("001_accounts_and_devices.sql");
    expect(await migrate(pool)).toEqual([]);
  });

  it("database rejects invalid usernames", async () => {
    await expect(
      pool.query("INSERT INTO accounts (username, display_name) VALUES ('Bad Name!', 'x')"),
    ).rejects.toThrow();
    await pool.query("INSERT INTO accounts (username, display_name) VALUES ('alice_1', 'Alice')");
    await expect(
      pool.query("INSERT INTO accounts (username, display_name) VALUES ('alice_1', 'Other')"),
    ).rejects.toThrow();
  });

  it("GET /health reports ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok", protocol: PROTOCOL_VERSION });
  });

  it("WebSocket: hello, then ping and pong", async () => {
    const ws = await app.injectWS("/v1/ws");
    ws.send(hello());
    const welcome = await nextFrame(ws);
    expect(welcome).toMatchObject({ type: "welcome", protocol: PROTOCOL_VERSION });

    ws.send(JSON.stringify({ type: "ping", nonce: "n1" }));
    expect(await nextFrame(ws)).toEqual({ type: "pong", nonce: "n1" });
    ws.terminate();
  });

  it("WebSocket: requires hello first", async () => {
    const ws = await app.injectWS("/v1/ws");
    ws.send(JSON.stringify({ type: "ping", nonce: "n1" }));
    expect(await nextFrame(ws)).toEqual({ type: "error", code: "hello_required" });
    ws.terminate();
  });

  it("WebSocket: rejects malformed input without disconnecting", async () => {
    const ws = await app.injectWS("/v1/ws");
    ws.send("{not json");
    expect(await nextFrame(ws)).toEqual({ type: "error", code: "bad_json" });
    ws.send(JSON.stringify({ type: "unknown" }));
    expect(await nextFrame(ws)).toEqual({ type: "error", code: "bad_frame" });
    ws.send(hello());
    expect((await nextFrame(ws)).type).toBe("welcome");
    ws.terminate();
  });

  it("WebSocket: closes on an unsupported protocol version", async () => {
    const ws = await app.injectWS("/v1/ws");
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(hello(PROTOCOL_VERSION + 1));
    expect(await nextFrame(ws)).toEqual({ type: "error", code: "unsupported_protocol" });
    expect(await closed).toBe(4000);
  });
});
