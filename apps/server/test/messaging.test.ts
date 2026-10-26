import { randomUUID } from "node:crypto";
import { authMessage, MAX_KEY_PACKAGES } from "@leks/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { databaseUrl, DeviceKey, freshDatabase, randomPayload, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("device sign-in, keys and message delivery", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const pushed: string[] = [];

  beforeAll(async () => {
    pool = await freshDatabase();
    app = await buildApp({
      pool,
      purgeIntervalMs: 0,
      push: { notify: async (deviceId, reason) => void pushed.push(deviceId, `${reason}:${deviceId}`) },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("signs in only with the device's own key", async () => {
    const { session, key } = await register(app);

    const wrongKey = await TestClient.open(app);
    const challenge = await wrongKey.hello();
    wrongKey.send({ type: "auth", deviceId: session.deviceId, signature: new DeviceKey().sign(authMessage(challenge)) });
    expect(await wrongKey.next("error")).toEqual({ type: "error", code: "auth_failed" });
    expect(await wrongKey.closed).toBe(4001);

    // A signature over an old challenge is useless on a new connection.
    const replay = await TestClient.open(app);
    await replay.hello();
    replay.send({ type: "auth", deviceId: session.deviceId, signature: key.sign(authMessage(challenge)) });
    expect(await replay.next("error")).toEqual({ type: "error", code: "auth_failed" });

    const ok = await TestClient.signedIn(app, session, key);
    ok.close();
  });

  it("requires sign-in before anything else", async () => {
    const client = await TestClient.open(app);
    client.send({ type: "lookup_user", requestId: "r1", username: "alice" });
    expect(await client.next("error")).toEqual({ type: "error", code: "hello_required", requestId: "r1" });
    await client.hello();
    client.send({ type: "lookup_user", requestId: "r2", username: "alice" });
    expect(await client.next("error")).toEqual({ type: "error", code: "auth_required", requestId: "r2" });
    client.close();
  });

  it("finds users by username", async () => {
    const alice = await register(app, "find_me");
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);

    client.send({ type: "lookup_user", requestId: "r1", username: "Find_Me" });
    expect(await client.next("user")).toEqual({
      type: "user",
      requestId: "r1",
      user: { accountId: alice.session.accountId, username: "find_me", displayName: "find_me" },
    });
    client.send({ type: "lookup_user", requestId: "r2", username: "no_such_user" });
    expect(await client.next("user")).toEqual({ type: "user", requestId: "r2", user: null });
    client.close();
  });

  it("hands out each key package exactly once", async () => {
    const bob = await register(app);
    const alice = await register(app);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);

    const packages = [randomPayload(300), randomPayload(301)];
    bobClient.send({ type: "publish_key_packages", requestId: "p1", keyPackages: packages });
    expect(await bobClient.next("key_packages_published")).toEqual({ type: "key_packages_published", requestId: "p1", available: 2 });

    for (const expected of [packages[0], packages[1]]) {
      aliceClient.send({ type: "claim_key_packages", requestId: "c", accountId: bob.session.accountId });
      const claimed = await aliceClient.next("key_packages");
      expect(claimed.items).toEqual([{ deviceId: bob.session.deviceId, keyPackage: expected }]);
    }
    aliceClient.send({ type: "claim_key_packages", requestId: "c3", accountId: bob.session.accountId });
    expect((await aliceClient.next("key_packages")).items).toEqual([]);

    bobClient.close();
    aliceClient.close();
  });

  it("limits how many key packages a device keeps", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    const batch = Array.from({ length: MAX_KEY_PACKAGES }, (_, i) => randomPayload(32 + (i % 5)));
    client.send({ type: "publish_key_packages", requestId: "a", keyPackages: batch });
    expect((await client.next("key_packages_published")).available).toBe(MAX_KEY_PACKAGES);
    client.send({ type: "publish_key_packages", requestId: "b", keyPackages: [randomPayload()] });
    expect(await client.next("error")).toEqual({ type: "error", code: "too_many_key_packages", requestId: "b" });
    client.close();
  });

  it("queues messages for an offline device and delivers them in order on sign-in", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);

    const first = { id: randomUUID(), payload: randomPayload(100) };
    const second = { id: randomUUID(), payload: randomPayload(200) };
    for (const message of [first, second]) {
      aliceClient.send({ type: "send", id: message.id, recipients: [bob.session.deviceId], kind: "message", payload: message.payload, wake: "message" });
      expect(await aliceClient.next("sent")).toEqual({
        type: "sent",
        id: message.id,
        accepted: [bob.session.deviceId],
        unknown: [],
      });
    }
    expect(pushed).toContain(bob.session.deviceId);

    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    const delivered = await bobClient.next("deliver");
    expect(delivered.messages.map((message) => message.payload)).toEqual([first.payload, second.payload]);
    expect(delivered.messages[0]!.from).toEqual({ accountId: alice.session.accountId, deviceId: alice.session.deviceId });
    expect(delivered.messages[0]!.kind).toBe("message");

    // Until acknowledged, messages are delivered again after reconnecting.
    bobClient.close();
    const bobAgain = await TestClient.signedIn(app, bob.session, bob.key);
    const redelivered = await bobAgain.next("deliver");
    expect(redelivered.messages.map((message) => message.id)).toEqual(delivered.messages.map((message) => message.id));

    // After the ack the server forgets them.
    bobAgain.send({ type: "ack", ids: redelivered.messages.map((message) => message.id) });
    bobAgain.send({ type: "ping", nonce: "sync" });
    await bobAgain.next("pong");
    const { rows } = await pool.query("SELECT 1 FROM message_queue WHERE recipient_device_id = $1", [bob.session.deviceId]);
    expect(rows).toHaveLength(0);
    bobAgain.close();

    const bobThird = await TestClient.signedIn(app, bob.session, bob.key);
    expect(await bobThird.receives("deliver")).toBe(false);
    bobThird.close();
    aliceClient.close();
  });

  it("wakes offline devices only when the sender asks, and says whether it is a call", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    for (const [wake, id] of [[undefined, randomUUID()], ["call", randomUUID()]] as const) {
      aliceClient.send({ type: "send", id, recipients: [bob.session.deviceId], kind: "message", payload: randomPayload(), ...(wake ? { wake } : {}) });
      await aliceClient.next("sent");
    }
    // A receipt or a reaction (no wake) never pushes; a call does.
    expect(pushed.filter((entry) => entry === `message:${bob.session.deviceId}`)).toHaveLength(0);
    expect(pushed).toContain(`call:${bob.session.deviceId}`);
    aliceClient.close();
  });

  it("does not wake a phone for a chat its owner muted, but still rings for calls", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    const chat = "0123456789abcdef0123456789abcdef";
    bobClient.send({ type: "mute_chat", requestId: "m", chat, until: Date.now() + 3600_000 });
    await bobClient.next("chat_muted");
    bobClient.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const wake of ["message", "call"] as const) {
      aliceClient.send({ type: "send", id: randomUUID(), recipients: [bob.session.deviceId], kind: "message", payload: randomPayload(), wake, chat });
      await aliceClient.next("sent");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pushed).not.toContain(`message:${bob.session.deviceId}`);
    expect(pushed).toContain(`call:${bob.session.deviceId}`);
    aliceClient.close();
  });

  it("delivers immediately to an online device, once per message id", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);

    const id = randomUUID();
    const frame = { type: "send", id, recipients: [bob.session.deviceId], kind: "welcome", payload: randomPayload() } as const;
    aliceClient.send(frame);
    await aliceClient.next("sent");
    const delivered = await bobClient.next("deliver");
    expect(delivered.messages).toHaveLength(1);
    expect(delivered.messages[0]!.kind).toBe("welcome");

    // A retry with the same id is accepted but not delivered twice.
    aliceClient.send(frame);
    await aliceClient.next("sent");
    expect(await bobClient.receives("deliver")).toBe(false);

    aliceClient.close();
    bobClient.close();
  });

  it("reports unknown recipients and ignores acks for other devices", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const ghost = randomUUID();

    aliceClient.send({ type: "send", id: randomUUID(), recipients: [bob.session.deviceId, ghost], kind: "message", payload: randomPayload() });
    expect(await aliceClient.next("sent")).toMatchObject({ accepted: [bob.session.deviceId], unknown: [ghost] });

    const { rows } = await pool.query<{ id: string }>("SELECT id FROM message_queue WHERE recipient_device_id = $1", [
      bob.session.deviceId,
    ]);
    aliceClient.send({ type: "ack", ids: rows.map((row) => Number(row.id)) });
    aliceClient.send({ type: "ping", nonce: "sync" });
    await aliceClient.next("pong");
    const after = await pool.query("SELECT 1 FROM message_queue WHERE recipient_device_id = $1", [bob.session.deviceId]);
    expect(after.rows).toHaveLength(1);
    aliceClient.close();
  });

  it("stores a push token per device", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    client.send({ type: "register_push", requestId: "p", provider: "apns", token: "token-1" });
    await client.next("push_registered");
    client.send({ type: "register_push", requestId: "p2", provider: "apns", token: "token-2" });
    await client.next("push_registered");
    expect(await app.store.pushToken(session.deviceId)).toEqual({ provider: "apns", token: "token-2" });
    client.close();
  });

  it("deletes undelivered messages after the retention period", async () => {
    const alice = await register(app);
    const bob = await register(app);
    const client = await TestClient.signedIn(app, alice.session, alice.key);
    client.send({ type: "send", id: randomUUID(), recipients: [bob.session.deviceId], kind: "message", payload: randomPayload() });
    await client.next("sent");
    client.close();

    await pool.query("UPDATE message_queue SET created_at = now() - interval '31 days' WHERE recipient_device_id = $1", [
      bob.session.deviceId,
    ]);
    expect(await app.store.purgeExpired(30)).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query("SELECT 1 FROM message_queue WHERE recipient_device_id = $1", [bob.session.deviceId]);
    expect(rows).toHaveLength(0);
  });
});
