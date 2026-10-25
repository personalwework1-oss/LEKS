import * as SecureStore from "expo-secure-store";
import { fromBase64url, toBase64url } from "@leks/protocol";
import { z } from "zod";

/**
 * Everything secret lives in the iOS Keychain / Android Keystore, readable
 * only while the phone is unlocked, never copied to backups or other devices.
 */
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEYS = {
  session: "leks.session",
  deviceKey: "leks.device-key",
  lock: "leks.lock",
  backup: "leks.backup",
} as const;

export const StoredSession = z.object({
  accountId: z.string(),
  deviceId: z.string(),
  username: z.string(),
  displayName: z.string(),
});
export type StoredSession = z.infer<typeof StoredSession>;

export const LockSettings = z.object({
  method: z.enum(["none", "biometric", "passcode"]),
  /** Salted hash of the 4-digit code; required for both methods (it is Face ID's fallback). */
  passcodeHash: z.string().optional(),
  salt: z.string().optional(),
  failures: z.number().int().default(0),
  blockedUntil: z.number().int().default(0),
});
export type LockSettings = z.infer<typeof LockSettings>;

/** The backup's password key (made from the password at sign-in; never leaves the phone) and the schedule. */
export const BackupSettings = z.object({
  key: z.string().optional(),
  auto: z.boolean().default(true),
  lastAt: z.number().int().default(0),
  /** "Позже" on the reminder: hidden until then. */
  remindAfter: z.number().int().default(0),
});
export type BackupSettings = z.infer<typeof BackupSettings>;

export const NO_LOCK: LockSettings = { method: "none", failures: 0, blockedUntil: 0 };

async function readJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const secure = {
  loadSession: () => readJson(KEYS.session, StoredSession),
  saveSession: (session: StoredSession) => SecureStore.setItemAsync(KEYS.session, JSON.stringify(session), options),

  async loadDeviceSecret(): Promise<Uint8Array | null> {
    const raw = await SecureStore.getItemAsync(KEYS.deviceKey, options);
    return raw ? fromBase64url(raw) : null;
  },
  saveDeviceSecret: (secret: Uint8Array) => SecureStore.setItemAsync(KEYS.deviceKey, toBase64url(secret), options),

  async loadLock(): Promise<LockSettings> {
    return (await readJson(KEYS.lock, LockSettings)) ?? NO_LOCK;
  },
  saveLock: (lock: LockSettings) => SecureStore.setItemAsync(KEYS.lock, JSON.stringify(lock), options),

  async loadBackup(): Promise<BackupSettings> {
    return (await readJson(KEYS.backup, BackupSettings)) ?? { auto: true, lastAt: 0, remindAfter: 0 };
  },
  saveBackup: (settings: BackupSettings) => SecureStore.setItemAsync(KEYS.backup, JSON.stringify(settings), options),

  async clearAll(): Promise<void> {
    await Promise.all(Object.values(KEYS).map((key) => SecureStore.deleteItemAsync(key, options)));
  },
};
