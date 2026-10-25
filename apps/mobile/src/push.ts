import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import type { Realtime } from "./api/realtime";

// While the app is open, messages show up in it; no banners on top.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

export type PushState =
  | { state: "unsupported" }
  | { state: "denied" }
  | { state: "no_token"; error: string }
  | { state: "registered" }
  | { state: "pending" };

let registered: string | null = null;
let lastState: PushState = Platform.OS === "android" ? { state: "pending" } : { state: "unsupported" };
const listeners = new Set<(state: PushState) => void>();

function setState(state: PushState) {
  lastState = state;
  for (const listener of listeners) listener(state);
}

export const pushState = () => lastState;
export function onPushState(listener: (state: PushState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function channels() {
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Сообщения",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    showBadge: true,
  });
  await Notifications.setNotificationChannelAsync("calls", {
    name: "Звонки",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 800, 600, 800, 600, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: false,
  });
}

/** Asks once for permission to notify (right after signing in, not on first message). */
export async function askForNotifications(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  await channels();
  let { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && canAskAgain) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") setState({ state: "denied" });
  return status === "granted";
}

/**
 * Gives the server this phone's push address. Pushes carry no content: just
 * "new message" or "incoming call". Android only for now (iPhone needs the
 * Apple developer account).
 */
export async function registerForPush(realtime: Realtime, force = false): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    if (!(await askForNotifications())) return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    const token = String(data);
    if (!token) throw new Error("пустой адрес");
    if (token !== registered || force) {
      await realtime.request({ type: "register_push", provider: "fcm", token }, "push_registered");
      registered = token;
    }
    setState({ state: "registered" });
  } catch (error) {
    setState({ state: "no_token", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Registers again and asks the server to send a test notification right now. */
export async function testPush(realtime: Realtime): Promise<"sent" | "no_token" | "not_configured" | "rejected" | "failed" | "denied"> {
  await registerForPush(realtime, true);
  if (lastState.state === "denied") return "denied";
  if (lastState.state !== "registered") return "no_token";
  const answer = await realtime.request({ type: "test_push" }, "push_test");
  return answer.result;
}

export const openAppSettings = () => Linking.openSettings();

/** Xiaomi, Redmi and POCO block pushes of closed apps unless "Autostart" is on. */
export const isXiaomi = () =>
  Platform.OS === "android" && /xiaomi|redmi|poco/i.test(String((Platform.constants as { Manufacturer?: string; Brand?: string }).Manufacturer ?? "") + String((Platform.constants as { Brand?: string }).Brand ?? ""));

export async function openAutostartSettings(): Promise<void> {
  try {
    await Linking.sendIntent("miui.intent.action.OP_AUTO_START");
  } catch {
    await Linking.openSettings();
  }
}
