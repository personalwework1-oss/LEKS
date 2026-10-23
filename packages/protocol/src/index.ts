/**
 * Wire protocol between the apps and the server.
 *
 * Registration and account recovery are plain HTTPS requests. Everything
 * else goes over one WebSocket per device: the device proves who it is by
 * signing a challenge, then sends and receives frames. Every frame is a JSON
 * object with a `type` field.
 *
 * The schemas below are the single source of truth: the server validates
 * every request against them, and the apps use the same types, so the two
 * sides cannot drift apart.
 *
 * Chat content never appears here in readable form. Messages, key packages,
 * welcomes and commits travel as opaque MLS bytes (base64url) produced and
 * consumed on the devices.
 */
import { z } from "zod";

/** Bumped whenever a change would break older apps. */
export const PROTOCOL_VERSION = 1;

/** Largest WebSocket frame the server accepts, in bytes. */
export const MAX_FRAME_BYTES = 256 * 1024;

/** Largest encrypted payload in one `send`, in bytes after base64url decoding. */
export const MAX_PAYLOAD_BYTES = 192 * 1024;

/** Most key packages a device may publish at once and keep on the server. */
export const MAX_KEY_PACKAGES = 100;

/** Undelivered messages are deleted after this many days. */
export const MESSAGE_RETENTION_DAYS = 30;

/**
 * A device signs `AUTH_CONTEXT` (UTF-8) followed by the raw challenge bytes
 * with its Ed25519 device key. The prefix keeps the signature from being
 * valid for anything else.
 */
export const AUTH_CONTEXT = "leks-auth-v1:";

// ---------------------------------------------------------------------------
// Building blocks

const base64url = (maxChars: number) =>
  z
    .string()
    .min(1)
    .max(maxChars)
    .regex(/^[A-Za-z0-9_-]+$/, "must be base64url without padding");

/** Base64url length of `bytes` raw bytes, without padding. */
export const base64urlLength = (bytes: number) => Math.ceil((bytes * 4) / 3);

export const Id = z.uuid();
const RequestId = z.string().min(1).max(64);

/** Ed25519 public key: 32 bytes. */
export const PublicKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "must be a 32-byte base64url key");
/** Ed25519 signature: 64 bytes. */
export const Signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/, "must be a 64-byte base64url signature");

/** Lowercase letters, digits and underscore, 3 to 32 characters. Input is lowercased. */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, "3 to 32 characters: a–z, 0–9 and _");
export const DisplayName = z.string().trim().min(1).max(64);

export const DevicePlatform = z.enum(["ios", "android"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;
export const ClientPlatform = z.enum(["ios", "android", "test"]);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

export const NewDevice = z.object({
  platform: DevicePlatform,
  authPublicKey: PublicKey,
});

/** Recovery code as shown to the user: five groups of four characters. */
export const RecoveryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/, "format XXXX-XXXX-XXXX-XXXX-XXXX");

export const MessageKind = z.enum(["welcome", "commit", "message"]);
export type MessageKind = z.infer<typeof MessageKind>;

export const PushProvider = z.enum(["apns", "fcm"]);
export type PushProvider = z.infer<typeof PushProvider>;

// ---------------------------------------------------------------------------
// HTTPS: registration and recovery

export const RegisterRequest = z.object({
  username: Username,
  displayName: DisplayName,
  device: NewDevice,
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const AccountSession = z.object({
  accountId: Id,
  deviceId: Id,
  username: z.string(),
  displayName: z.string(),
  /** Shown to the user once; the server keeps only a hash. */
  recoveryCode: z.string(),
});
export type AccountSession = z.infer<typeof AccountSession>;

/** Recovering an account signs out every old device and issues a new code. */
export const RecoverRequest = z.object({
  username: Username,
  recoveryCode: RecoveryCode,
  device: NewDevice,
});
export type RecoverRequest = z.infer<typeof RecoverRequest>;

export const UsernameAvailability = z.object({
  username: z.string(),
  available: z.boolean(),
});

export const HttpErrorCode = z.enum([
  "invalid_request",
  "username_taken",
  "device_key_in_use",
  "recovery_failed",
  "recovery_locked",
  "rate_limited",
  "internal",
]);
export type HttpErrorCode = z.infer<typeof HttpErrorCode>;
export const HttpError = z.object({ error: HttpErrorCode });

// ---------------------------------------------------------------------------
// WebSocket: frames the apps send

export const ClientFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int().positive(),
    client: z.object({ platform: ClientPlatform, version: z.string().min(1).max(32) }),
  }),
  z.object({ type: z.literal("auth"), deviceId: Id, signature: Signature }),
  z.object({ type: z.literal("ping"), nonce: z.string().min(1).max(64) }),
  z.object({
    type: z.literal("publish_key_packages"),
    requestId: RequestId,
    keyPackages: z.array(base64url(base64urlLength(16 * 1024))).min(1).max(MAX_KEY_PACKAGES),
  }),
  z.object({ type: z.literal("lookup_user"), requestId: RequestId, username: Username }),
  /** Takes one key package for each device of the account; each is used once. */
  z.object({ type: z.literal("claim_key_packages"), requestId: RequestId, accountId: Id }),
  z.object({
    type: z.literal("send"),
    /** Chosen by the sender; resending with the same id is safe. */
    id: Id,
    recipients: z.array(Id).min(1).max(1000),
    kind: MessageKind,
    payload: base64url(base64urlLength(MAX_PAYLOAD_BYTES)),
  }),
  /** Confirms messages were stored on the device; the server then deletes them. */
  z.object({ type: z.literal("ack"), ids: z.array(z.number().int().positive()).min(1).max(500) }),
  z.object({
    type: z.literal("register_push"),
    requestId: RequestId,
    provider: PushProvider,
    token: z.string().min(1).max(4096),
  }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

// ---------------------------------------------------------------------------
// WebSocket: frames the server sends

export const ErrorCode = z.enum([
  "bad_json",
  "bad_frame",
  "unsupported_protocol",
  "hello_required",
  "auth_required",
  "auth_failed",
  "already_authenticated",
  "not_found",
  "too_many_key_packages",
  "rate_limited",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const DeliveredMessage = z.object({
  /** Position in this device's queue; acknowledge it with `ack`. */
  id: z.number().int().positive(),
  from: z.object({ accountId: Id, deviceId: Id }),
  kind: MessageKind,
  payload: z.string(),
  sentAt: z.number().int(),
});
export type DeliveredMessage = z.infer<typeof DeliveredMessage>;

export const PublicUser = z.object({ accountId: Id, username: z.string(), displayName: z.string() });
export type PublicUser = z.infer<typeof PublicUser>;

export const ServerFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocol: z.number().int().positive(),
    serverTime: z.number().int(),
    /** 32 random bytes, base64url, to be signed in `auth`. */
    challenge: z.string(),
  }),
  z.object({ type: z.literal("authenticated"), accountId: Id, deviceId: Id, keyPackagesAvailable: z.number().int() }),
  z.object({ type: z.literal("pong"), nonce: z.string() }),
  z.object({ type: z.literal("key_packages_published"), requestId: RequestId, available: z.number().int() }),
  z.object({ type: z.literal("user"), requestId: RequestId, user: PublicUser.nullable() }),
  z.object({
    type: z.literal("key_packages"),
    requestId: RequestId,
    accountId: Id,
    /** Devices without a key package left are missing from the list. */
    items: z.array(z.object({ deviceId: Id, keyPackage: z.string() })),
  }),
  z.object({
    type: z.literal("sent"),
    id: Id,
    accepted: z.array(Id),
    /** Recipients the server does not know, for example a removed device. */
    unknown: z.array(Id),
  }),
  z.object({ type: z.literal("deliver"), messages: z.array(DeliveredMessage) }),
  z.object({ type: z.literal("push_registered"), requestId: RequestId }),
  z.object({ type: z.literal("error"), code: ErrorCode, requestId: z.string().optional() }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** WebSocket close codes used by the server (4000–4999 is the app range). */
export const CloseCode = {
  UnsupportedProtocol: 4000,
  AuthFailed: 4001,
  /** The device was removed, for example by account recovery. */
  DeviceRemoved: 4002,
} as const;

// ---------------------------------------------------------------------------
// Helpers usable on the server and in the apps (no Node-only APIs)

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]!;
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += ALPHABET[c & 63]!;
  }
  return out;
}

export function fromBase64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("invalid base64url");
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of text) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/** The exact bytes a device signs to authenticate. */
export function authMessage(challenge: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(AUTH_CONTEXT);
  const message = new Uint8Array(prefix.length + challenge.length);
  message.set(prefix, 0);
  message.set(challenge, prefix.length);
  return message;
}
