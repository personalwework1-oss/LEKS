import { fromBase64url, toBase64url } from "@leks/protocol";
import { LeksCrypto } from "../../modules/leks-crypto";

/**
 * The password never leaves the phone. Two keys are made from it here
 * (scrypt, in the native core):
 * - the sign-in secret, sent to the server in place of the password (the
 *   server stores only a hash of it);
 * - the backup key, which never leaves the phone at all and unlocks the
 *   encrypted copy of the chats.
 * Different salts make them unrelated, so the server cannot get from one to the other.
 */

type Call = (request: string) => Promise<string>;

async function run<T>(call: Call, request: Record<string, unknown>): Promise<T> {
  const response = JSON.parse(await call(JSON.stringify(request))) as { ok: T } | { error: { code: string; message: string } };
  if ("error" in response) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.ok;
}

const nativeCall: Call | null = LeksCrypto ? (request) => LeksCrypto!.call(request) : null;

async function derive(password: string, salt: string, call: Call | null = nativeCall): Promise<string> {
  if (!call) throw new Error("no crypto core");
  return (await run<{ key: string }>(call, { op: "derive_key", password, salt })).key;
}

/** What the server gets instead of the password. Without the native core (development only), the password itself. */
export async function signInSecret(username: string, password: string, call: Call | null = nativeCall): Promise<string> {
  if (!call) return password;
  return `k1.${await derive(password, `leks/auth/v1/${username.trim().toLowerCase()}`, call)}`;
}

/** Unlocks the backup; stays on the phone. */
export function backupPasswordKey(accountId: string, password: string, call: Call | null = nativeCall): Promise<string> {
  return derive(password, `leks/backup/v1/${accountId}`, call);
}

/** Small secrets (the backup's file key) locked with a 32-byte key; base64url in and out. */
export async function seal(key: string, plaintext: Uint8Array, call: Call | null = nativeCall): Promise<string> {
  if (!call) throw new Error("no crypto core");
  return (await run<{ sealed: string }>(call, { op: "seal", key, plaintext: toBase64url(plaintext) })).sealed;
}

/** Throws if the key is wrong (a different password) or the data was changed. */
export async function unseal(key: string, sealed: string, call: Call | null = nativeCall): Promise<Uint8Array> {
  if (!call) throw new Error("no crypto core");
  return fromBase64url((await run<{ plaintext: string }>(call, { op: "unseal", key, sealed })).plaintext);
}
