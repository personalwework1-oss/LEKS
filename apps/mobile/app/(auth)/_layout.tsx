import { Stack } from "expo-router";
import { usePalette } from "@/theme";

export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const p = usePalette();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }} />;
}
