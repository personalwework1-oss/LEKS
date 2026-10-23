import type { LockSettings } from "../storage/secure";

export const PASSCODE_LENGTH = 4;
/** Wrong codes in a row before the keypad pauses. */
export const MAX_FAILURES = 5;
/** The pause grows with each further series: 30 s, 60 s, 120 s … up to 15 min. */
export const BASE_BLOCK_MS = 30_000;
export const MAX_BLOCK_MS = 15 * 60_000;

export type Sha256Hex = (text: string) => Promise<string>;

export function isValidPasscode(code: string): boolean {
  return new RegExp(`^[0-9]{${PASSCODE_LENGTH}}$`).test(code);
}

export async function hashPasscode(code: string, salt: string, sha256: Sha256Hex): Promise<string> {
  return sha256(`leks-passcode-v1:${salt}:${code}`);
}

/** Lock settings for a new passcode (also the fallback when Face ID / Touch ID is chosen). */
export async function withPasscode(
  method: "biometric" | "passcode",
  code: string,
  salt: string,
  sha256: Sha256Hex,
): Promise<LockSettings> {
  if (!isValidPasscode(code)) throw new Error("passcode must be 4 digits");
  return { method, salt, passcodeHash: await hashPasscode(code, salt, sha256), failures: 0, blockedUntil: 0 };
}

export type CheckResult =
  | { ok: true; lock: LockSettings }
  | { ok: false; lock: LockSettings; blockedForMs: number };

/**
 * Checks an entered code and returns the updated settings (failure count and
 * pause), which the caller must save.
 */
export async function checkPasscode(
  code: string,
  lock: LockSettings,
  now: number,
  sha256: Sha256Hex,
): Promise<CheckResult> {
  if (lock.blockedUntil > now) return { ok: false, lock, blockedForMs: lock.blockedUntil - now };
  if (!lock.passcodeHash || !lock.salt) return { ok: false, lock, blockedForMs: 0 };

  if ((await hashPasscode(code, lock.salt, sha256)) === lock.passcodeHash) {
    return { ok: true, lock: { ...lock, failures: 0, blockedUntil: 0 } };
  }
  const failures = lock.failures + 1;
  if (failures % MAX_FAILURES === 0) {
    const series = failures / MAX_FAILURES;
    const blockedForMs = Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** (series - 1));
    return { ok: false, lock: { ...lock, failures, blockedUntil: now + blockedForMs }, blockedForMs };
  }
  return { ok: false, lock: { ...lock, failures }, blockedForMs: 0 };
}
