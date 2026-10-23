import { Stack } from "expo-router";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

/** After registration: backup code, then the app lock. After signing in on a new phone: only the app lock. */
export default function SetupLayout() {
  const p = usePalette();
  const { onboarding } = useSession();
  return (
    <Stack
      initialRouteName={onboarding === "register" ? "backup-code" : "lock-setup"}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }}
    >
      <Stack.Screen name="backup-code" />
      <Stack.Screen name="lock-setup" />
    </Stack>
  );
}
