import { router } from "expo-router";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatRow } from "@/components/ChatRow";
import { AppText, NavHeader } from "@/components/ui";
import { useConversations, usePeople } from "@/messaging/hooks";
import { usePalette } from "@/theme";

/** Chats moved out of the main list; a new message brings one back unless it is muted. */
export default function Archive() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { data } = useConversations();
  const people = usePeople();
  const archived = data.filter((c) => c.archived);
  return (
    <View style={{ flex: 1, backgroundColor: p.scheme === "dark" ? p.ground : p.surface, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 8 }}>
        <NavHeader title="Архив" onBack={() => router.back()} />
      </View>
      <AppText variant="caption" muted style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        Чат вернётся в общий список, когда придёт новое сообщение (если он не без звука). Удерживайте, чтобы вернуть вручную.
      </AppText>
      <FlatList data={archived} keyExtractor={(c) => c.id} renderItem={({ item }) => <ChatRow chat={item} people={people} />} />
    </View>
  );
}
