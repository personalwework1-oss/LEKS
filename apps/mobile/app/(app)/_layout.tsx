import { Stack } from "expo-router";
import { usePalette } from "@/theme";

export default function AppLayout() {
  const p = usePalette();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="settings/lock" />
      <Stack.Screen name="settings/password" />
      <Stack.Screen name="settings/backup-code" />
    </Stack>
  );
}
