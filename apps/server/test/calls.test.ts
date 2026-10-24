import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { CALL_TOKEN_SECONDS, callToken } from "../src/calls.js";
import { databaseUrl, freshDatabase, register, TestClient } from "./helpers.js";

const config = { url: "wss://calls.example.org", apiKey: "APIkey123", apiSecret: "s".repeat(40) };

function decode(token: string) {
  const [header, claims, signature] = token.split(".");
  const expected = createHmac("sha256", config.apiSecret).update(`${header}.${claims}`).digest("base64url");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    claims: JSON.parse(Buffer.from(claims!, "base64url").toString()),
    valid: signature === expected,
  };
}

describe("call passes", () => {
  it("are signed tokens for one room and one device, valid for a short time", () => {
    const room = randomUUID();
    const { header, claims, valid } = decode(callToken(config, room, "device-1", 1_700_000_000_000));
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(claims).toMatchObject({ iss: "APIkey123", sub: "device-1", video: { room, roomJoin: true, canPublish: true, canSubscribe: true } });
    expect(claims.exp - claims.iat).toBe(CALL_TOKEN_SECONDS);
    expect(claims.video.roomAdmin).toBeUndefined();
  });
});

describe.skipIf(!databaseUrl)("call passes over the WebSocket", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let withCalls: Awaited<ReturnType<typeof buildApp>>;
  let withoutCalls: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pool = await freshDatabase();
    withCalls = await buildApp({ pool, purgeIntervalMs: 0, calls: config });
    withoutCalls = await buildApp({ pool, purgeIntervalMs: 0 });
    await withCalls.ready();
    await withoutCalls.ready();
  });

  afterAll(async () => {
    await withCalls?.close();
    await withoutCalls?.close();
    await pool?.end();
  });

  it("are given to signed-in devices", async () => {
    const { session, key } = await register(withCalls);
    const client = await TestClient.signedIn(withCalls, session, key);
    const room = randomUUID();
    client.send({ type: "call_token", requestId: "c", room });
    const answer = await client.next("call_token");
    expect(answer.url).toBe(config.url);
    expect(decode(answer.token).claims).toMatchObject({ sub: session.deviceId, video: { room } });
    client.close();
  });

  it("are refused when calls are not set up, and need a proper room id", async () => {
    const { session, key } = await register(withoutCalls);
    const client = await TestClient.signedIn(withoutCalls, session, key);
    client.send({ type: "call_token", requestId: "c", room: randomUUID() });
    expect(await client.next("error")).toEqual({ type: "error", code: "calls_unavailable", requestId: "c" });
    client.send({ type: "call_token", requestId: "d", room: "../admin" });
    expect(await client.next("error")).toMatchObject({ code: "bad_frame" });
    client.close();
  });
});
