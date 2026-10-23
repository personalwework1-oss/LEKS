import { RecoveryCode, Username } from "@leks/protocol";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { errorText } from "@/api/http";
import { StrengthMeter } from "@/components/StrengthMeter";
import { AppText, Button, IconButton, Notice, Screen, TextField } from "@/components/ui";
import { passwordStrength } from "@/passwordStrength";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

export default function Login() {
  const p = usePalette();
  const { login, recover } = useSession();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = Username.safeParse(username);
  const recoveryCode = RecoveryCode.safeParse(code);
  const strength = passwordStrength(newPassword, user.success ? user.data : undefined);
  const byCode = mode === "code";
  const canSubmit =
    user.success && !busy && (byCode ? recoveryCode.success && strength.score > 0 : password.length > 0);

  async function submit() {
    if (!canSubmit || !user.success) return;
    setBusy(true);
    setError(null);
    try {
      if (byCode && recoveryCode.success) {
        await recover({ username: user.data, recoveryCode: recoveryCode.data, newPassword });
      } else {
        await login({ username: user.data, password });
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  function switchMode(next: "password" | "code") {
    setMode(next);
    setError(null);
  }

  return (
    <Screen scroll>
      <View style={{ height: 44, justifyContent: "center" }}>
        <IconButton icon="back" label="Назад" onPress={() => router.back()} />
      </View>
      <AppText variant="title" style={{ marginTop: 28 }}>
        {byCode ? "Вход по запасному коду" : "С возвращением"}
      </AppText>
      <AppText muted style={{ marginTop: 10 }}>
        {byCode
          ? "Введите имя пользователя, код, который вы сохранили, и новый пароль."
          : "Войдите на этом телефоне по имени пользователя и паролю."}
      </AppText>

      <View style={{ gap: 16, marginTop: 26 }}>
        <TextField
          label="Имя пользователя"
          prefix="@"
          value={username}
          onChangeText={(text) => setUsername(text.replace(/\s/g, ""))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
        />
        {byCode ? (
          <>
            <TextField
              label="Запасной код"
              value={code}
              onChangeText={(text) => setCode(text.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={24}
            />
            <View style={{ gap: 8 }}>
              <TextField
                label="Новый пароль"
                value={newPassword}
                onChangeText={setNewPassword}
                secure
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
              />
              <StrengthMeter strength={strength} visible={newPassword.length > 0} />
            </View>
            <Notice tone="warning">
              После входа по коду остальные ваши устройства выйдут из аккаунта, а код перестанет действовать.
            </Notice>
          </>
        ) : (
          <TextField
            label="Пароль"
            value={password}
            onChangeText={setPassword}
            secure
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => switchMode(byCode ? "password" : "code")}
        style={{ alignSelf: "flex-start", paddingVertical: 10 }}
      >
        <AppText color={p.accentText} style={{ fontFamily: fonts.semibold, fontSize: 15 }}>
          {byCode ? "Войти по паролю" : "Забыли пароль? Войти по запасному коду"}
        </AppText>
      </Pressable>

      <View style={{ flex: 1, minHeight: 24 }} />

      {error ? (
        <AppText variant="caption" color={p.danger} style={{ marginBottom: 12, textAlign: "center" }} accessibilityLiveRegion="assertive">
          {error}
        </AppText>
      ) : !byCode ? (
        <AppText variant="caption" muted style={{ marginBottom: 12, textAlign: "center" }}>
          Ваши другие устройства останутся в аккаунте.
        </AppText>
      ) : null}
      <Button title="Войти" onPress={submit} disabled={!canSubmit} loading={busy} />
    </Screen>
  );
}
