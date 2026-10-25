import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import * as TaskManager from "expo-task-manager";
import { LeksCalls } from "../../modules/leks-calls";
import { secure } from "../storage/secure";
import { type Contact, findCaller, hintOf } from "./callerName";

/**
 * Runs even when the app is closed: a call push (it carries only
 * {"leks":"call"}) turns into the ringing full-screen call notification.
 * Opening it starts the app, which then receives the encrypted invite.
 */
export const INCOMING_CALL_TASK = "leks-incoming-call";

/** True if the push data says "call", wherever the platform put it. */
export function isCallPush(data: unknown): boolean {
  return /\\?"leks\\?"\s*:\s*\\?"call\\?"/.test(JSON.stringify(data ?? null));
}

/** Direct chats first (their name is how you know the person), then group members. */
async function contacts(deviceId: string): Promise<Contact[]> {
  const db = await SQLite.openDatabaseAsync(`leks-${deviceId}.db`);
  const rows = await db.getAllAsync<{ kind: string; peer_account_id: string; title: string; members: string }>(
    "SELECT kind, peer_account_id, title, members FROM conversations",
  );
  const direct = rows.filter((r) => r.kind !== "group").map((r) => ({ accountId: r.peer_account_id, name: r.title }));
  const members = rows
    .filter((r) => r.kind === "group")
    .flatMap((r) => {
      try {
        return (JSON.parse(r.members) as { accountId: string; displayName: string }[]).map((m) => ({ accountId: m.accountId, name: m.displayName }));
      } catch {
        return [];
      }
    });
  return [...direct, ...members];
}

async function nameOf(hint: string | null): Promise<string | null> {
  if (!hint) return null;
  const session = await secure.loadSession();
  if (!session) return null;
  return findCaller(hint, session.deviceId, await contacts(session.deviceId));
}

TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data }) => {
  if (!isCallPush(data)) return;
  // The name is looked up on this phone; ringing waits for it at most a moment.
  const name = await Promise.race([
    nameOf(hintOf(data)).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);
  LeksCalls?.showIncomingCall(name ?? "LEKS", name ? "Входящий звонок · LEKS" : "Входящий звонок");
});

if (LeksCalls) {
  Notifications.registerTaskAsync(INCOMING_CALL_TASK).catch((error: unknown) => console.warn("call task", error));
}
