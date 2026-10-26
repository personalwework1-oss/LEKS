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

/** Largest encrypted photo or file, in bytes (the encrypted file is a bit larger than the original). */
export const MAX_BLOB_BYTES = 100 * 1024 * 1024;

/** Encrypted files are deleted from the server after this many days; phones keep their own copy. */
export const BLOB_RETENTION_DAYS = 30;

/** Devices that have not connected for this many days are deleted (with their queued messages). */
export const DEVICE_RETENTION_DAYS = 30;

/** How much one device may upload per day, in bytes. */
export const DAILY_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

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
export type WakeReason = "message" | "call";
export type PushProvider = z.infer<typeof PushProvider>;

/**
 * Passwords: 8 to 128 characters. Strength is checked with
 * `passwordProblem`, the same rule in the app and on the server.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const Password = z.string().min(MIN_PASSWORD_LENGTH).max(128);

// ---------------------------------------------------------------------------
// HTTPS: registration, sign-in on a new device and recovery

export const RegisterRequest = z.object({
  username: Username,
  displayName: DisplayName,
  password: Password,
  /** The backup code is optional; it can also be created later in settings. */
  createRecoveryCode: z.boolean().default(false),
  device: NewDevice,
});
export type RegisterRequest = z.input<typeof RegisterRequest>;

export const AccountSession = z.object({
  accountId: Id,
  deviceId: Id,
  username: z.string(),
  displayName: z.string(),
  /** Shown to the user once when one was created; the server keeps only a hash. */
  recoveryCode: z.string().nullable(),
});
export type AccountSession = z.infer<typeof AccountSession>;

/** Signs in on an additional device. Devices already signed in stay signed in. */
export const LoginRequest = z.object({
  username: Username,
  password: z.string().min(1).max(128),
  device: NewDevice,
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Recovery with the backup code for a forgotten password: sets a new
 * password, signs out every old device and uses up the code.
 */
export const RecoverRequest = z.object({
  username: Username,
  recoveryCode: RecoveryCode,
  newPassword: Password,
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
  "weak_password",
  "login_failed",
  "login_locked",
  "recovery_failed",
  "recovery_locked",
  "upload_failed",
  "not_found",
  "rate_limited",
  "internal",
]);
export type HttpErrorCode = z.infer<typeof HttpErrorCode>;
export const HttpError = z.object({ error: HttpErrorCode });

/** A chat as the server knows it for muting: 32 hex characters of a hash of its id. */
export const ChatTag = z.string().regex(/^[0-9a-f]{32}$/);

/** Why someone is reported. */
export const ReportReason = z.enum(["spam", "scam", "abuse", "illegal", "other"]);
export type ReportReason = z.infer<typeof ReportReason>;
/** At most this many messages go with a report, chosen on the reporter's phone. */
export const MAX_REPORT_MESSAGES = 10;
/** New chats one account may start per day. */
export const DAILY_NEW_CHATS = 50;

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
    /**
     * Whether to wake recipients that are offline with a push: "message" for
     * something they should see, "call" for a ringing call. Left out for
     * receipts, typing, reactions and the like, which wait until the app opens.
     */
    wake: z.enum(["message", "call"]).optional(),
    /**
     * An opaque tag of the chat (a hash; the server cannot tell which chat it
     * is), so a chat someone muted does not wake their phone.
     */
    chat: ChatTag.optional(),
  }),
  /** Confirms messages were stored on the device; the server then deletes them. */
  z.object({ type: z.literal("ack"), ids: z.array(z.number().int().positive()).min(1).max(500) }),
  z.object({
    type: z.literal("register_push"),
    requestId: RequestId,
    provider: PushProvider,
    token: z.string().min(1).max(4096),
  }),
  /** Creates a backup code, replacing any earlier one. */
  z.object({ type: z.literal("create_recovery_code"), requestId: RequestId }),
  z.object({ type: z.literal("delete_recovery_code"), requestId: RequestId }),
  z.object({
    type: z.literal("change_password"),
    requestId: RequestId,
    currentPassword: z.string().min(1).max(128),
    newPassword: Password,
  }),
  /**
   * Asks for a place to upload one encrypted file of exactly `size` bytes.
   * The answer carries a one-time token for `PUT /v1/blobs/:blobId`.
   */
  z.object({ type: z.literal("request_upload"), requestId: RequestId, size: z.number().int().positive().max(MAX_BLOB_BYTES) }),
  /**
   * Asks for a pass to a call room. The room is a random id the caller made
   * up and shared inside the encrypted chat; audio and video are end-to-end
   * encrypted with a key the server never sees.
   */
  z.object({ type: z.literal("call_token"), requestId: RequestId, room: Id }),
  /** Sends a test notification to this device right away and reports what the push service said. */
  z.object({ type: z.literal("test_push"), requestId: RequestId }),
  /** The devices of an account, so chats can include all of them (and drop removed ones). */
  z.object({ type: z.literal("list_devices"), requestId: RequestId, accountId: Id }),
  /** Signs another device of my own account out and deletes it. */
  z.object({ type: z.literal("remove_device"), requestId: RequestId, deviceId: Id }),
  /** Makes an uploaded file this account's backup (replacing the previous one). */
  z.object({
    type: z.literal("set_backup"),
    requestId: RequestId,
    blobId: Id,
    /** The backup's key, sealed with a key derived from the password on the phone. */
    wrappedKey: z.string().min(1).max(2048),
  }),
  z.object({ type: z.literal("get_backup"), requestId: RequestId }),
  /** The name others see when they look me up by @username (photo and "about" go only end-to-end). */
  z.object({ type: z.literal("update_profile"), requestId: RequestId, displayName: DisplayName }),
  /** Mutes a chat (by its tag) on all my phones until `until` (ms); 0 unmutes. Calls still ring. */
  z.object({ type: z.literal("mute_chat"), requestId: RequestId, chat: ChatTag, until: z.number().int().min(0) }),
  /** Stops this account's messages, calls and new chats reaching me. */
  z.object({ type: z.literal("block"), requestId: RequestId, accountId: Id }),
  z.object({ type: z.literal("unblock"), requestId: RequestId, accountId: Id }),
  z.object({ type: z.literal("list_blocks"), requestId: RequestId }),
  /** A report; `messages` are copies of their messages the reporter chose to send (the server cannot read chats). */
  z.object({
    type: z.literal("report"),
    requestId: RequestId,
    accountId: Id,
    reason: ReportReason,
    comment: z.string().max(500).optional(),
    messages: z
      .array(z.object({ text: z.string().max(4000), sentAt: z.number().int(), kind: z.string().max(20).optional() }))
      .max(MAX_REPORT_MESSAGES),
  }),
  /** Asks these devices' apps to bring my devices into our chats now (after a restore). No content. */
  z.object({ type: z.literal("nudge"), deviceIds: z.array(Id).min(1).max(1000) }),
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
  "wrong_password",
  "weak_password",
  "login_locked",
  "upload_quota_exceeded",
  "calls_unavailable",
  "rate_limited",
  /** Too many new chats today, or the account is restricted after reports. */
  "new_chats_limited",
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
  /** The new backup code, shown to the user once. */
  z.object({ type: z.literal("recovery_code"), requestId: RequestId, recoveryCode: z.string() }),
  z.object({ type: z.literal("recovery_code_deleted"), requestId: RequestId }),
  z.object({ type: z.literal("password_changed"), requestId: RequestId }),
  z.object({
    type: z.literal("devices"),
    requestId: RequestId,
    accountId: Id,
    devices: z.array(z.object({ deviceId: Id, platform: z.string(), lastSeenAt: z.number().int().nullable() })),
  }),
  z.object({ type: z.literal("device_removed"), requestId: RequestId }),
  /** Someone's devices changed: check the chats with this account. */
  z.object({ type: z.literal("nudge"), accountId: Id }),
  z.object({ type: z.literal("backup_saved"), requestId: RequestId }),
  z.object({ type: z.literal("profile_updated"), requestId: RequestId }),
  z.object({ type: z.literal("chat_muted"), requestId: RequestId }),
  z.object({ type: z.literal("blocked"), requestId: RequestId }),
  z.object({ type: z.literal("unblocked"), requestId: RequestId }),
  z.object({ type: z.literal("blocks"), requestId: RequestId, accountIds: z.array(Id) }),
  z.object({ type: z.literal("reported"), requestId: RequestId }),
  z.object({
    type: z.literal("backup"),
    requestId: RequestId,
    backup: z.object({ blobId: Id, wrappedKey: z.string(), size: z.number().int(), updatedAt: z.number().int() }).nullable(),
  }),
  z.object({
    type: z.literal("push_test"),
    requestId: RequestId,
    /** sent: the push service accepted it; no_token: this device never registered; others: why not. */
    result: z.enum(["sent", "no_token", "not_configured", "rejected", "failed"]),
  }),
  z.object({
    type: z.literal("call_token"),
    requestId: RequestId,
    /** The media server (wss://…) and a short-lived pass for this room only. */
    url: z.string(),
    token: z.string(),
  }),
  z.object({
    type: z.literal("upload_ready"),
    requestId: RequestId,
    blobId: Id,
    /** Send as `Authorization: Bearer <token>`; valid once, for one hour. */
    token: z.string(),
  }),
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

/**
 * Most common passwords of 8+ characters, in Russian- and English-speaking
 * leaks. A password on this list is rejected no matter its length.
 */
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "12345678910", "123123123", "11111111", "00000000", "88888888",
  "87654321", "123456654321", "1q2w3e4r", "1q2w3e4r5t", "1q2w3e4r5t6y", "q1w2e3r4", "zaq12wsx", "1qaz2wsx",
  "qwertyui", "qwertyuiop", "qwerty123", "qwerty12", "qwerty1234", "asdfghjk", "asdfghjkl", "zxcvbnm1",
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "iloveyou", "sunshine", "princess",
  "football", "baseball", "superman", "starwars", "whatever", "trustno1", "letmein1", "welcome1",
  "admin123", "administrator", "computer", "internet", "michelle", "jennifer", "1234qwer", "qwer1234",
  "abcd1234", "abc12345", "a1234567", "aa123456", "qazwsxedc", "q1w2e3r4t5", "q1w2e3r4t5y6", "123qweasd",
  "1qazxsw2", "matrix12", "dragon12", "monkey12", "master12", "killer12", "samsung1", "iphone12",
  "йцукенгш", "йцукенгшщз", "пароль12", "пароль123", "привет12", "люблютебя", "наташа12", "максим12",
  "nikita12", "natasha1", "maksim12", "aleksandr", "alexander", "vladimir", "dmitriy1", "sergey12",
  "andrey12", "marina12", "svetlana", "kristina", "katerina", "valentina", "zenit2011", "spartak1",
  "leks1234", "lecksis1", "messenger", "telegram", "whatsapp",
]);

export type PasswordProblem = "too_short" | "too_long" | "common" | "same_as_username" | "too_simple";

/** Why a new password is not allowed, or null if it is fine. */
export function passwordProblem(password: string, username?: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > 128) return "too_long";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "common";
  if (username && lower.includes(username.toLowerCase()) && lower.length - username.length < 4) return "same_as_username";
  if (new Set(lower).size <= 2) return "too_simple";
  const codes = [...lower].map((char) => char.codePointAt(0)!);
  const steps = codes.slice(1).map((code, i) => code - codes[i]!);
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return "too_simple";
  return null;
}

/** The exact bytes a device signs to authenticate. */
export function authMessage(challenge: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(AUTH_CONTEXT);
  const message = new Uint8Array(prefix.length + challenge.length);
  message.set(prefix, 0);
  message.set(challenge, prefix.length);
  return message;
}
