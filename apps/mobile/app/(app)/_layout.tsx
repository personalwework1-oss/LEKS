import { Stack } from "expo-router";
import { CallOverlay } from "@/calls/CallOverlay";
import { usePalette } from "@/theme";

export default function AppLayout() {
  const p = usePalette();
  return (
    <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="group/new" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="settings/lock" />
      <Stack.Screen name="settings/password" />
      <Stack.Screen name="settings/backup-code" />
      <Stack.Screen name="settings/backup" />
      <Stack.Screen name="settings/devices" />
      <Stack.Screen name="settings/profile" />
      <Stack.Screen name="settings/blocked" />
      <Stack.Screen name="contact/[id]" />
    </Stack>
    <CallOverlay />
    </>
  );
}
