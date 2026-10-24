import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { AppText, Avatar, IconButton } from "@/components/ui";
import { clockTime, dayKey, dayLabel } from "@/format";
import { useConversation, useMessages } from "@/messaging/hooks";
import type { Message } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Row = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: Message };

export default function Chat() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { messenger, connection } = useSession();
  const { data: chat } = useConversation(id);
  const { data: messages } = useMessages(id);
  const [draft, setDraft] = useState("");

  // Opening the chat marks it read; so does every new message while it is open.
  useEffect(() => {
    if (messenger && chat && chat.unread > 0) void messenger.markRead(id);
  }, [messenger, chat?.unread, id]);

  // Newest first, with a day label after each day's messages (the list is drawn upside down).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      out.push({ kind: "message", key: message.id, message });
      const older = messages[i - 1];
      if (!older || dayKey(older.sentAt) !== dayKey(message.sentAt)) {
        out.push({ kind: "day", key: `day-${dayKey(message.sentAt)}`, label: dayLabel(message.sentAt) });
      }
    }
    return out;
  }, [messages]);

  const title = chat?.title ?? "Чат";
  const canSend = draft.trim().length > 0 && !!messenger && !!chat;

  async function send() {
    if (!canSend || !messenger) return;
    const text = draft.trim();
    setDraft("");
    try {
      await messenger.send(id, text);
    } catch (error) {
      console.warn("send failed", error);
      setDraft(text);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.chatGround }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: p.surface,
          borderBottomWidth: 1,
          borderBottomColor: p.separator,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <IconButton icon="back" label="Назад к чатам" tone="plain" onPress={() => router.back()} />
        <Avatar name={title} seed={chat?.peerAccountId ?? id} size={42} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" numberOfLines={1}>
            {title}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Icon name="lock" size={12} color={p.textMuted} strokeWidth={2.4} />
            <AppText variant="caption" muted numberOfLines={1}>
              {connection === "online" ? (chat?.username ? `@${chat.username}` : "защищённый чат") : "ожидание сети…"}
            </AppText>
          </View>
        </View>
      </View>

      <FlatList
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <View style={{ alignSelf: "center", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: p.scheme === "dark" ? "#1A2131" : "#DFE3EC", marginVertical: 4 }}>
              <AppText variant="caption" style={{ fontFamily: fonts.semibold }} color={p.scheme === "dark" ? "#B9C1D0" : "#3D4659"}>
                {item.label}
              </AppText>
            </View>
          ) : (
            <Bubble message={item.message} />
          )
        }
        ListFooterComponent={
          <View style={{ alignSelf: "center", maxWidth: 300, padding: 14, marginBottom: 8, borderRadius: 14, backgroundColor: p.surface, flexDirection: "row", gap: 10 }}>
            <Icon name="lock" size={16} color={p.accentText} strokeWidth={2.2} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              Сообщения защищены сквозным шифрованием. Прочитать их можете только вы и {title}.
            </AppText>
          </View>
        }
      />

      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: 10,
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: p.surface,
          borderTopWidth: 1,
          borderTopColor: p.separator,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
        <View style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: p.surfaceMuted, justifyContent: "center", paddingHorizontal: 16 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Сообщение"
            placeholderTextColor={p.textSubtle}
            accessibilityLabel="Сообщение"
            multiline
            maxLength={4000}
            style={{ fontFamily: fonts.regular, fontSize: 16, color: p.text, maxHeight: 120, paddingVertical: 10 }}
          />
        </View>
        <View style={{ opacity: canSend ? 1 : 0.4 }}>
          <IconButton icon="send" label="Отправить" tone="accent" onPress={() => void send()} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: Message }) {
  const p = usePalette();
  const out = message.outgoing;
  const status =
    message.status === "sending" ? "Отправляется" : message.status === "failed" ? "Не отправлено" : message.status === "sent" ? "Доставлено на сервер" : "";
  return (
    <View style={{ flexDirection: "row", justifyContent: out ? "flex-end" : "flex-start" }}>
      <View
        accessible
        accessibilityLabel={`${out ? "Вы" : "Собеседник"}: ${message.text}. ${clockTime(message.sentAt)}. ${status}`}
        style={{
          maxWidth: "80%",
          paddingTop: 8,
          paddingBottom: 6,
          paddingHorizontal: 12,
          borderRadius: 18,
          borderBottomRightRadius: out ? 4 : 18,
          borderBottomLeftRadius: out ? 18 : 4,
          backgroundColor: out ? p.accent : p.bubbleIn,
        }}
      >
        <AppText color={out ? p.onAccent : p.bubbleInText} selectable>
          {message.text}
        </AppText>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 2 }}>
          <AppText variant="caption" color={out ? "rgba(255,255,255,0.85)" : p.textMuted} style={{ fontSize: 12, lineHeight: 16 }}>
            {clockTime(message.sentAt)}
          </AppText>
          {out ? (
            message.status === "sending" ? (
              <Icon name="sentTick" size={14} color="rgba(255,255,255,0.5)" strokeWidth={2.2} />
            ) : (
              <Icon name={message.status === "failed" ? "warning" : "sentTick"} size={14} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />
            )
          ) : null}
        </View>
      </View>
    </View>
  );
}
