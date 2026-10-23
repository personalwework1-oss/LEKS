import { router } from "expo-router";
import { View } from "react-native";
import { AppText, Button, NavHeader, Screen } from "@/components/ui";
import { LockChooser } from "@/features/LockChooser";
import { useSession } from "@/state/session";

export default function LockSettings() {
  const { lock, setLock } = useSession();
  return (
    <Screen scroll>
      <NavHeader title="Блокировка приложения" onBack={() => router.back()} />
      <AppText muted style={{ marginTop: 16 }}>
        {lock.method === "none"
          ? "Сейчас приложение открывается без проверки."
          : "Блокировка включена. Можно выбрать другой способ или выключить её."}
      </AppText>
      <LockChooser onDone={() => router.back()} onSkip={() => router.back()} skipTitle="Отмена" />
      {lock.method !== "none" ? (
        <View style={{ marginTop: 8 }}>
          <Button
            title="Выключить блокировку"
            variant="secondary"
            onPress={async () => {
              await setLock("none");
              router.back();
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
