import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Realtime } from "./api/realtime";

// While the app is open, messages show up in it; no banners on top.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

let registered: string | null = null;

/**
 * Asks once for permission to notify, and gives the server this phone's
 * push address. Pushes carry no content: just "new message".
 * Only Android for now (iPhone needs the Apple developer account).
 */
export async function registerForPush(realtime: Realtime): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("messages", {
      name: "Сообщения",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      showBadge: true,
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status === "undetermined") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    const token = String(data);
    if (!token || token === registered) return;
    await realtime.request({ type: "register_push", provider: "fcm", token }, "push_registered");
    registered = token;
  } catch (error) {
    // No Firebase set up in this build yet, or no network: try again next time.
    console.warn("push not registered", error);
  }
}
