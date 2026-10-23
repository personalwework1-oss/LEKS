import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SessionProvider, useSession } from "@/state/session";
import { usePalette } from "@/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    "Onest-Regular": require("../assets/fonts/Onest-Regular.ttf"),
    "Onest-Medium": require("../assets/fonts/Onest-Medium.ttf"),
    "Onest-SemiBold": require("../assets/fonts/Onest-SemiBold.ttf"),
    "Onest-Bold": require("../assets/fonts/Onest-Bold.ttf"),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>{fontsLoaded ? <Navigation /> : null}</SessionProvider>
    </GestureHandlerRootView>
  );
}

/** Which screens exist depends on the account state; the router moves between groups by itself. */
function Navigation() {
  const { status } = useSession();
  const p = usePalette();

  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  if (status === "loading") return null;

  return (
    <>
      <StatusBar style={p.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.ground } }}>
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={status === "onboarding"}>
          <Stack.Screen name="(setup)" />
        </Stack.Protected>
        <Stack.Protected guard={status === "locked"}>
          <Stack.Screen name="lock" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
