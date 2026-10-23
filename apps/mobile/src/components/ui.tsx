import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { avatarTint, fonts, initials, type Palette, radius, usePalette } from "../theme";
import { Icon, type IconName } from "./Icon";

type Variant = "title" | "heading" | "body" | "bodyStrong" | "label" | "caption" | "overline";

const variants: Record<Variant, { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number }> = {
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5 },
};

export function AppText({
  variant = "body",
  color,
  muted,
  style,
  ...props
}: TextProps & { variant?: Variant; color?: string; muted?: boolean }) {
  const p = usePalette();
  return (
    <Text
      {...props}
      style={[variants[variant], { color: color ?? (muted ? p.textMuted : p.text) }, style]}
    />
  );
}

/** A full screen with safe-area padding, keyboard avoidance and optional scrolling. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  background,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  background?: string;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const content: ViewStyle = {
    flexGrow: 1,
    paddingTop: insets.top + 8,
    paddingBottom: Math.max(insets.bottom, 16) + 8,
    paddingHorizontal: padded ? 24 : 0,
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: background ?? p.ground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {scroll ? (
        <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={content}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "soft" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
}) {
  const p = usePalette();
  const inactive = disabled || loading;
  const look = buttonLook(p, variant, !!inactive && variant === "primary");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.background, borderColor: look.border, opacity: pressed ? 0.85 : 1 },
        variant === "soft" && { height: 44, borderRadius: 12 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={look.text} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={look.text} strokeWidth={2} /> : null}
          <Text style={[styles.buttonText, { color: look.text }, variant === "soft" && { fontSize: 15 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

function buttonLook(p: Palette, variant: string, inactivePrimary: boolean) {
  if (inactivePrimary) return { background: p.disabled, text: p.textMuted, border: "transparent" };
  switch (variant) {
    case "secondary":
      return { background: p.surface, text: p.text, border: p.line };
    case "soft":
      return { background: p.accentSoft, text: p.accentText, border: "transparent" };
    case "ghost":
      return { background: "transparent", text: p.text, border: "transparent" };
    default:
      return { background: p.accent, text: p.onAccent, border: "transparent" };
  }
}

export function TextField({
  label,
  prefix,
  hint,
  hintTone = "muted",
  secure,
  focusedBorder,
  ...input
}: TextInputProps & {
  label: string;
  prefix?: string;
  hint?: string;
  hintTone?: "muted" | "good" | "bad";
  secure?: boolean;
  focusedBorder?: boolean;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const toneColor = hintTone === "good" ? p.accentText : hintTone === "bad" ? p.danger : p.textMuted;
  const active = focused || focusedBorder;
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label">{label}</AppText>
      <View
        style={[
          styles.field,
          { backgroundColor: p.surface, borderColor: active ? p.accent : p.line, borderWidth: active ? 2 : 1 },
        ]}
      >
        {prefix ? <AppText style={{ fontSize: 17 }} muted>{prefix}</AppText> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={p.textSubtle}
          selectionColor={p.accent}
          {...input}
          secureTextEntry={secure && !shown}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, { color: p.text }]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? "Скрыть пароль" : "Показать пароль"}
            hitSlop={8}
            onPress={() => setShown(!shown)}
            style={styles.iconButton}
          >
            <Icon name={shown ? "eyeOff" : "eye"} size={22} color={p.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <AppText variant="caption" color={toneColor} style={{ fontFamily: fonts.medium }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = "surface",
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  tone?: "surface" | "accent" | "soft" | "plain";
}) {
  const p = usePalette();
  const bg = { surface: p.surface, accent: p.accent, soft: p.accentSoft, plain: "transparent" }[tone];
  const fg = { surface: p.text, accent: p.onAccent, soft: p.accentText, plain: p.text }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.roundButton, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={22} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

/** Back button, step label and progress bar used on the sign-up steps. */
export function StepHeader({
  step,
  of,
  onBack,
  right,
}: {
  step: number;
  of: number;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View>
      <View style={styles.stepRow}>
        {onBack ? <IconButton icon="back" label="Назад" onPress={onBack} /> : <View style={{ width: 44 }} />}
        <AppText variant="label" muted style={{ fontFamily: fonts.medium }}>
          Шаг {step} из {of}
        </AppText>
        <View style={{ minWidth: 44, alignItems: "flex-end" }}>{right}</View>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 16 }}>
        {Array.from({ length: of }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? p.accent : p.disabled }} />
        ))}
      </View>
    </View>
  );
}

/** Back button with a centered title, for screens opened from settings. */
export function NavHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ height: 44, flexDirection: "row", alignItems: "center" }}>
      <IconButton icon="back" label="Назад" onPress={onBack} />
      <AppText variant="heading" accessibilityRole="header" style={{ flex: 1, textAlign: "center" }}>
        {title}
      </AppText>
      <View style={{ width: 44 }} />
    </View>
  );
}

export function Notice({ tone = "info", icon, children }: { tone?: "info" | "warning"; icon?: IconName; children: string }) {
  const p = usePalette();
  const warning = tone === "warning";
  return (
    <View style={[styles.notice, { backgroundColor: warning ? p.warningSoft : p.accentSoft }]}>
      <Icon name={icon ?? (warning ? "warning" : "shield")} size={18} color={warning ? p.warningIcon : p.accentText} strokeWidth={2} />
      <AppText variant="caption" color={warning ? p.warningText : p.text} style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
        {children}
      </AppText>
    </View>
  );
}

export function Avatar({ name, seed, size = 54 }: { name: string; seed: string; size?: number }) {
  const p = usePalette();
  const tint = avatarTint(seed, p.scheme);
  return (
    <View
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.background, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: size * 0.36, color: tint.color }}>{initials(name)}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: radius.button,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 17 },
  field: {
    height: 52,
    borderRadius: radius.field,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 6,
    gap: 2,
  },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 17, paddingVertical: 0, paddingRight: 10 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  stepRow: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  notice: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 16 },
});
