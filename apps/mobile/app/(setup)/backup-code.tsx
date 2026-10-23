import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { Icon } from "@/components/Icon";
import { AppText, Button, Screen, StepHeader } from "@/components/ui";
import { BackupCodeCard, BackupCodeError, NoCodeWarning, useBackupCode } from "@/features/BackupCode";
import { fonts, usePalette } from "@/theme";

export default function BackupCodeStep() {
  const p = usePalette();
  const backup = useBackupCode();
  const next = () => router.replace("/lock-setup");
  const created = backup.state.phase === "created";

  return (
    <Screen scroll>
      <StepHeader
        step={2}
        of={3}
        right={
          created ? null : (
            <Pressable accessibilityRole="button" onPress={next} hitSlop={8}>
              <AppText color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                Пропустить
              </AppText>
            </Pressable>
          )
        }
      />

      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center", marginTop: 28 }}>
        <Icon name="key" size={28} color={p.accentText} />
      </View>
      <View style={{ marginTop: 18, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: p.disabled }}>
        <AppText variant="caption" style={{ fontFamily: fonts.semibold }}>
          По желанию
        </AppText>
      </View>
      <AppText variant="title" style={{ marginTop: 10 }}>
        Запасной код на случай, если забудете пароль
      </AppText>
      <AppText muted style={{ marginTop: 10 }}>
        С ним вы войдёте в аккаунт без пароля. Мы показываем код один раз и не храним его.
      </AppText>

      <View style={{ marginTop: 22, gap: 12 }}>
        {backup.state.phase === "created" ? <BackupCodeCard code={backup.state.code} /> : <NoCodeWarning />}
        {backup.state.phase === "error" ? <BackupCodeError message={backup.state.message} /> : null}
      </View>

      <View style={{ flex: 1, minHeight: 24 }} />

      {created ? (
        <Button title="Я сохранил код" onPress={next} />
      ) : (
        <View style={{ gap: 12 }}>
          <Button title="Создать запасной код" onPress={() => void backup.create()} loading={backup.state.phase === "creating"} />
          <Button title="Не сейчас" variant="secondary" onPress={next} />
        </View>
      )}
    </Screen>
  );
}
