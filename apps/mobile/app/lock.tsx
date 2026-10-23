import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { LeksMark } from "@/components/LeksMark";
import { PasscodeDots, PasscodePad } from "@/components/PasscodePad";
import { AppText, Screen } from "@/components/ui";
import { PASSCODE_LENGTH } from "@/lock/passcode";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

export default function LockScreen() {
  const p = usePalette();
  const { lock, biometricLabel, unlockWithPasscode, unlockWithBiometrics, signOut } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState(lock.blockedUntil);
  const [now, setNow] = useState(Date.now());
  const biometric = lock.method === "biometric";

  // Offer Face ID / Touch ID right away when it is the chosen method.
  useEffect(() => {
    if (biometric) void unlockWithBiometrics();
  }, [biometric]);

  // Count down a pause after too many wrong codes.
  useEffect(() => {
    if (blockedUntil <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [blockedUntil, now]);

  const blocked = blockedUntil > now;
  const secondsLeft = Math.ceil((blockedUntil - now) / 1000);

  async function onChange(next: string) {
    setError(false);
    setCode(next);
    if (next.length < PASSCODE_LENGTH) return;
    const result = await unlockWithPasscode(next);
    if (!result.ok) {
      setError(true);
      setCode("");
      if (result.blockedForMs > 0) {
        setNow(Date.now());
        setBlockedUntil(Date.now() + result.blockedForMs);
      }
    }
  }

  function forgot() {
    Alert.alert(
      "Забыли код-пароль?",
      "Можно выйти из аккаунта на этом телефоне и снова войти по паролю. Сообщения, которые хранятся только на этом телефоне, будут удалены.",
      [
        { text: "Отмена", style: "cancel" },
        { text: "Выйти", style: "destructive", onPress: () => void signOut() },
      ],
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: 48 }}>
        <LeksMark size={72} color={p.mark} />
        <AppText variant="heading" style={{ marginTop: 24, fontSize: 22, lineHeight: 28 }}>
          {blocked ? `Попробуйте через ${secondsLeft} с` : error ? "Неверный код-пароль" : "Введите код-пароль"}
        </AppText>
        <View style={{ marginTop: 22 }}>
          <PasscodeDots filled={code.length} error={error} />
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <PasscodePad
        value={code}
        onChange={(next) => void onChange(next)}
        disabled={blocked}
        onBiometric={biometric ? () => void unlockWithBiometrics() : undefined}
        biometricLabel={biometricLabel}
      />
      <Pressable accessibilityRole="button" onPress={forgot} style={{ alignSelf: "center", padding: 14, marginTop: 8 }}>
        <AppText color={p.accentText} style={{ fontFamily: fonts.semibold, fontSize: 15 }}>
          Забыли код-пароль?
        </AppText>
      </Pressable>
    </Screen>
  );
}
