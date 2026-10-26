import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { RealtimeError } from "@/api/realtime";
import { backupNow, rememberBackupKey, restoreFromBackup } from "@/backup";
import { SettingsGroup } from "@/components/SettingsList";
import { AppText, Button, NavHeader, Notice, Screen, TextField } from "@/components/ui";
import { signInSecret } from "@/crypto/passwordKeys";
import { clockTime, dayLabel, formatBytes } from "@/format";
import { useSession } from "@/state/session";
import { type BackupSettings, secure } from "@/storage/secure";
import { usePalette } from "@/theme";

/** The encrypted copy of the chats on the server: when it was saved, saving now, the daily schedule. */
export default function BackupSettingsScreen() {
  const p = usePalette();
  const { messenger, realtime, session } = useSession();
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [info, setInfo] = useState<{ size: number; updatedAt: number } | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "restore" | "enable" | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const refresh = useCallback(() => {
    void secure.loadBackup().then(setSettings);
    void messenger?.backupInfo().then(setInfo, () => setInfo(undefined));
  }, [messenger]);
  useFocusEffect(refresh);

  async function save() {
    if (!messenger) return;
    setBusy("save");
    setMessage(null);
    try {
      const result = await backupNow(messenger);
      setMessage({ text: `Сохранено: чатов ${result.chats}, сообщений ${result.messages}.` });
      refresh();
    } catch (e) {
      const detail = e instanceof Error ? ` (${e.message.slice(0, 80)})` : "";
      setMessage({ text: `Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.${detail}`, bad: true });
    } finally {
      setBusy(null);
    }
  }

  /** For phones signed in before backups existed: the password is needed once, and checked with the server. */
  async function enable() {
    if (!realtime || !session || !password) return;
    setBusy("enable");
    setMessage(null);
    try {
      const secret = await signInSecret(session.username, password);
      try {
        await realtime.request({ type: "change_password", currentPassword: secret, newPassword: secret }, "password_changed");
      } catch (e) {
        if (!(e instanceof RealtimeError && e.code === "wrong_password") || secret === password) throw e;
        // An older account: switches it to the new sign-in at the same time.
        await realtime.request({ type: "change_password", currentPassword: password, newPassword: secret }, "password_changed");
      }
      await rememberBackupKey(session.accountId, password);
      setPassword("");
      await save();
    } catch (e) {
      const code = e instanceof RealtimeError ? e.code : "";
      setMessage({
        text: code === "wrong_password" ? "Неверный пароль." : code === "login_locked" ? "Слишком много попыток. Попробуйте через 15 минут." : "Не получилось. Проверьте интернет.",
        bad: true,
      });
      setBusy(null);
    }
  }

  function confirmRestore() {
    Alert.alert("Восстановить из копии?", "Сообщения из копии добавятся к тем, что уже есть на этом телефоне.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Восстановить",
        onPress: async () => {
          if (!messenger || !session) return;
          setBusy("restore");
          setMessage(null);
          try {
            const result = await restoreFromBackup(messenger, session.accountId);
            setMessage({ text: result ? `Восстановлено сообщений: ${result.messages}.` : "Копии пока нет." });
          } catch (e) {
            const detail = e instanceof Error ? ` (${e.message.slice(0, 80)})` : "";
            setMessage({ text: `Не удалось восстановить: копия сохранена с другим паролем или нет связи.${detail}`, bad: true });
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  async function toggleAuto() {
    if (!settings) return;
    const next = { ...settings, auto: !settings.auto };
    await secure.saveBackup(next);
    setSettings(next);
  }

  const status =
    info === undefined
      ? "Проверяем…"
      : info === null
        ? "Копии пока нет"
        : `${dayLabel(info.updatedAt)}, ${clockTime(info.updatedAt)} · ${formatBytes(info.size)}`;

  return (
    <Screen scroll>
      <NavHeader title="Резервная копия" onBack={() => router.back()} />
      <AppText muted style={{ marginTop: 16 }}>
        Копия переписки хранится на сервере зашифрованной вашим паролем. Ни мы, ни кто-то другой не можем её прочитать. Она нужна, чтобы вернуть чаты на новом
        телефоне или после переустановки.
      </AppText>

      <SettingsGroup
        title="Последняя копия"
        rows={[
          { title: "Сохранена", value: status },
          ...(settings?.key ? [{ title: "Каждый день сама", value: settings.auto ? "Вкл." : "Выкл.", onPress: () => void toggleAuto() }] : []),
        ]}
      />

      {settings && !settings.key ? (
        <View style={{ gap: 14, marginTop: 22 }}>
          <Notice>Чтобы включить копию, введите пароль от аккаунта. Он останется на этом телефоне.</Notice>
          <TextField label="Пароль" value={password} onChangeText={setPassword} secure autoCapitalize="none" autoCorrect={false} textContentType="password" />
          <Button title="Включить резервную копию" onPress={() => void enable()} disabled={!password} loading={busy === "enable"} />
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 22 }}>
          <Button title="Сохранить сейчас" onPress={() => void save()} loading={busy === "save"} disabled={!!busy || !messenger} />
          {info ? <Button title="Восстановить из копии" variant="ghost" onPress={confirmRestore} loading={busy === "restore"} disabled={!!busy} /> : null}
        </View>
      )}

      {message ? (
        <AppText variant="caption" color={message.bad ? p.danger : p.accentText} style={{ marginTop: 14, textAlign: "center" }} accessibilityLiveRegion="polite">
          {message.text}
        </AppText>
      ) : null}

      <AppText variant="caption" muted style={{ marginTop: 22 }}>
        Фото и файлы в копии — ссылками: на новом телефоне они скачиваются снова, пока хранятся на сервере (30 дней). Если вы забудете пароль и войдёте по
        запасному коду, старую копию можно будет открыть только прежним паролем.
      </AppText>
    </Screen>
  );
}
