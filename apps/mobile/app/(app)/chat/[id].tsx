import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/Icon";
import { AppText, Avatar, IconButton } from "@/components/ui";
import { clockTime, dayKey, dayLabel } from "@/format";
import { useConversation, useMessages, useTyping } from "@/messaging/hooks";
import { type Message, REACTIONS } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Row = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: Message };
/** What the composer is doing besides writing a new message. */
type Mode = { kind: "reply"; message: Message } | { kind: "edit"; message: Message } | null;

export default function Chat() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { messenger, connection, session } = useSession();
  const { data: chat } = useConversation(id);
  const { data: messages } = useMessages(id);
  const typing = useTyping(id);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  // Opening the chat marks it read; so does every new message while it is open.
  useEffect(() => {
    if (messenger && chat && chat.unread > 0) void messenger.markRead(id);
  }, [messenger, chat?.unread, id]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

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

  function onChangeDraft(text: string) {
    setDraft(text);
    if (text.length > 0 && mode?.kind !== "edit") void messenger?.typing(id);
  }

  async function send() {
    if (!canSend || !messenger) return;
    const text = draft.trim();
    const current = mode;
    setDraft("");
    setMode(null);
    try {
      if (current?.kind === "edit") await messenger.edit(current.message.id, text);
      else await messenger.send(id, text, current?.kind === "reply" ? current.message.id : null);
    } catch (error) {
      console.warn("send failed", error);
      setDraft(text);
      setMode(current);
    }
  }

  function startMode(next: Mode) {
    setMenuFor(null);
    setMode(next);
    if (next?.kind === "edit") setDraft(next.message.text);
    setTimeout(() => input.current?.focus(), 50);
  }

  function cancelMode() {
    if (mode?.kind === "edit") setDraft("");
    setMode(null);
  }

  const status = typing ? "печатает…" : connection !== "online" ? "ожидание сети…" : chat?.username ? `@${chat.username}` : "защищённый чат";

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
            {typing ? null : <Icon name="lock" size={12} color={p.textMuted} strokeWidth={2.4} />}
            <AppText variant="caption" color={typing ? p.accentText : p.textMuted} numberOfLines={1} accessibilityLiveRegion="polite">
              {status}
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
            <Bubble
              message={item.message}
              quoted={item.message.replyTo ? (byId.get(item.message.replyTo) ?? "missing") : null}
              myAccountId={session?.accountId ?? ""}
              peerName={title}
              onLongPress={() => {
                void Haptics.selectionAsync();
                setMenuFor(item.message);
              }}
              onReact={(emoji) => void messenger?.react(item.message.id, emoji)}
            />
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

      <View style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.separator }}>
        {mode ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 6, paddingTop: 8 }}>
            <Icon name={mode.kind === "edit" ? "edit" : "reply"} size={20} color={p.accentText} strokeWidth={2} />
            <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: p.accent, paddingLeft: 8 }}>
              <AppText variant="caption" color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                {mode.kind === "edit" ? "Редактирование" : mode.message.outgoing ? "Ответ себе" : `Ответ ${title}`}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {mode.message.text}
              </AppText>
            </View>
            <IconButton icon="close" label={mode.kind === "edit" ? "Отменить редактирование" : "Отменить ответ"} tone="plain" onPress={cancelMode} />
          </View>
        ) : null}
        <View style={{ paddingTop: 8, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10), flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
          <View style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: p.surfaceMuted, justifyContent: "center", paddingHorizontal: 16 }}>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Сообщение"
              placeholderTextColor={p.textSubtle}
              accessibilityLabel="Сообщение"
              multiline
              maxLength={4000}
              style={{ fontFamily: fonts.regular, fontSize: 16, color: p.text, maxHeight: 120, paddingVertical: 10 }}
            />
          </View>
          <View style={{ opacity: canSend ? 1 : 0.4 }}>
            <IconButton icon={mode?.kind === "edit" ? "check" : "send"} label={mode?.kind === "edit" ? "Сохранить" : "Отправить"} tone="accent" onPress={() => void send()} />
          </View>
        </View>
      </View>

      <MessageMenu
        message={menuFor}
        myReaction={menuFor ? menuFor.reactions[session?.accountId ?? ""] : undefined}
        onClose={() => setMenuFor(null)}
        onReact={(emoji) => {
          if (menuFor) void messenger?.react(menuFor.id, emoji);
          setMenuFor(null);
        }}
        onReply={() => menuFor && startMode({ kind: "reply", message: menuFor })}
        onEdit={() => menuFor && startMode({ kind: "edit", message: menuFor })}
        onCopy={() => {
          if (menuFor) void Clipboard.setStringAsync(menuFor.text);
          setMenuFor(null);
        }}
        onDeleteForEveryone={() => {
          if (menuFor) void messenger?.deleteForEveryone(menuFor.id);
          if (mode?.message.id === menuFor?.id) cancelMode();
          setMenuFor(null);
        }}
        onDeleteForMe={() => {
          if (menuFor) void messenger?.deleteForMe(menuFor.id);
          if (mode?.message.id === menuFor?.id) cancelMode();
          setMenuFor(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const STATUS_LABEL: Record<Message["status"], string> = {
  sending: "Отправляется",
  failed: "Не отправлено",
  sent: "Отправлено",
  delivered: "Доставлено",
  read: "Прочитано",
  received: "",
};

function Bubble({
  message,
  quoted,
  myAccountId,
  peerName,
  onLongPress,
  onReact,
}: {
  message: Message;
  /** The message this one answers; "missing" if it is not on this phone. */
  quoted: Message | "missing" | null;
  myAccountId: string;
  peerName: string;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
}) {
  const p = usePalette();
  const out = message.outgoing;
  const fg = out ? p.onAccent : p.bubbleInText;
  const meta = out ? "rgba(255,255,255,0.85)" : p.textMuted;

  // Emoji → how many people, mine first.
  const reactions = useMemo(() => {
    const counts = new Map<string, { count: number; mine: boolean }>();
    for (const [account, emoji] of Object.entries(message.reactions)) {
      const entry = counts.get(emoji) ?? { count: 0, mine: false };
      counts.set(emoji, { count: entry.count + 1, mine: entry.mine || account === myAccountId });
    }
    return [...counts.entries()];
  }, [message.reactions, myAccountId]);

  const label = message.deleted
    ? "Сообщение удалено"
    : `${out ? "Вы" : peerName}: ${message.text}. ${clockTime(message.sentAt)}.${message.editedAt ? " Изменено." : ""} ${STATUS_LABEL[message.status]}`;

  return (
    <View style={{ alignItems: out ? "flex-end" : "flex-start" }}>
      <Pressable
        onLongPress={message.deleted ? undefined : onLongPress}
        delayLongPress={300}
        accessibilityLabel={label}
        accessibilityHint={message.deleted ? undefined : "Удерживайте, чтобы ответить, изменить или поставить реакцию"}
        style={{
          maxWidth: "80%",
          paddingTop: 8,
          paddingBottom: 6,
          paddingHorizontal: 12,
          borderRadius: 18,
          borderBottomRightRadius: out ? 4 : 18,
          borderBottomLeftRadius: out ? 18 : 4,
          backgroundColor: out ? p.accent : p.bubbleIn,
          opacity: message.deleted ? 0.75 : 1,
        }}
      >
        {quoted && !message.deleted ? (
          <View
            style={{
              borderLeftWidth: 2,
              borderLeftColor: out ? "rgba(255,255,255,0.8)" : p.accent,
              paddingLeft: 8,
              marginBottom: 4,
              backgroundColor: out ? "rgba(255,255,255,0.12)" : p.accentSoft,
              borderRadius: 6,
              paddingVertical: 4,
              paddingRight: 8,
            }}
          >
            <AppText variant="caption" color={out ? p.onAccent : p.accentText} style={{ fontFamily: fonts.semibold }} numberOfLines={1}>
              {quoted === "missing" ? "Сообщение" : quoted.outgoing ? "Вы" : peerName}
            </AppText>
            <AppText variant="caption" color={meta} numberOfLines={2}>
              {quoted === "missing" ? "недоступно на этом телефоне" : quoted.deleted ? "Сообщение удалено" : quoted.text}
            </AppText>
          </View>
        ) : null}

        {message.deleted ? (
          <AppText color={fg} style={{ fontStyle: "italic" }}>
            Сообщение удалено
          </AppText>
        ) : (
          <AppText color={fg} selectable>
            {message.text}
          </AppText>
        )}

        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 2 }}>
          {message.editedAt && !message.deleted ? (
            <AppText variant="caption" color={meta} style={{ fontSize: 12, lineHeight: 16 }}>
              изменено
            </AppText>
          ) : null}
          <AppText variant="caption" color={meta} style={{ fontSize: 12, lineHeight: 16 }}>
            {clockTime(message.sentAt)}
          </AppText>
          {out && !message.deleted ? <Ticks status={message.status} /> : null}
        </View>
      </Pressable>

      {reactions.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 4, marginTop: -4, paddingHorizontal: 6 }}>
          {reactions.map(([emoji, { count, mine }]) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`${emoji} ${count}${mine ? ", ваша реакция — нажмите, чтобы убрать" : ""}`}
              onPress={() => mine && onReact(emoji)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                paddingHorizontal: 7,
                height: 24,
                borderRadius: 12,
                backgroundColor: mine ? p.accentSoft : p.surface,
                borderWidth: 1,
                borderColor: mine ? p.accent : p.separator,
              }}
            >
              <AppText style={{ fontSize: 13, lineHeight: 17 }}>{emoji}</AppText>
              {count > 1 ? (
                <AppText variant="caption" color={p.textMuted} style={{ fontSize: 12, lineHeight: 16 }}>
                  {count}
                </AppText>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One tick: on the server. Two: on their phone. Two bright: read. */
function Ticks({ status }: { status: Message["status"] }) {
  if (status === "failed") return <Icon name="warning" size={14} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />;
  if (status === "sending") return <Icon name="sentTick" size={14} color="rgba(255,255,255,0.5)" strokeWidth={2.2} />;
  if (status === "sent") return <Icon name="sentTick" size={14} color="rgba(255,255,255,0.85)" strokeWidth={2.2} />;
  return <Icon name="readTicks" size={16} color={status === "read" ? "#FFFFFF" : "rgba(255,255,255,0.6)"} strokeWidth={status === "read" ? 2.6 : 2.2} />;
}

function MessageMenu({
  message,
  myReaction,
  onClose,
  onReact,
  onReply,
  onEdit,
  onCopy,
  onDeleteForEveryone,
  onDeleteForMe,
}: {
  message: Message | null;
  myReaction: string | undefined;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const own = !!message?.outgoing;
  const actions: { icon: IconName; label: string; onPress: () => void; danger?: boolean }[] = [
    { icon: "reply", label: "Ответить", onPress: onReply },
    { icon: "copy", label: "Копировать", onPress: onCopy },
    ...(own ? [{ icon: "edit" as const, label: "Изменить", onPress: onEdit }] : []),
    ...(own ? [{ icon: "trash" as const, label: "Удалить у всех", onPress: onDeleteForEveryone, danger: true }] : []),
    { icon: "trash", label: "Удалить у меня", onPress: onDeleteForMe, danger: true },
  ];

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть меню" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <Pressable
          // Taps inside the sheet do not close it.
          onPress={() => undefined}
          style={{ backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <AppText muted numberOfLines={2} style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
            {message?.text}
          </AppText>
          <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 12, paddingBottom: 10 }}>
            {REACTIONS.map((emoji) => {
              const on = myReaction === emoji;
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={on ? `Убрать реакцию ${emoji}` : `Реакция ${emoji}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => onReact(emoji)}
                  style={({ pressed }) => ({
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: on ? p.accentSoft : pressed ? p.surfaceMuted : "transparent",
                  })}
                >
                  <AppText style={{ fontSize: 26, lineHeight: 32 }}>{emoji}</AppText>
                </Pressable>
              );
            })}
          </View>
          <View style={{ height: 1, backgroundColor: p.separator }} />
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              onPress={action.onPress}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, minHeight: 52, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
            >
              <Icon name={action.icon} size={22} color={action.danger ? p.danger : p.text} strokeWidth={1.9} />
              <AppText color={action.danger ? p.danger : p.text}>{action.label}</AppText>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
