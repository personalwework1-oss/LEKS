import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackupReminder } from "@/components/BackupReminder";
import { ChatRow } from "@/components/ChatRow";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Icon } from "@/components/Icon";
import { AppText, Avatar, Button, IconButton } from "@/components/ui";
import { chatFace, useConversations, usePeople } from "@/messaging/hooks";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Filter = "all" | "unread";

export default function Chats() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { messenger } = useSession();
  const { data: conversations, ready } = useConversations();
  const people = usePeople();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const archived = conversations.filter((c) => c.archived);
  const active = conversations.filter((c) => !c.archived);
  const unreadChats = active.filter((c) => c.unread > 0).length;
  const needle = query.trim().toLowerCase();
  // Searching looks in the archive too.
  const shown = (needle ? conversations : active).filter(
    (c) =>
      (filter === "all" || c.unread > 0) &&
      (!needle || chatFace(people, c).title.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle) || (c.username ?? "").includes(needle.replace(/^@/, ""))),
  );

  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "Все" },
    { id: "unread", label: "Непрочитанные", count: unreadChats },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: p.scheme === "dark" ? p.ground : p.surface, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6, color: p.text }}>
          Чаты
        </Text>
        <IconButton icon="compose" label="Новый чат" tone="accent" onPress={() => router.push("/contacts")} />
      </View>
      <ConnectionBanner />
      <BackupReminder />

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

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}>
        {chips.map((chip) => {
          const on = chip.id === filter;
          return (
            <Pressable
              key={chip.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(chip.id)}
              style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? p.accent : p.surfaceMuted }}
            >
              <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? p.onAccent : p.text }}>{chip.label}</Text>
              {chip.count ? (
                <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: on ? p.onAccent : p.accent, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: on ? p.accent : p.onAccent }}>{chip.count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {shown.length > 0 || archived.length > 0 ? (
        <FlatList
          data={shown}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ChatRow chat={item} people={people} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            archived.length > 0 && !needle && filter === "all" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/archive")}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
              >
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: p.surfaceMuted, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="archive" size={24} color={p.textMuted} strokeWidth={2} />
                </View>
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  Архив
                </AppText>
                <AppText muted>{archived.length}</AppText>
              </Pressable>
            ) : undefined
          }
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="chats" size={30} color={p.accentText} />
          </View>
          <AppText variant="heading" style={{ textAlign: "center" }}>
            {needle || filter === "unread" ? "Ничего не найдено" : "Здесь появятся ваши чаты"}
          </AppText>
          {!messenger && ready === false ? (
            <AppText muted style={{ textAlign: "center" }}>
              Шифрование запускается…
            </AppText>
          ) : (
            <AppText muted style={{ textAlign: "center" }}>
              Найдите человека по имени пользователя и начните переписку.
            </AppText>
          )}
          <View style={{ alignSelf: "stretch", marginTop: 8 }}>
            <Button title="Найти собеседника" onPress={() => router.push("/contacts")} />
          </View>
        </View>
      )}
    </View>
  );
}
