import { Username } from "@leks/protocol";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { errorText } from "@/api/http";
import { StrengthMeter } from "@/components/StrengthMeter";
import { AppText, Button, Screen, StepHeader, TextField } from "@/components/ui";
import { passwordStrength } from "@/passwordStrength";
import { http, useSession } from "@/state/session";
import { usePalette } from "@/theme";

type Availability = "idle" | "checking" | "free" | "taken" | "invalid" | "unknown";

export default function Register() {
  const p = usePalette();
  const { register } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = Username.safeParse(username);

  // Check the username a moment after the person stops typing.
  useEffect(() => {
    if (!username) return setAvailability("idle");
    if (!normalized.success) return setAvailability("invalid");
    setAvailability("checking");
    let cancelled = false;
    const timer = setTimeout(() => {
      http
        .usernameAvailable(normalized.data)
        .then((result) => !cancelled && setAvailability(result.available ? "free" : "taken"))
        .catch(() => !cancelled && setAvailability("unknown"));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, normalized.success, normalized.success ? normalized.data : null]);

  const strength = passwordStrength(password, normalized.success ? normalized.data : undefined);
  const canSubmit =
    displayName.trim().length > 0 && normalized.success && availability !== "taken" && strength.score > 0 && !busy;

  const usernameHint = {
    idle: { text: "3–32 символа: латинские буквы, цифры и _", tone: "muted" as const },
    checking: { text: "Проверяем…", tone: "muted" as const },
    free: { text: "Имя свободно — по нему вас найдут", tone: "good" as const },
    taken: { text: "Это имя уже занято", tone: "bad" as const },
    invalid: { text: "Только латинские буквы, цифры и _, от 3 до 32 символов", tone: "bad" as const },
    unknown: { text: "Не удалось проверить имя — проверим при создании", tone: "muted" as const },
  }[availability];

  async function submit() {
    if (!canSubmit || !normalized.success) return;
    setBusy(true);
    setError(null);
    try {
      await register({ username: normalized.data, displayName: displayName.trim(), password });
      // The account exists now; the router switches to the setup steps by itself.
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <StepHeader step={1} of={3} onBack={() => router.back()} />
      <AppText variant="title" style={{ marginTop: 26 }}>
        Создайте аккаунт
      </AppText>
      <AppText muted style={{ marginTop: 8 }}>
        Номер телефона не нужен.
      </AppText>

      <View style={{ gap: 16, marginTop: 22 }}>
        <TextField
          label="Имя в профиле"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={64}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
        <TextField
          label="Имя пользователя"
          prefix="@"
          value={username}
          onChangeText={(text) => setUsername(text.replace(/\s/g, ""))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="username"
          maxLength={32}
          hint={usernameHint.text}
          hintTone={usernameHint.tone}
        />
        <View style={{ gap: 8 }}>
          <TextField
            label="Пароль"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Не меньше 8 символов"
          />
          <StrengthMeter strength={strength} visible={password.length > 0} />
        </View>
      </View>

      <View style={{ flex: 1, minHeight: 24 }} />

      {error ? (
        <AppText variant="caption" color={p.danger} style={{ marginBottom: 12, textAlign: "center" }} accessibilityLiveRegion="assertive">
          {error}
        </AppText>
      ) : null}
      <AppText variant="caption" muted style={{ marginBottom: 12, textAlign: "center" }}>
        Пароль нужен только для входа на новом телефоне. Сбросить его через SMS нельзя — запомните его.
      </AppText>
      <Button title="Продолжить" onPress={submit} disabled={!canSubmit} loading={busy} />
    </Screen>
  );
}
