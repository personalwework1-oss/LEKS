import {
  type AccountSession,
  type HttpErrorCode,
  LoginRequest,
  passwordProblem,
  RecoverRequest,
  RegisterRequest,
  Username,
} from "@leks/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Hub } from "../hub.js";
import {
  burnPasswordCheck,
  hashPassword,
  hashRecoveryCode,
  newRecoveryCode,
  verifyPassword,
  verifyRecoveryCode,
} from "../security.js";
import { ConflictError, type Store } from "../store.js";

/** Wrong passwords allowed in a row before sign-in on new devices pauses. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
/** Wrong backup codes allowed in a row before recovery pauses. */
export const RECOVERY_MAX_FAILURES = 5;
export const RECOVERY_LOCK_MINUTES = 60;

function fail(reply: FastifyReply, status: number, error: HttpErrorCode) {
  return reply.code(status).send({ error });
}

const deviceRecord = (device: { platform: "ios" | "android"; authPublicKey: string }) => ({
  platform: device.platform,
  authPublicKey: Buffer.from(device.authPublicKey, "base64url"),
});

export function accountRoutes(app: FastifyInstance, store: Store, hub: Hub) {
  app.get<{ Params: { username: string } }>("/v1/usernames/:username", async (request, reply) => {
    const parsed = Username.safeParse(request.params.username);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return { username: parsed.data, available: !(await store.usernameTaken(parsed.data)) };
  });

  /** Creates an account with its first device. */
  app.post("/v1/accounts", async (request, reply) => {
    const parsed = RegisterRequest.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { username, displayName, password, createRecoveryCode, device } = parsed.data;
    if (passwordProblem(password, username)) return fail(reply, 400, "weak_password");

    const recoveryCode = createRecoveryCode ? newRecoveryCode() : null;
    try {
      const { accountId, deviceId } = await store.createAccount({
        username,
        displayName,
        passwordHash: await hashPassword(password),
        recoveryHash: recoveryCode ? await hashRecoveryCode(recoveryCode) : null,
        device: deviceRecord(device),
      });
      const session: AccountSession = { accountId, deviceId, username, displayName, recoveryCode };
      return reply.code(201).send(session);
    } catch (error) {
      if (error instanceof ConflictError) {
        return fail(reply, 409, error.field === "username" ? "username_taken" : "device_key_in_use");
      }
      throw error;
    }
  });

  /** Signs in on an additional device with the password. */
  app.post("/v1/sessions", async (request, reply) => {
    const parsed = LoginRequest.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { username, password, device } = parsed.data;

    const account = await store.credentials({ username });
    if (!account) {
      // Same work and answer as a wrong password, so usernames cannot be probed here.
      await burnPasswordCheck(password);
      return fail(reply, 401, "login_failed");
    }
    if (account.loginLockedUntil && account.loginLockedUntil > new Date()) return fail(reply, 429, "login_locked");
    if (!(await verifyPassword(password, account.passwordHash))) {
      await store.recordFailure("login", account.id, LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES);
      return fail(reply, 401, "login_failed");
    }

    try {
      const deviceId = await store.addDevice(account.id, deviceRecord(device));
      await store.clearLoginFailures(account.id);
      const session: AccountSession = {
        accountId: account.id,
        deviceId,
        username: account.username,
        displayName: account.displayName,
        recoveryCode: null,
      };
      return reply.code(201).send(session);
    } catch (error) {
      if (error instanceof ConflictError) return fail(reply, 409, "device_key_in_use");
      throw error;
    }
  });

  /** Forgotten password: the backup code sets a new one and signs out every old device. */
  app.post("/v1/accounts/recover", async (request, reply) => {
    const parsed = RecoverRequest.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { username, recoveryCode, newPassword, device } = parsed.data;
    if (passwordProblem(newPassword, username)) return fail(reply, 400, "weak_password");

    const account = await store.credentials({ username });
    if (!account || !account.recoveryHash) {
      // Same work and answer as a wrong code: no hint whether the user or a code exists.
      await hashRecoveryCode(recoveryCode);
      return fail(reply, 401, "recovery_failed");
    }
    if (account.recoveryLockedUntil && account.recoveryLockedUntil > new Date()) {
      return fail(reply, 429, "recovery_locked");
    }
    if (!(await verifyRecoveryCode(recoveryCode, account.recoveryHash))) {
      await store.recordFailure("recovery", account.id, RECOVERY_MAX_FAILURES, RECOVERY_LOCK_MINUTES);
      return fail(reply, 401, "recovery_failed");
    }

    try {
      const { deviceId, removed } = await store.recoverAccount(
        account.id,
        deviceRecord(device),
        await hashPassword(newPassword),
      );
      hub.disconnectDevices(removed);
      const session: AccountSession = {
        accountId: account.id,
        deviceId,
        username: account.username,
        displayName: account.displayName,
        recoveryCode: null,
      };
      return session;
    } catch (error) {
      if (error instanceof ConflictError) return fail(reply, 409, "device_key_in_use");
      throw error;
    }
  });
}
