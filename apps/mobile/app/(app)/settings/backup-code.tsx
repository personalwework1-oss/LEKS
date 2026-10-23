import { router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { AppText, Button, NavHeader, Notice, Screen } from "@/components/ui";
import { BackupCodeCard, BackupCodeError, useBackupCode } from "@/features/BackupCode";
import { useSession } from "@/state/session";

/**
 * Create a new backup code (the old one stops working) or delete it.
 * The server keeps only a hash, so the app cannot show an existing code again.
 */
export default function BackupCodeSettings() {
  const { realtime } = useSession();
  const backup = useBackupCode();
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    Alert.alert("Удалить запасной код?", "Если вы забудете пароль, восстановить аккаунт будет нельзя.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await realtime?.request({ type: "delete_recovery_code" }, "recovery_code_deleted");
            setDeleted(true);
          } catch {
            setError("Не удалось удалить код. Проверьте интернет.");
          }
        },
      },
    ]);
  }

  const created = backup.state.phase === "created";

  return (
    <Screen scroll>
      <NavHeader title="Запасной код" onBack={() => router.back()} />
      <AppText muted style={{ marginTop: 16 }}>
        Код нужен, только если вы забудете пароль. Мы храним не сам код, а его отпечаток, поэтому показать старый код нельзя — можно создать новый.
      </AppText>

      <View style={{ marginTop: 20, gap: 12 }}>
        {created && backup.state.phase === "created" ? (
          <>
            <BackupCodeCard code={backup.state.code} />
            <Notice tone="warning">Старый код больше не действует. Сохраните новый в надёжном месте и никому его не отправляйте.</Notice>
          </>
        ) : null}
        {deleted ? <Notice tone="warning">Запасной код удалён. Создать новый можно в любой момент.</Notice> : null}
        {backup.state.phase === "error" ? <BackupCodeError message={backup.state.message} /> : null}
        {error ? <BackupCodeError message={error} /> : null}
      </View>

      <View style={{ flex: 1, minHeight: 24 }} />
      <View style={{ gap: 12 }}>
        {created ? (
          <Button title="Я сохранил код" onPress={() => router.back()} />
        ) : (
          <Button
            title="Создать новый код"
            loading={backup.state.phase === "creating"}
            onPress={() => {
              setDeleted(false);
              void backup.create();
            }}
          />
        )}
        {!created && !deleted ? <Button title="Удалить запасной код" variant="ghost" onPress={confirmDelete} /> : null}
      </View>
    </Screen>
  );
}
