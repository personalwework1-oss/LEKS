import { ActivityIndicator, View } from "react-native";
import { useSession } from "../state/session";
import { usePalette } from "../theme";
import { AppText } from "./ui";

/** A quiet line under the title while the phone is not connected to the server. */
export function ConnectionBanner() {
  const p = usePalette();
  const { connection } = useSession();
  if (connection === "online") return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 6 }}>
      <ActivityIndicator size="small" color={p.textMuted} />
      <AppText variant="caption" muted>
        {connection === "connecting" ? "Подключение…" : "Нет связи. Ждём интернет…"}
      </AppText>
    </View>
  );
}
