import { type Href, router, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/Icon";
import { fonts, usePalette } from "@/theme";

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const tabs: Record<string, { title: string; icon: IconName; href: Href }> = {
  index: { title: "Чаты", icon: "chats", href: "/" },
  contacts: { title: "Контакты", icon: "person", href: "/contacts" },
  settings: { title: "Настройки", icon: "settings", href: "/settings" },
};

/** Bottom bar from the design: three sections; the wallet is added as a fourth later. */
function TabBar({ state }: BottomTabBarProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
        paddingHorizontal: 12,
        backgroundColor: p.scheme === "dark" ? "#0F141F" : p.surface,
        borderTopWidth: 1,
        borderTopColor: p.separator,
      }}
    >
      {state.routes.map((route, index) => {
        const tab = tabs[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const color = focused ? p.accentText : p.textMuted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={() => {
              if (!focused) router.navigate(tab.href);
            }}
            style={{ flex: 1, alignItems: "center", gap: 3, paddingVertical: 2 }}
          >
            <Icon name={tab.icon} size={26} color={color} filled={focused && tab.icon === "chats"} strokeWidth={focused ? 2 : 1.8} />
            <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color }}>{tab.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="contacts" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
