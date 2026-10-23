import { authMessage, type AccountSession, RecoveryCode } from "@leks/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { RECOVERY_MAX_FAILURES } from "../src/routes/accounts.js";
import { databaseUrl, DeviceKey, freshDatabase, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("registration and recovery", () => {
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

  const registerAs = (username: string, key = new DeviceKey(), displayName = "Test") =>
    app.inject({
      method: "POST",
      url: "/v1/accounts",
      payload: { username, displayName, device: { platform: "android", authPublicKey: key.publicKey } },
    });

  const recover = (username: string, recoveryCode: string, key = new DeviceKey()) =>
    app.inject({
      method: "POST",
      url: "/v1/accounts/recover",
      payload: { username, recoveryCode, device: { platform: "ios", authPublicKey: key.publicKey } },
    });

  it("registers with a username only and returns a recovery code once", async () => {
    const response = await registerAs("  Alice ", new DeviceKey(), "Алиса");
    expect(response.statusCode).toBe(201);
    const session = response.json() as AccountSession;
    expect(session.username).toBe("alice");
    expect(session.displayName).toBe("Алиса");
    expect(RecoveryCode.safeParse(session.recoveryCode).success).toBe(true);

    const { rows } = await pool.query<{ recovery_hash: string }>("SELECT recovery_hash FROM accounts WHERE username = 'alice'");
    expect(rows[0]!.recovery_hash.startsWith("scrypt$")).toBe(true);
    expect(rows[0]!.recovery_hash).not.toContain(session.recoveryCode);
  });

  it("reports whether a username is free", async () => {
    await registerAs("taken_name");
    const taken = await app.inject({ method: "GET", url: "/v1/usernames/Taken_Name" });
    expect(taken.json()).toEqual({ username: "taken_name", available: false });
    const free = await app.inject({ method: "GET", url: "/v1/usernames/free_name" });
    expect(free.json()).toEqual({ username: "free_name", available: true });
    const bad = await app.inject({ method: "GET", url: "/v1/usernames/a" });
    expect(bad.statusCode).toBe(400);
  });

  it("rejects a taken username and a reused device key", async () => {
    const key = new DeviceKey();
    expect((await registerAs("bob", key)).statusCode).toBe(201);
    const sameName = await registerAs("BOB");
    expect(sameName.statusCode).toBe(409);
    expect(sameName.json()).toEqual({ error: "username_taken" });
    const sameKey = await registerAs("bob_two", key);
    expect(sameKey.statusCode).toBe(409);
    expect(sameKey.json()).toEqual({ error: "device_key_in_use" });
  });

  it("rejects invalid requests", async () => {
    for (const payload of [
      {},
      { username: "ok_name", displayName: "", device: { platform: "ios", authPublicKey: new DeviceKey().publicKey } },
      { username: "ok_name", displayName: "X", device: { platform: "windows", authPublicKey: new DeviceKey().publicKey } },
      { username: "ok_name", displayName: "X", device: { platform: "ios", authPublicKey: "short" } },
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/accounts", payload });
      expect(response.statusCode).toBe(400);
    }
  });

  it("recovers an account onto a new device and signs out the old one", async () => {
    const { session, key } = await register(app, "carol");
    const oldClient = await TestClient.signedIn(app, session, key);

    const newKey = new DeviceKey();
    const response = await recover("Carol", session.recoveryCode.toLowerCase(), newKey);
    expect(response.statusCode).toBe(200);
    const recovered = response.json() as AccountSession;
    expect(recovered.accountId).toBe(session.accountId);
    expect(recovered.deviceId).not.toBe(session.deviceId);
    expect(recovered.recoveryCode).not.toBe(session.recoveryCode);

    // The old device is disconnected and can no longer sign in.
    expect(await oldClient.closed).toBe(4002);
    const retry = await TestClient.open(app);
    const challenge = await retry.hello();
    retry.send({ type: "auth", deviceId: session.deviceId, signature: key.sign(authMessage(challenge)) });
    expect(await retry.next("error")).toEqual({ type: "error", code: "auth_failed" });

    // The new device signs in; the old code is used up, the new one works.
    (await TestClient.signedIn(app, recovered, newKey)).close();
    expect((await recover("carol", session.recoveryCode)).statusCode).toBe(401);
    expect((await recover("carol", recovered.recoveryCode)).statusCode).toBe(200);
  });

  it("answers the same for an unknown user and a wrong code", async () => {
    const unknown = await recover("nobody_here", "AAAA-AAAA-AAAA-AAAA-AAAA");
    const { session } = await register(app, "dave");
    const wrong = await recover("dave", "AAAA-AAAA-AAAA-AAAA-AAAA");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(session.recoveryCode).not.toBe("AAAA-AAAA-AAAA-AAAA-AAAA");
  });

  it("locks recovery after repeated wrong codes, even for the right code", async () => {
    const { session } = await register(app, "erin");
    for (let i = 0; i < RECOVERY_MAX_FAILURES; i++) {
      expect((await recover("erin", "BBBB-BBBB-BBBB-BBBB-BBBB")).statusCode).toBe(401);
    }
    const locked = await recover("erin", session.recoveryCode);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: "recovery_locked" });
  });
});
