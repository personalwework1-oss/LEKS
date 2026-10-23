import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Icon } from "@/components/Icon";
import { AppText, Button, IconButton } from "@/components/ui";
import { fonts, usePalette } from "@/theme";

const filters = ["Все", "Личные", "Группы", "Непрочитанные"] as const;

/**
 * The chat list. Chats appear here once messages are stored on the phone
 * (next build, together with the encryption module); until then it shows
 * the empty state.
 */
export default function Chats() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof filters)[number]>("Все");
  const [query, setQuery] = useState("");

  return (
    <View style={{ flex: 1, backgroundColor: p.scheme === "dark" ? p.ground : p.surface, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6, color: p.text }}>
          Чаты
        </Text>
        <IconButton icon="compose" label="Новый чат" tone="accent" onPress={() => router.push("/contacts")} />
      </View>
      <ConnectionBanner />

      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <View style={{ height: 44, borderRadius: 14, backgroundColor: p.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
          <Icon name="search" size={20} color={p.textMuted} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по чатам"
            placeholderTextColor={p.textSubtle}
            accessibilityLabel="Поиск по чатам"
            style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: p.text, paddingVertical: 0 }}
          />
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6, flexWrap: "wrap" }}>
        {filters.map((label) => {
          const on = label === filter;
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(label)}
              style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: on ? p.accent : p.surfaceMuted }}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? p.onAccent : p.text }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="chats" size={30} color={p.accentText} />
        </View>
        <AppText variant="heading" style={{ textAlign: "center" }}>
          {query ? "Ничего не найдено" : "Здесь появятся ваши чаты"}
        </AppText>
        <AppText muted style={{ textAlign: "center" }}>
          Найдите человека по имени пользователя и начните переписку.
        </AppText>
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <Button title="Найти собеседника" onPress={() => router.push("/contacts")} />
        </View>
      </View>
    </View>
  );
}
