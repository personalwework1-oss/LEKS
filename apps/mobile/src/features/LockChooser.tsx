import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../components/Icon";
import { PasscodeDots, PasscodePad } from "../components/PasscodePad";
import { AppText, Button } from "../components/ui";
import { PASSCODE_LENGTH } from "../lock/passcode";
import { useSession } from "../state/session";
import { fonts, radius, usePalette } from "../theme";

type Method = "biometric" | "passcode";

/**
 * Choose Face ID / Touch ID or a 4-digit code, then enter the code twice
 * (it is also Face ID's fallback). Calls `onDone` once the lock is saved.
 */
export function LockChooser({ onDone, onSkip, skipTitle }: { onDone: () => void; onSkip: () => void; skipTitle: string }) {
  const p = usePalette();
  const { biometricLabel, setLock } = useSession();
  const [canBiometric, setCanBiometric] = useState(false);
  const [method, setMethod] = useState<Method>("passcode");
  const [phase, setPhase] = useState<"choose" | "enter" | "confirm">("choose");
  const [first, setFirst] = useState("");
  const [code, setCode] = useState("");
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      setCanBiometric(ok);
      if (ok) setMethod("biometric");
    })().catch(() => setCanBiometric(false));
  }, []);

  async function onCode(next: string) {
    setCode(next);
    setMismatch(false);
    if (next.length < PASSCODE_LENGTH) return;
    if (phase === "enter") {
      setFirst(next);
      setCode("");
      setPhase("confirm");
      return;
    }
    if (next !== first) {
      setMismatch(true);
      setCode("");
      setFirst("");
      setPhase("enter");
      return;
    }
    await setLock(method, next);
    onDone();
  }

  if (phase !== "choose") {
    return (
      <View style={{ flex: 1, alignItems: "center" }}>
        <AppText variant="title" style={{ marginTop: 24, fontSize: 24, lineHeight: 30, textAlign: "center" }}>
          {phase === "enter" ? "Придумайте код-пароль" : "Повторите код-пароль"}
        </AppText>
        <AppText muted style={{ marginTop: 8, textAlign: "center" }}>
          {mismatch
            ? "Коды не совпали. Попробуйте ещё раз."
            : method === "biometric"
              ? `Он понадобится, если ${biometricLabel ?? "биометрия"} не сработает.`
              : "4 цифры, которые вы будете вводить при каждом открытии."}
        </AppText>
        <View style={{ marginTop: 28 }}>
          <PasscodeDots filled={code.length} error={mismatch} />
        </View>
        <View style={{ flex: 1, minHeight: 24 }} />
        <PasscodePad value={code} onChange={(next) => void onCode(next)} />
        <Button title="Отмена" variant="ghost" onPress={() => { setPhase("choose"); setCode(""); setFirst(""); }} />
      </View>
    );
  }

  const options: { id: Method; title: string; text: string; available: boolean }[] = [
    {
      id: "biometric",
      title: biometricLabel ?? "Face ID или Touch ID",
      text: canBiometric
        ? "Вход по лицу или отпечатку. Если не сработает, введёте код-пароль."
        : "Не настроено на этом телефоне. Включите в настройках телефона.",
      available: canBiometric,
    },
    { id: "passcode", title: "Код-пароль", text: "4 цифры при каждом открытии приложения.", available: true },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View accessibilityRole="radiogroup" style={{ gap: 12, marginTop: 26 }}>
        {options.map((option) => {
          const on = method === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !option.available }}
              disabled={!option.available}
              onPress={() => setMethod(option.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                padding: 16,
                borderRadius: 18,
                backgroundColor: p.surface,
                borderWidth: 2,
                borderColor: on ? p.accent : p.surface,
                opacity: option.available ? 1 : 0.55,
              }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}>
                {option.id === "biometric" ? (
                  <Icon name="faceId" size={26} color={p.accentText} />
                ) : (
                  <AppText color={p.accentText} style={{ fontFamily: fonts.bold, fontSize: 20, letterSpacing: 2 }}>
                    ••••
                  </AppText>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" style={{ fontSize: 17 }}>
                  {option.title}
                </AppText>
                <AppText variant="caption" muted style={{ fontSize: 14, lineHeight: 20, marginTop: 2 }}>
                  {option.text}
                </AppText>
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: radius.pill,
                  borderWidth: 2,
                  borderColor: on ? p.accent : p.textSubtle,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: p.accent }} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <AppText variant="caption" muted style={{ marginTop: 18, fontSize: 14, lineHeight: 20 }}>
        Блокировка работает только на этом телефоне и на сервер не передаётся.
      </AppText>
      <View style={{ flex: 1, minHeight: 24 }} />
      <View style={{ gap: 12 }}>
        <Button title="Включить" onPress={() => setPhase("enter")} />
        <Button title={skipTitle} variant="ghost" onPress={onSkip} />
      </View>
    </View>
  );
}
