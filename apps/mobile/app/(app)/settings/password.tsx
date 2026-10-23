import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { RealtimeError } from "@/api/realtime";
import { StrengthMeter } from "@/components/StrengthMeter";
import { AppText, Button, NavHeader, Screen, TextField } from "@/components/ui";
import { passwordStrength } from "@/passwordStrength";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

export default function ChangePassword() {
  const p = usePalette();
  const { realtime, session } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(next, session?.username);
  const canSubmit = current.length > 0 && strength.score > 0 && !busy && !!realtime;

  async function submit() {
    if (!canSubmit || !realtime) return;
    setBusy(true);
    setError(null);
    try {
      await realtime.request({ type: "change_password", currentPassword: current, newPassword: next }, "password_changed");
      setDone(true);
    } catch (e) {
      const code = e instanceof RealtimeError ? e.code : "";
      setError(
        code === "wrong_password"
          ? "Текущий пароль неверный."
          : code === "login_locked"
            ? "Слишком много попыток. Попробуйте через 15 минут."
            : code === "weak_password"
              ? "Новый пароль слишком простой."
              : "Не удалось сменить пароль. Проверьте интернет.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <NavHeader title="Пароль" onBack={() => router.back()} />
        <AppText variant="title" style={{ marginTop: 32 }}>
          Пароль изменён
        </AppText>
        <AppText muted style={{ marginTop: 10 }}>
          Новый пароль понадобится при входе на новом телефоне. На этом телефоне ничего вводить не нужно.
        </AppText>
        <View style={{ flex: 1 }} />
        <Button title="Готово" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <NavHeader title="Сменить пароль" onBack={() => router.back()} />
      <View style={{ gap: 16, marginTop: 24 }}>
        <TextField label="Текущий пароль" value={current} onChangeText={setCurrent} secure autoCapitalize="none" autoComplete="current-password" textContentType="password" />
        <View style={{ gap: 8 }}>
          <TextField label="Новый пароль" value={next} onChangeText={setNext} secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
          <StrengthMeter strength={strength} visible={next.length > 0} />
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      {error ? (
        <AppText variant="caption" color={p.danger} style={{ textAlign: "center", marginBottom: 12 }} accessibilityLiveRegion="assertive">
          {error}
        </AppText>
      ) : null}
      <Button title="Сменить пароль" onPress={submit} disabled={!canSubmit} loading={busy} />
    </Screen>
  );
}
