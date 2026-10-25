import { randomBytes, randomUUID } from "node:crypto";
import {
  authMessage,
  ClientFrame,
  CloseCode,
  DAILY_UPLOAD_BYTES,
  type ErrorCode,
  passwordProblem,
  PROTOCOL_VERSION,
  type ServerFrame,
} from "@leks/protocol";
import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import type { DeviceConnection, Hub, PushNotifier } from "../hub.js";
import {
  hashPassword,
  hashRecoveryCode,
  newRecoveryCode,
  randomChallenge,
  verifyEd25519,
  verifyPassword,
} from "../security.js";
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES } from "./accounts.js";
import { LimitError, type Store } from "../store.js";
import { hashUploadToken } from "./blobs.js";
import { type CallConfig, callToken } from "../calls.js";

/** Frames a connection may send: a burst of 100, refilled at 50 per second. */
const RATE_BURST = 100;
const RATE_PER_SECOND = 50;

type State =
  | { phase: "new" }
  | { phase: "greeted"; challenge: Buffer }
  | { phase: "authenticated"; connection: DeviceConnection };

export function realtimeRoutes(app: FastifyInstance, store: Store, hub: Hub, calls: CallConfig | null = null, push?: PushNotifier) {
  app.get("/v1/ws", { websocket: true }, (socket: WebSocket) => {
    let state: State = { phase: "new" };
    let tokens = RATE_BURST;
    let refilledAt = Date.now();
    let queue = Promise.resolve();

    const send = (frame: ServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };
    const error = (code: ErrorCode, requestId?: string) =>
      send(requestId === undefined ? { type: "error", code } : { type: "error", code, requestId });

    const allowFrame = () => {
      const now = Date.now();
      tokens = Math.min(RATE_BURST, tokens + ((now - refilledAt) / 1000) * RATE_PER_SECOND);
      refilledAt = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };

    socket.on("message", (raw: RawData) => {
      if (!allowFrame()) {
        error("rate_limited");
        return;
      }
      let data: unknown;
      try {
        const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        data = JSON.parse(bytes.toString("utf8"));
      } catch {
        error("bad_json");
        return;
      }
      const parsed = ClientFrame.safeParse(data);
      if (!parsed.success) {
        const requestId = (data as { requestId?: unknown } | null)?.requestId;
        error("bad_frame", typeof requestId === "string" ? requestId.slice(0, 64) : undefined);
        return;
      }
      const frame = parsed.data;
      // Frames of one connection are handled strictly in order.
      queue = queue
        .then(() => handle(frame))
        .catch((err: unknown) => {
          app.log.error({ err }, "frame handling failed");
          error("internal", "requestId" in frame ? frame.requestId : undefined);
        });
    });

    socket.on("close", () => {
      if (state.phase === "authenticated") hub.remove(state.connection);
    });

    async function handle(frame: ClientFrame): Promise<void> {
      if (frame.type === "hello") {
        if (frame.protocol !== PROTOCOL_VERSION) {
          error("unsupported_protocol");
          socket.close(CloseCode.UnsupportedProtocol, "unsupported protocol");
          return;
        }
        if (state.phase === "authenticated") {
          error("already_authenticated");
          return;
        }
        const challenge = randomChallenge();
        state = { phase: "greeted", challenge };
        send({ type: "welcome", protocol: PROTOCOL_VERSION, serverTime: Date.now(), challenge: challenge.toString("base64url") });
        return;
      }

      if (frame.type === "ping") {
        send({ type: "pong", nonce: frame.nonce });
        return;
      }

      if (frame.type === "auth") {
        if (state.phase === "new") return error("hello_required");
        if (state.phase === "authenticated") return error("already_authenticated");
        const device = await store.device(frame.deviceId);
        const signature = Buffer.from(frame.signature, "base64url");
        if (!device || !verifyEd25519(device.authPublicKey, authMessage(state.challenge), signature)) {
          error("auth_failed");
          socket.close(CloseCode.AuthFailed, "authentication failed");
          return;
        }
        const connection: DeviceConnection = {
          accountId: device.accountId,
          deviceId: frame.deviceId,
          send,
          close: (code, reason) => socket.close(code, reason),
          lastSentId: 0,
          delivering: Promise.resolve(),
        };
        state = { phase: "authenticated", connection };
        hub.add(connection);
        await store.touchDevice(frame.deviceId);
        send({
          type: "authenticated",
          accountId: device.accountId,
          deviceId: frame.deviceId,
          keyPackagesAvailable: await store.countKeyPackages(frame.deviceId),
        });
        void hub.deliver(connection);
        return;
      }

      if (state.phase !== "authenticated") {
        error(state.phase === "new" ? "hello_required" : "auth_required", "requestId" in frame ? frame.requestId : undefined);
        return;
      }
      const me = state.connection;

      switch (frame.type) {
        case "publish_key_packages": {
          try {
            const available = await store.publishKeyPackages(
              me.deviceId,
              frame.keyPackages.map((item) => Buffer.from(item, "base64url")),
            );
            send({ type: "key_packages_published", requestId: frame.requestId, available });
          } catch (err) {
            if (err instanceof LimitError) return error("too_many_key_packages", frame.requestId);
            throw err;
          }
          return;
        }

        case "lookup_user": {
          send({ type: "user", requestId: frame.requestId, user: await store.lookupUser(frame.username) });
          return;
        }

        case "claim_key_packages": {
          const items = await store.claimKeyPackages(frame.accountId);
          send({
            type: "key_packages",
            requestId: frame.requestId,
            accountId: frame.accountId,
            items: items.map((item) => ({ deviceId: item.deviceId, keyPackage: item.data.toString("base64url") })),
          });
          return;
        }

        case "send": {
          const result = await store.enqueue({
            senderAccountId: me.accountId,
            senderDeviceId: me.deviceId,
            clientMessageId: frame.id,
            recipients: frame.recipients,
            kind: frame.kind,
            payload: Buffer.from(frame.payload, "base64url"),
          });
          send({ type: "sent", id: frame.id, accepted: result.accepted, unknown: result.unknown });
          hub.notifyQueued(
            result.created.map((row) => row.recipientDeviceId),
            frame.wake,
          );
          return;
        }

        case "ack": {
          await store.ack(me.deviceId, frame.ids);
          return;
        }

        case "register_push": {
          await store.registerPush(me.deviceId, frame.provider, frame.token);
          send({ type: "push_registered", requestId: frame.requestId });
          return;
        }

        case "create_recovery_code": {
          const recoveryCode = newRecoveryCode();
          await store.setRecoveryHash(me.accountId, await hashRecoveryCode(recoveryCode));
          send({ type: "recovery_code", requestId: frame.requestId, recoveryCode });
          return;
        }

        case "delete_recovery_code": {
          await store.setRecoveryHash(me.accountId, null);
          send({ type: "recovery_code_deleted", requestId: frame.requestId });
          return;
        }

        case "request_upload": {
          const token = randomBytes(32).toString("base64url");
          const blobId = randomUUID();
          try {
            await store.createBlob({ id: blobId, deviceId: me.deviceId, size: frame.size, tokenHash: hashUploadToken(token), dailyLimit: DAILY_UPLOAD_BYTES });
          } catch (err) {
            if (err instanceof LimitError) return error("upload_quota_exceeded", frame.requestId);
            throw err;
          }
          send({ type: "upload_ready", requestId: frame.requestId, blobId, token });
          return;
        }

        case "test_push": {
          const result = push?.test ? await push.test(me.deviceId) : "not_configured";
          app.log.info({ result }, "test push");
          send({ type: "push_test", requestId: frame.requestId, result });
          return;
        }

        case "call_token": {
          if (!calls) return error("calls_unavailable", frame.requestId);
          send({ type: "call_token", requestId: frame.requestId, url: calls.url, token: callToken(calls, frame.room, me.deviceId) });
          return;
        }

        case "change_password": {
          const account = await store.credentials({ accountId: me.accountId });
          if (!account) return error("not_found", frame.requestId);
          if (account.loginLockedUntil && account.loginLockedUntil > new Date()) {
            return error("login_locked", frame.requestId);
          }
          if (!(await verifyPassword(frame.currentPassword, account.passwordHash))) {
            await store.recordFailure("login", account.id, LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES);
            return error("wrong_password", frame.requestId);
          }
          if (passwordProblem(frame.newPassword, account.username)) return error("weak_password", frame.requestId);
          await store.setPasswordHash(account.id, await hashPassword(frame.newPassword));
          await store.clearLoginFailures(account.id);
          send({ type: "password_changed", requestId: frame.requestId });
          return;
        }
      }
    }
  });
}
