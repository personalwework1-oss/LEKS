import {
  type AccountSession,
  type HttpErrorCode,
  RecoverRequest,
  RegisterRequest,
  Username,
} from "@leks/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Hub } from "../hub.js";
import { hashRecoveryCode, newRecoveryCode, verifyRecoveryCode } from "../security.js";
import { ConflictError, type Store } from "../store.js";

/** Wrong recovery codes allowed in a row before recovery is locked. */
export const RECOVERY_MAX_FAILURES = 5;
export const RECOVERY_LOCK_MINUTES = 60;

function fail(reply: FastifyReply, status: number, error: HttpErrorCode) {
  return reply.code(status).send({ error });
}

export function accountRoutes(app: FastifyInstance, store: Store, hub: Hub) {
  app.get<{ Params: { username: string } }>("/v1/usernames/:username", async (request, reply) => {
    const parsed = Username.safeParse(request.params.username);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    return { username: parsed.data, available: !(await store.usernameTaken(parsed.data)) };
  });

  app.post("/v1/accounts", async (request, reply) => {
    const parsed = RegisterRequest.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { username, displayName, device } = parsed.data;

    const recoveryCode = newRecoveryCode();
    try {
      const { accountId, deviceId } = await store.createAccount({
        username,
        displayName,
        recoveryHash: await hashRecoveryCode(recoveryCode),
        device: { platform: device.platform, authPublicKey: Buffer.from(device.authPublicKey, "base64url") },
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

  app.post("/v1/accounts/recover", async (request, reply) => {
    const parsed = RecoverRequest.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "invalid_request");
    const { username, recoveryCode, device } = parsed.data;

    const account = await store.accountForRecovery(username);
    if (!account) {
      // Same work and answer as a wrong code, so usernames cannot be probed here.
      await hashRecoveryCode(recoveryCode);
      return fail(reply, 401, "recovery_failed");
    }
    if (account.lockedUntil && account.lockedUntil > new Date()) return fail(reply, 429, "recovery_locked");

    if (!(await verifyRecoveryCode(recoveryCode, account.recoveryHash))) {
      await store.recordRecoveryFailure(account.id, RECOVERY_MAX_FAILURES, RECOVERY_LOCK_MINUTES);
      return fail(reply, 401, "recovery_failed");
    }

    const newCode = newRecoveryCode();
    try {
      const { deviceId, removed } = await store.replaceDevices(
        account.id,
        { platform: device.platform, authPublicKey: Buffer.from(device.authPublicKey, "base64url") },
        await hashRecoveryCode(newCode),
      );
      hub.disconnectDevices(removed);
      const session: AccountSession = {
        accountId: account.id,
        deviceId,
        username,
        displayName: account.displayName,
        recoveryCode: newCode,
      };
      return session;
    } catch (error) {
      if (error instanceof ConflictError) return fail(reply, 409, "device_key_in_use");
      throw error;
    }
  });
}
