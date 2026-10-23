import { type AccountSession, authMessage, RecoveryCode } from "@leks/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { LOGIN_MAX_FAILURES, RECOVERY_MAX_FAILURES } from "../src/routes/accounts.js";
import { databaseUrl, DeviceKey, freshDatabase, PASSWORD, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("registration, sign-in and recovery", () => {
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

  const registerAs = (username: string, extra: Record<string, unknown> = {}, key = new DeviceKey()) =>
    app.inject({
      method: "POST",
      url: "/v1/accounts",
      payload: {
        username,
        displayName: "Test",
        password: PASSWORD,
        device: { platform: "android", authPublicKey: key.publicKey },
        ...extra,
      },
    });

  const login = (username: string, password: string, key = new DeviceKey()) =>
    app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { username, password, device: { platform: "ios", authPublicKey: key.publicKey } },
    });

  const recover = (username: string, recoveryCode: string, newPassword = "New-Password-77", key = new DeviceKey()) =>
    app.inject({
      method: "POST",
      url: "/v1/accounts/recover",
      payload: { username, recoveryCode, newPassword, device: { platform: "ios", authPublicKey: key.publicKey } },
    });

  describe("registration", () => {
    it("creates an account with a password and no backup code by default", async () => {
      const response = await registerAs("  Alice ", { displayName: "Алиса" });
      expect(response.statusCode).toBe(201);
      const session = response.json() as AccountSession;
      expect(session.username).toBe("alice");
      expect(session.displayName).toBe("Алиса");
      expect(session.recoveryCode).toBeNull();

      const { rows } = await pool.query<{ password_hash: string; recovery_hash: string | null }>(
        "SELECT password_hash, recovery_hash FROM accounts WHERE username = 'alice'",
      );
      expect(rows[0]!.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(rows[0]!.password_hash).not.toContain(PASSWORD);
      expect(rows[0]!.recovery_hash).toBeNull();
    });

    it("creates a backup code when asked", async () => {
      const { session } = await register(app, "with_code", { createRecoveryCode: true });
      expect(RecoveryCode.safeParse(session.recoveryCode).success).toBe(true);
    });

    it("rejects short, common and username-like passwords", async () => {
      for (const password of ["short7!", "password1", "12345678", "weakname_1"]) {
        const response = await registerAs("weakname_1", { password });
        expect(response.statusCode, password).toBe(400);
        if (password.length >= 8) expect(response.json()).toEqual({ error: "weak_password" });
      }
    });

    it("reports whether a username is free", async () => {
      await registerAs("taken_name");
      const taken = await app.inject({ method: "GET", url: "/v1/usernames/Taken_Name" });
      expect(taken.json()).toEqual({ username: "taken_name", available: false });
      const free = await app.inject({ method: "GET", url: "/v1/usernames/free_name" });
      expect(free.json()).toEqual({ username: "free_name", available: true });
      expect((await app.inject({ method: "GET", url: "/v1/usernames/a" })).statusCode).toBe(400);
    });

    it("rejects a taken username and a reused device key", async () => {
      const key = new DeviceKey();
      expect((await registerAs("bob", {}, key)).statusCode).toBe(201);
      const sameName = await registerAs("BOB");
      expect(sameName.statusCode).toBe(409);
      expect(sameName.json()).toEqual({ error: "username_taken" });
      const sameKey = await registerAs("bob_two", {}, key);
      expect(sameKey.statusCode).toBe(409);
      expect(sameKey.json()).toEqual({ error: "device_key_in_use" });
    });
  });

  describe("sign-in on a new device", () => {
    it("adds a device and keeps the old one signed in", async () => {
      const { session, key } = await register(app, "multi_dev");
      const oldClient = await TestClient.signedIn(app, session, key);

      const newKey = new DeviceKey();
      const response = await login("Multi_Dev", PASSWORD, newKey);
      expect(response.statusCode).toBe(201);
      const second = response.json() as AccountSession;
      expect(second.accountId).toBe(session.accountId);
      expect(second.deviceId).not.toBe(session.deviceId);
      expect(second.recoveryCode).toBeNull();

      (await TestClient.signedIn(app, second, newKey)).close();
      oldClient.send({ type: "ping", nonce: "still-here" });
      expect(await oldClient.next("pong")).toEqual({ type: "pong", nonce: "still-here" });
      oldClient.close();
    });

    it("answers the same for an unknown user and a wrong password", async () => {
      await register(app, "known_user");
      const unknown = await login("nobody_here", PASSWORD);
      const wrong = await login("known_user", "Wrong-Password-1");
      expect(unknown.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.json()).toEqual(wrong.json());
    });

    it("pauses sign-in after repeated wrong passwords, even for the right one", async () => {
      await register(app, "guessed_at");
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
        expect((await login("guessed_at", `Wrong-Guess-${i}`)).statusCode).toBe(401);
      }
      const locked = await login("guessed_at", PASSWORD);
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toEqual({ error: "login_locked" });

      await pool.query("UPDATE accounts SET login_locked_until = now() - interval '1 second' WHERE username = 'guessed_at'");
      expect((await login("guessed_at", PASSWORD)).statusCode).toBe(201);
    });
  });

  describe("recovery with the backup code", () => {
    it("sets a new password, signs out old devices and uses up the code", async () => {
      const { session, key } = await register(app, "carol", { createRecoveryCode: true });
      const oldClient = await TestClient.signedIn(app, session, key);

      const newKey = new DeviceKey();
      const response = await recover("Carol", session.recoveryCode!.toLowerCase(), "Fresh-Start-2026", newKey);
      expect(response.statusCode).toBe(200);
      const recovered = response.json() as AccountSession;
      expect(recovered.accountId).toBe(session.accountId);
      expect(recovered.deviceId).not.toBe(session.deviceId);

      // The old device is disconnected and can no longer sign in.
      expect(await oldClient.closed).toBe(4002);
      const retry = await TestClient.open(app);
      const challenge = await retry.hello();
      retry.send({ type: "auth", deviceId: session.deviceId, signature: key.sign(authMessage(challenge)) });
      expect(await retry.next("error")).toEqual({ type: "error", code: "auth_failed" });

      // The new password works, the old one does not, and the code is used up.
      expect((await login("carol", "Fresh-Start-2026")).statusCode).toBe(201);
      expect((await login("carol", PASSWORD)).statusCode).toBe(401);
      expect((await recover("carol", session.recoveryCode!)).statusCode).toBe(401);
      (await TestClient.signedIn(app, recovered, newKey)).close();
    });

    it("is impossible without a backup code, and answers like a wrong code", async () => {
      await register(app, "no_code");
      const { session } = await register(app, "has_code", { createRecoveryCode: true });
      const noCode = await recover("no_code", "AAAA-AAAA-AAAA-AAAA-AAAA");
      const unknown = await recover("nobody_at_all", "AAAA-AAAA-AAAA-AAAA-AAAA");
      const wrong = await recover("has_code", "AAAA-AAAA-AAAA-AAAA-AAAA");
      for (const response of [noCode, unknown, wrong]) {
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "recovery_failed" });
      }
      expect(session.recoveryCode).not.toBe("AAAA-AAAA-AAAA-AAAA-AAAA");
    });

    it("pauses recovery after repeated wrong codes", async () => {
      const { session } = await register(app, "erin", { createRecoveryCode: true });
      for (let i = 0; i < RECOVERY_MAX_FAILURES; i++) {
        expect((await recover("erin", "BBBB-BBBB-BBBB-BBBB-BBBB")).statusCode).toBe(401);
      }
      const locked = await recover("erin", session.recoveryCode!);
      expect(locked.statusCode).toBe(429);
      expect(locked.json()).toEqual({ error: "recovery_locked" });
    });

    it("rejects a weak new password", async () => {
      const { session } = await register(app, "weak_new", { createRecoveryCode: true });
      const response = await recover("weak_new", session.recoveryCode!, "qwerty123");
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "weak_password" });
    });
  });

  describe("settings over the WebSocket", () => {
    it("creates, replaces and deletes the backup code", async () => {
      const { session, key } = await register(app, "settings_user");
      const client = await TestClient.signedIn(app, session, key);

      client.send({ type: "create_recovery_code", requestId: "c1" });
      const first = await client.next("recovery_code");
      expect(RecoveryCode.safeParse(first.recoveryCode).success).toBe(true);
      client.send({ type: "create_recovery_code", requestId: "c2" });
      const second = await client.next("recovery_code");
      expect(second.recoveryCode).not.toBe(first.recoveryCode);

      // Only the newest code works.
      expect((await recover("settings_user", first.recoveryCode)).statusCode).toBe(401);

      client.send({ type: "delete_recovery_code", requestId: "d1" });
      await client.next("recovery_code_deleted");
      expect((await recover("settings_user", second.recoveryCode)).statusCode).toBe(401);
      client.close();
    });

    it("changes the password only with the current one", async () => {
      const { session, key } = await register(app, "changer");
      const client = await TestClient.signedIn(app, session, key);

      client.send({ type: "change_password", requestId: "p1", currentPassword: "Not-My-Password", newPassword: "Brand-New-Pass-9" });
      expect(await client.next("error")).toEqual({ type: "error", code: "wrong_password", requestId: "p1" });

      client.send({ type: "change_password", requestId: "p2", currentPassword: PASSWORD, newPassword: "password123" });
      expect(await client.next("error")).toEqual({ type: "error", code: "weak_password", requestId: "p2" });

      client.send({ type: "change_password", requestId: "p3", currentPassword: PASSWORD, newPassword: "Brand-New-Pass-9" });
      expect(await client.next("password_changed")).toEqual({ type: "password_changed", requestId: "p3" });
      client.close();

      expect((await login("changer", PASSWORD)).statusCode).toBe(401);
      expect((await login("changer", "Brand-New-Pass-9")).statusCode).toBe(201);
    });
  });
});
