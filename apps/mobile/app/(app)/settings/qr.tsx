import { router } from "expo-router";
import { Share, View } from "react-native";
import { QrCode } from "@/components/QrCode";
import { AppText, Avatar, Button, NavHeader, Screen } from "@/components/ui";
import { profileLink } from "@/features/profileLink";
import { usePeople } from "@/messaging/hooks";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

/** My QR code: someone scans it (with LEKS or any camera) and can write to me right away. */
export default function MyQr() {
  const p = usePalette();
  const { session } = useSession();
  const people = usePeople();
  if (!session) return null;
  const me = people.get(session.accountId);
  const link = profileLink(session.username);
  return (
    <Screen scroll>
      <NavHeader title="Мой QR-код" onBack={() => router.back()} />
      <View style={{ alignItems: "center", marginTop: 24, padding: 24, borderRadius: 24, backgroundColor: p.surface, gap: 14 }}>
        <Avatar name={me?.displayName ?? session.displayName} seed={session.accountId} size={64} photo={me?.photo} />
        <AppText variant="heading">{me?.displayName ?? session.displayName}</AppText>
        <AppText muted>@{session.username}</AppText>
        <View style={{ padding: 12, borderRadius: 16, backgroundColor: "#FFFFFF" }}>
          <QrCode value={link} size={220} />
        </View>
        <AppText variant="caption" muted style={{ textAlign: "center" }}>
          Покажите код — его можно отсканировать в LEKS или обычной камерой. В коде только ваше имя пользователя.
        </AppText>
      </View>
      <View style={{ gap: 10, marginTop: 20 }}>
        <Button title="Поделиться ссылкой" icon="share" onPress={() => void Share.share({ message: `Пишите мне в LEKS: ${link}` })} />
        <Button title="Сканировать чужой код" variant="ghost" onPress={() => router.push("/scan")} />
      </View>
    </Screen>
  );
}
