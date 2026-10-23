import { View } from "react-native";
import type { Strength } from "../passwordStrength";
import { usePalette } from "../theme";
import { AppText } from "./ui";

export function StrengthMeter({ strength, visible }: { strength: Strength; visible: boolean }) {
  const p = usePalette();
  if (!visible) {
    return (
      <AppText variant="caption" muted>
        Не меньше 8 символов
      </AppText>
    );
  }
  const colors = [p.danger, "#B54708", p.accent, p.accent];
  const color = colors[strength.score]!;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 4 }} accessibilityElementsHidden>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: strength.score >= i || (strength.score === 0 && i === 1) ? color : p.disabled }}
          />
        ))}
      </View>
      <AppText variant="caption" color={strength.score === 0 ? p.danger : strength.score >= 2 ? p.accentText : p.textMuted} accessibilityLiveRegion="polite">
        {strength.hint}
      </AppText>
    </View>
  );
}
