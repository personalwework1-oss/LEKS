import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";
import { PASSCODE_LENGTH } from "../lock/passcode";
import { fonts, usePalette } from "../theme";
import { Icon } from "./Icon";

const LETTERS: Record<string, string> = {
  "2": "ABC",
  "3": "DEF",
  "4": "GHI",
  "5": "JKL",
  "6": "MNO",
  "7": "PQRS",
  "8": "TUV",
  "9": "WXYZ",
};

export function PasscodeDots({ filled, error }: { filled: number; error?: boolean }) {
  const p = usePalette();
  const color = error ? p.danger : p.accent;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Введено цифр: ${filled} из ${PASSCODE_LENGTH}`}
      style={{ flexDirection: "row", gap: 18, height: 16, justifyContent: "center" }}
    >
      {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
        <View
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: i < filled || error ? color : p.textSubtle,
            backgroundColor: i < filled ? color : "transparent",
          }}
        />
      ))}
    </View>
  );
}

/** Digit keypad; `onBiometric` adds the Face ID / Touch ID key in the bottom-left corner. */
export function PasscodePad({
  value,
  onChange,
  disabled,
  onBiometric,
  biometricLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  onBiometric?: () => void;
  biometricLabel?: string | null;
}) {
  const p = usePalette();
  const press = (digit: string) => {
    if (disabled || value.length >= PASSCODE_LENGTH) return;
    void Haptics.selectionAsync();
    onChange(value + digit);
  };
  const key = (digit: string) => (
    <Pressable
      key={digit}
      accessibilityRole="button"
      accessibilityLabel={digit}
      disabled={disabled}
      onPress={() => press(digit)}
      style={({ pressed }) => ({
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: pressed ? p.accentSoft : p.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.medium, fontSize: 30, lineHeight: 34, color: p.text }}>{digit}</Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.2, color: p.textMuted, height: 12 }}>
        {LETTERS[digit] ?? ""}
      </Text>
    </Pressable>
  );
  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
  ];
  return (
    <View style={{ gap: 18, alignSelf: "center" }}>
      {rows.map((row) => (
        <View key={row.join("")} style={{ flexDirection: "row", gap: 28 }}>
          {row.map(key)}
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 28 }}>
        {onBiometric ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Войти: ${biometricLabel ?? "биометрия"}`}
            onPress={onBiometric}
            style={{ width: 76, height: 76, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="faceId" size={34} color={p.accentText} strokeWidth={1.6} />
          </Pressable>
        ) : (
          <View style={{ width: 76 }} />
        )}
        {key("0")}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Стереть"
          disabled={disabled || value.length === 0}
          onPress={() => onChange(value.slice(0, -1))}
          style={{ width: 76, height: 76, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="backspace" size={30} color={p.text} />
        </Pressable>
      </View>
    </View>
  );
}
