import { router } from "expo-router";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsGroup } from "@/components/SettingsList";
import { AppText, Avatar } from "@/components/ui";
import { APP_VERSION } from "@/config";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

export default function Settings() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { session, lock, biometricLabel, signOut } = useSession();
  if (!session) return null;

  const lockValue = lock.method === "none" ? "Выкл." : lock.method === "biometric" ? (biometricLabel ?? "Биометрия") : "Код-пароль";

  function confirmSignOut() {
    Alert.alert(
      "Выйти из аккаунта на этом телефоне?",
      "Чтобы вернуться, понадобится пароль. Сообщения, которые хранятся только на этом телефоне, будут удалены.",
      [
        { text: "Отмена", style: "cancel" },
        { text: "Выйти", style: "destructive", onPress: () => void signOut() },
      ],
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.ground }} contentContainerStyle={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 32 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6, color: p.text, marginHorizontal: 4, marginBottom: 12 }}>
        Настройки
      </Text>

      <View style={{ padding: 16, borderRadius: 20, backgroundColor: p.surface, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar name={session.displayName} seed={session.accountId} size={64} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" style={{ fontFamily: fonts.bold, fontSize: 19, lineHeight: 24 }}>
            {session.displayName}
          </AppText>
          <AppText muted style={{ fontSize: 15 }}>
            @{session.username}
          </AppText>
        </View>
      </View>

      <SettingsGroup title="Приватность" rows={[{ title: "Блокировка приложения", value: lockValue, onPress: () => router.push("/settings/lock") }]} />
      <SettingsGroup
        title="Безопасность"
        rows={[
          { title: "Пароль", value: "Изменить", onPress: () => router.push("/settings/password") },
          { title: "Запасной код", onPress: () => router.push("/settings/backup-code") },
        ]}
      />
      <SettingsGroup title="Аккаунт" rows={[{ title: "Выйти на этом телефоне", destructive: true, onPress: confirmSignOut }]} />

      <AppText variant="caption" muted style={{ textAlign: "center", marginTop: 24 }}>
        LEKS {APP_VERSION}
      </AppText>
    </ScrollView>
  );
}
