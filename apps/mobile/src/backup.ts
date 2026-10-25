import { fromBase64url, toBase64url } from "@leks/protocol";
import { backupPasswordKey, seal, unseal } from "./crypto/passwordKeys";
import type { Messenger } from "./messaging/messenger";
import { secure } from "./storage/secure";

/** How often the copy is refreshed by itself. */
export const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

/** Locks the copy's file key with the password key. */
export const wrapWith = (passwordKey: string) => (fileKey: string) => seal(passwordKey, fromBase64url(fileKey));
/** Unlocks it; throws on the wrong password. */
export const unwrapWith = (passwordKey: string) => async (wrapped: string) => toBase64url(await unseal(passwordKey, wrapped));

/** Remembers the backup key made from the password (at sign-in, or when backups are turned on). */
export async function rememberBackupKey(accountId: string, password: string): Promise<string> {
  const key = await backupPasswordKey(accountId, password);
  const settings = await secure.loadBackup();
  await secure.saveBackup({ ...settings, key });
  return key;
}

let running: Promise<unknown> | null = null;

/** Saves a fresh copy now; throws if there is no key yet (the password is needed once). */
export async function backupNow(messenger: Messenger): Promise<{ size: number; chats: number; messages: number }> {
  if (running) await running.catch(() => undefined);
  const settings = await secure.loadBackup();
  if (!settings.key) throw new Error("no_key");
  const job = messenger.backup(wrapWith(settings.key));
  running = job;
  try {
    const result = await job;
    await secure.saveBackup({ ...(await secure.loadBackup()), lastAt: Date.now() });
    return result;
  } finally {
    running = null;
  }
}

/** Called after connecting: refreshes the copy once a day, quietly. */
export async function backupIfDue(messenger: Messenger): Promise<void> {
  const settings = await secure.loadBackup();
  if (!settings.auto || !settings.key || Date.now() - settings.lastAt < AUTO_BACKUP_EVERY_MS) return;
  if ((await messenger.conversations()).length === 0) return;
  await backupNow(messenger);
}

/** Restores with the remembered key, or with a key made from the given (older) password. */
export async function restoreFromBackup(messenger: Messenger, accountId: string, password?: string) {
  const key = password ? await backupPasswordKey(accountId, password) : (await secure.loadBackup()).key;
  if (!key) throw new Error("no_key");
  return messenger.restore(unwrapWith(key));
}
