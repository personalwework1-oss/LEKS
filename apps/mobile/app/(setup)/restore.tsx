import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { restoreFromBackup } from "@/backup";
import { AppText, Button, Notice, Screen, TextField } from "@/components/ui";
import { dayLabel, clockTime, formatBytes } from "@/format";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

type Phase =
  | { kind: "checking" }
  | { kind: "found"; size: number; updatedAt: number }
  | { kind: "restoring" }
  | { kind: "old_password"; size: number; updatedAt: number }
  | { kind: "done"; chats: number; messages: number };

/** After signing in on a new phone: brings the chats back from the encrypted copy, if there is one. */
export default function RestoreStep() {
  const p = usePalette();
  const { messenger, connection, session } = useSession();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [oldPassword, setOldPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const next = () => router.replace("/lock-setup");

  useEffect(() => {
    if (phase.kind !== "checking" || !messenger || connection !== "online") return;
    let cancelled = false;
    messenger
      .backupInfo()
      .then((info) => {
        if (cancelled) return;
        if (info) setPhase({ kind: "found", ...info });
        else next();
      })
      .catch(() => !cancelled && next());
    return () => {
      cancelled = true;
    };
  }, [messenger, connection, phase.kind]);

  // Without the encryption core or the server there is nothing to check: move on after a while.
  useEffect(() => {
    if (phase.kind !== "checking") return;
    const timer = setTimeout(next, 30_000);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  async function restore(password?: string) {
    if (!messenger || !session) return;
    const before = phase;
    setPhase({ kind: "restoring" });
    setError(null);
    try {
      const result = await restoreFromBackup(messenger, session.accountId, password);
      setPhase({ kind: "done", chats: result?.chats ?? 0, messages: result?.messages ?? 0 });
    } catch (e) {
      const wrongKey = e instanceof Error && /rejected|wrong|no_key|invalid/.test(e.message);
      if (wrongKey && before.kind !== "restoring" && before.kind !== "checking" && before.kind !== "done") {
        setPhase({ kind: "old_password", size: before.size, updatedAt: before.updatedAt });
        setError(password ? "Пароль не подходит к этой копии." : null);
      } else {
        setPhase(before);
        setError("Не удалось восстановить. Проверьте интернет и попробуйте ещё раз.");
      }
    }
  }

  if (phase.kind === "checking" || phase.kind === "restoring") {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <ActivityIndicator color={p.accent} />
          <AppText muted>{phase.kind === "checking" ? "Ищем резервную копию…" : "Восстанавливаем переписку…"}</AppText>
        </View>
      </Screen>
    );
  }

  if (phase.kind === "done") {
    return (
      <Screen>
        <AppText variant="title" style={{ marginTop: 40 }}>
          Переписка восстановлена
        </AppText>
        <AppText muted style={{ marginTop: 10 }}>
          {`Чатов: ${phase.chats}, сообщений: ${phase.messages}. Читать можно сразу. Писать — как только телефоны собеседников подключат это устройство: это происходит само, когда они в сети.`}
        </AppText>
        <View style={{ flex: 1 }} />
        <Button title="Дальше" onPress={next} />
      </Screen>
    );
  }

  const when = `${dayLabel(phase.updatedAt)}, ${clockTime(phase.updatedAt)}`;
  return (
    <Screen scroll>
      <AppText variant="title" style={{ marginTop: 40 }}>
        Найдена резервная копия
      </AppText>
      <AppText muted style={{ marginTop: 10 }}>
        {`Сохранена ${when.toLowerCase()} · ${formatBytes(phase.size)}. Она зашифрована вашим паролем: сервер не может её прочитать.`}
      </AppText>
      {phase.kind === "old_password" ? (
        <View style={{ gap: 16, marginTop: 24 }}>
          <Notice tone="warning">Копия сохранена со старым паролем. Введите пароль, который был тогда.</Notice>
          <TextField label="Прежний пароль" value={oldPassword} onChangeText={setOldPassword} secure autoCapitalize="none" autoCorrect={false} />
        </View>
      ) : null}
      {error ? (
        <AppText color={p.danger} style={{ marginTop: 16 }}>
          {error}
        </AppText>
      ) : null}
      <View style={{ flex: 1, minHeight: 32 }} />
      <View style={{ gap: 10 }}>
        <Button
          title="Восстановить"
          disabled={phase.kind === "old_password" && oldPassword.length === 0}
          onPress={() => void restore(phase.kind === "old_password" ? oldPassword : undefined)}
        />
        <Button title="Начать без старой переписки" variant="ghost" onPress={next} />
      </View>
    </Screen>
  );
}
