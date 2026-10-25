import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { LeksCalls } from "../../modules/leks-calls";

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

TaskManager.defineTask(INCOMING_CALL_TASK, async ({ data }) => {
  if (isCallPush(data)) LeksCalls?.showIncomingCall("LEKS", "Входящий звонок");
});

if (LeksCalls) {
  Notifications.registerTaskAsync(INCOMING_CALL_TASK).catch((error: unknown) => console.warn("call task", error));
}
