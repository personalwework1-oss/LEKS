import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Same as the server's callerHint: sha256("device:account"), first 32 hex characters. */
export const callerHint = (deviceId: string, accountId: string) => bytesToHex(sha256(utf8ToBytes(`${deviceId}:${accountId}`))).slice(0, 32);

/** The hint from a call push, wherever the platform put the data. */
export function hintOf(data: unknown): string | null {
  return /\\?"c\\?"\s*:\s*\\?"([0-9a-f]{32})\\?"/.exec(JSON.stringify(data ?? null))?.[1] ?? null;
}

export interface Contact {
  accountId: string;
  name: string;
}

/** Finds who is calling among this phone's own contacts; the name never leaves the phone. */
export function findCaller(hint: string, deviceId: string, contacts: Contact[]): string | null {
  for (const contact of contacts) if (callerHint(deviceId, contact.accountId) === hint) return contact.name;
  return null;
}
