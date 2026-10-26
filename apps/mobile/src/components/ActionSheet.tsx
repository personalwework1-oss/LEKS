import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, usePalette } from "../theme";
import { Icon, type IconName } from "./Icon";
import { AppText } from "./ui";

export interface SheetAction {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  /** Shown with a check mark (the current choice). */
  selected?: boolean;
  onPress: () => void;
}

/**
 * The app's own bottom sheet for menus (instead of the system dialog): an
 * optional header, then actions with icons, and "Отмена".
 */
export function ActionSheet({
  visible,
  onClose,
  title,
  subtitle,
  header,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  header?: ReactNode;
  actions: SheetAction[];
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, damping: 22, stiffness: 260, mass: 0.9 }).start();
  }, [visible, rise]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть меню" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(8,12,22,0.5)", justifyContent: "flex-end" }}>
        <Animated.View
          style={{
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }],
            paddingHorizontal: 10,
            paddingBottom: Math.max(insets.bottom, 10),
            gap: 8,
          }}
        >
          <Pressable onPress={() => undefined} style={{ backgroundColor: p.surface, borderRadius: 24, overflow: "hidden", paddingTop: 8 }}>
            <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: p.line, marginBottom: 8 }} />
            {header}
            {title ? (
              <View style={{ paddingHorizontal: 20, paddingTop: header ? 4 : 6, paddingBottom: 10 }}>
                <AppText variant="bodyStrong" numberOfLines={1} style={{ textAlign: "center" }}>
                  {title}
                </AppText>
                {subtitle ? (
                  <AppText variant="caption" muted style={{ textAlign: "center", marginTop: 2 }}>
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            {actions.map((action, i) => {
              const color = action.danger ? p.danger : p.text;
              return (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  accessibilityState={action.selected ? { selected: true } : undefined}
                  onPress={action.onPress}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    paddingHorizontal: 18,
                    minHeight: 58,
                    borderTopWidth: i === 0 ? 1 : 0,
                    borderTopColor: p.separator,
                    backgroundColor: pressed ? p.surfaceMuted : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: action.danger ? (p.scheme === "dark" ? "rgba(240,90,80,0.16)" : "#FDECEA") : p.accentSoft,
                    }}
                  >
                    <Icon name={action.icon} size={19} color={action.danger ? p.danger : p.accentText} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1, paddingVertical: 8 }}>
                    <AppText color={color} style={{ fontFamily: fonts.medium }}>
                      {action.label}
                    </AppText>
                    {action.hint ? (
                      <AppText variant="caption" muted>
                        {action.hint}
                      </AppText>
                    ) : null}
                  </View>
                  {action.selected ? <Icon name="check" size={20} color={p.accentText} strokeWidth={2.4} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({ height: 56, borderRadius: 18, backgroundColor: pressed ? p.surfaceMuted : p.surface, alignItems: "center", justifyContent: "center" })}
          >
            <AppText variant="bodyStrong" color={p.accentText}>
              Отмена
            </AppText>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
