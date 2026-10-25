import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachmentView } from "@/components/AttachmentView";
import { Icon, type IconName } from "@/components/Icon";
import { AppText, Avatar, IconButton } from "@/components/ui";
import { pickDocuments, pickFromGallery } from "@/features/attachments";
import { MicButton, VoiceRecorder } from "@/features/VoiceRecorder";
import { clockTime, dayKey, dayLabel } from "@/format";
import { callText, MessengerError, previewOf } from "@/messaging/messenger";
import { useConversation, useMessages, useTyping } from "@/messaging/hooks";
import { type CallEvent, type Message, REACTIONS } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Row = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: Message };
/** What the composer is doing besides writing a new message. */
type Mode = { kind: "reply"; message: Message } | { kind: "edit"; message: Message } | null;

export default function Chat() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { id, skipped } = useLocalSearchParams<{ id: string; skipped?: string }>();
  const { messenger, connection, session, calls } = useSession();
  const { data: chat } = useConversation(id);
  const { data: messages } = useMessages(id);
  const typing = useTyping(id);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
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

  /** Picks photos or files and sends each; the draft becomes the caption of a single one. */
  async function attach(source: "gallery" | "files") {
    setAttachOpen(false);
    setAttachError(null);
    if (!messenger) return;
    try {
      const files = source === "gallery" ? await pickFromGallery() : await pickDocuments();
      if (files.length === 0) return;
      const caption = files.length === 1 && mode?.kind !== "edit" ? draft.trim() : "";
      const replyTo = mode?.kind === "reply" ? mode.message.id : null;
      if (caption) setDraft("");
      if (mode?.kind === "reply") setMode(null);
      for (const [i, file] of files.entries()) await messenger.sendFile(id, file, i === 0 ? caption : "", i === 0 ? replyTo : null);
    } catch (error) {
      setAttachError(
        error instanceof MessengerError && error.code === "too_large"
          ? "Файл больше 99 МБ — такой пока не отправить."
          : "Не удалось подготовить файл. Попробуйте ещё раз.",
      );
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

  const isGroup = chat?.kind === "group";
  const names = useMemo(() => new Map((chat?.members ?? []).map((m) => [m.accountId, m.displayName])), [chat?.members]);
  const status = typing
    ? "печатает…"
    : connection !== "online"
      ? "ожидание сети…"
      : isGroup
        ? `${chat.members.length} ${chat.members.length % 10 === 1 && chat.members.length % 100 !== 11 ? "участник" : [2, 3, 4].includes(chat.members.length % 10) && ![12, 13, 14].includes(chat.members.length % 100) ? "участника" : "участников"}`
        : chat?.username
          ? `@${chat.username}`
          : "защищённый чат";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.chatGround }} behavior="padding">
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
        <Pressable
          disabled={!isGroup}
          onPress={() => router.push({ pathname: "/group/[id]", params: { id } })}
          accessibilityRole={isGroup ? "button" : undefined}
          accessibilityHint={isGroup ? "Открыть участников и настройки группы" : undefined}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
        >
        <Avatar name={title} seed={isGroup ? id : (chat?.peerAccountId ?? id)} size={42} />
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
        </Pressable>
        {chat && !chat.left && !chat.rejoining ? (
          <>
            <IconButton icon="phone" label="Аудиозвонок" tone="plain" onPress={() => void calls?.start(id, false)} />
            <IconButton icon="video" label="Видеозвонок" tone="plain" onPress={() => void calls?.start(id, true)} />
          </>
        ) : null}
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
          ) : item.message.event?.type === "device" ? (
            <DeviceNote
              message={item.message}
              name={item.message.outgoing ? "вас" : isGroup ? (names.get(item.message.senderAccountId) ?? "участника") : title}
            />
          ) : item.message.event ? (
            <CallNote message={item.message} onCall={(video) => void calls?.start(id, video)} />
          ) : (
            <Bubble
              message={item.message}
              quoted={item.message.replyTo ? (byId.get(item.message.replyTo) ?? "missing") : null}
              myAccountId={session?.accountId ?? ""}
              peerName={isGroup ? (names.get(item.message.senderAccountId) ?? "Участник") : title}
              showSender={isGroup && !item.message.outgoing}
              onLongPress={() => {
                void Haptics.selectionAsync();
                setMenuFor(item.message);
              }}
              onReact={(emoji) => void messenger?.react(item.message.id, emoji)}
              onDownload={() => void messenger?.download(item.message.id)}
              onRetry={() => void messenger?.retryUpload(item.message.id)}
            />
          )
        }
        ListFooterComponent={
          <View style={{ alignSelf: "center", maxWidth: 300, padding: 14, marginBottom: 8, borderRadius: 14, backgroundColor: p.surface, flexDirection: "row", gap: 10 }}>
            <Icon name="lock" size={16} color={p.accentText} strokeWidth={2.2} />
            <AppText variant="caption" muted style={{ flex: 1 }}>
              {isGroup
                ? "Сообщения, название и участники группы защищены сквозным шифрованием. Прочитать их могут только участники."
                : `Сообщения защищены сквозным шифрованием. Прочитать их можете только вы и ${title}.`}
            </AppText>
          </View>
        }
      />

      {skipped ? (
        <View style={{ backgroundColor: p.surface, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: p.separator }}>
          <AppText variant="caption" muted>
            Не добавлены — ещё не подключили телефон: {skipped}. Добавьте их позже в настройках группы.
          </AppText>
        </View>
      ) : null}
      {chat?.rejoining && !chat.left ? (
        <View style={{ backgroundColor: p.surface, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: p.separator }}>
          <AppText variant="caption" muted>
            Переписка восстановлена. Новые сообщения уйдут, как только {isGroup ? "участники будут" : "собеседник будет"} в сети.
          </AppText>
        </View>
      ) : null}
      {chat?.left ? (
        <View style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.separator, padding: 16, paddingBottom: Math.max(insets.bottom, 16) }}>
          <AppText muted style={{ textAlign: "center" }}>
            Вы больше не участник этой группы.
          </AppText>
        </View>
      ) : (
      <View style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.separator }}>
        {mode ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 16, paddingRight: 6, paddingTop: 8 }}>
            <Icon name={mode.kind === "edit" ? "edit" : "reply"} size={20} color={p.accentText} strokeWidth={2} />
            <View style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: p.accent, paddingLeft: 8 }}>
              <AppText variant="caption" color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                {mode.kind === "edit" ? "Редактирование" : mode.message.outgoing ? "Ответ себе" : `Ответ ${isGroup ? (names.get(mode.message.senderAccountId) ?? "участнику") : title}`}
              </AppText>
              <AppText variant="caption" muted numberOfLines={1}>
                {previewOf(mode.message)}
              </AppText>
            </View>
            <IconButton icon="close" label={mode.kind === "edit" ? "Отменить редактирование" : "Отменить ответ"} tone="plain" onPress={cancelMode} />
          </View>
        ) : null}
        {attachError ? (
          <AppText variant="caption" color={p.danger} style={{ paddingHorizontal: 16, paddingTop: 8 }} accessibilityLiveRegion="assertive">
            {attachError}
          </AppText>
        ) : null}
        <View style={{ paddingTop: 8, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10), flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
          {recording ? (
            <VoiceRecorder
              onCancel={() => setRecording(false)}
              onError={(text) => setAttachError(text)}
              onSend={(file) => {
                setRecording(false);
                const replyTo = mode?.kind === "reply" ? mode.message.id : null;
                if (replyTo) setMode(null);
                messenger?.sendFile(id, file, "", replyTo).catch(() => setAttachError("Не удалось отправить голосовое."));
              }}
            />
          ) : (
          <>
          {mode?.kind === "edit" ? null : <IconButton icon="paperclip" label="Прикрепить фото или файл" tone="plain" onPress={() => setAttachOpen(true)} />}
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
          {draft.trim().length === 0 && mode?.kind !== "edit" ? (
            <MicButton
              onPress={() => {
                setAttachError(null);
                setRecording(true);
              }}
            />
          ) : (
            <View style={{ opacity: canSend ? 1 : 0.4 }}>
              <IconButton icon={mode?.kind === "edit" ? "check" : "send"} label={mode?.kind === "edit" ? "Сохранить" : "Отправить"} tone="accent" onPress={() => void send()} />
            </View>
          )}
          </>
          )}
        </View>
      </View>
      )}

      <AttachMenu visible={attachOpen} onClose={() => setAttachOpen(false)} onPick={(source) => void attach(source)} />

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
  onDownload,
  onRetry,
  showSender,
}: {
  message: Message;
  showSender: boolean;
  /** The message this one answers; "missing" if it is not on this phone. */
  quoted: Message | "missing" | null;
  myAccountId: string;
  peerName: string;
  onLongPress: () => void;
  onReact: (emoji: string) => void;
  onDownload: () => void;
  onRetry: () => void;
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
    : `${out ? "Вы" : peerName}: ${previewOf(message)}. ${clockTime(message.sentAt)}.${message.editedAt ? " Изменено." : ""} ${STATUS_LABEL[message.status]}`;

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
        {showSender ? (
          <AppText variant="caption" color={p.accentText} style={{ fontFamily: fonts.semibold, marginBottom: 2 }} numberOfLines={1}>
            {peerName}
          </AppText>
        ) : null}
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
              {quoted === "missing" ? "недоступно на этом телефоне" : previewOf(quoted)}
            </AppText>
          </View>
        ) : null}

        {message.attachment && !message.deleted ? (
          <AttachmentView attachment={message.attachment} outgoing={out} onDownload={onDownload} onRetry={onRetry} />
        ) : null}
        {message.deleted ? (
          <AppText color={fg} style={{ fontStyle: "italic" }}>
            Сообщение удалено
          </AppText>
        ) : message.text ? (
          <AppText color={fg} selectable>
            {message.text}
          </AppText>
        ) : null}

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
    { icon: "reply" as const, label: "Ответить", onPress: onReply },
    ...(message?.text ? [{ icon: "copy" as const, label: "Копировать", onPress: onCopy }] : []),
    ...(own ? [{ icon: "edit" as const, label: "Изменить", onPress: onEdit }] : []),
    ...(own ? [{ icon: "trash" as const, label: "Удалить у всех", onPress: onDeleteForEveryone, danger: true }] : []),
    { icon: "trash" as const, label: "Удалить у меня", onPress: onDeleteForMe, danger: true },
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
            {previewOf(message)}
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

function AttachMenu({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (source: "gallery" | "files") => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const options: { source: "gallery" | "files"; icon: IconName; label: string; hint: string }[] = [
    { source: "gallery", icon: "image", label: "Фото или видео", hint: "Фото сжимаются, геометки удаляются" },
    { source: "files", icon: "file", label: "Файл", hint: "Отправляется как есть, до 99 МБ" },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <Pressable
          onPress={() => undefined}
          style={{ backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 14) }}
        >
          {options.map((option) => (
            <Pressable
              key={option.source}
              accessibilityRole="button"
              accessibilityHint={option.hint}
              onPress={() => onPick(option.source)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, minHeight: 64, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name={option.icon} size={22} color={p.accentText} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{option.label}</AppText>
                <AppText variant="caption" muted>
                  {option.hint}
                </AppText>
              </View>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** "У Анны новое устройство": a phone was added to the chat's encryption, so nothing slips in unnoticed. */
function DeviceNote({ message, name }: { message: Message; name: string }) {
  const p = usePalette();
  return (
    <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, marginVertical: 4, backgroundColor: p.surface, maxWidth: 320 }}>
      <Icon name="lock" size={14} color={p.accentText} strokeWidth={2.2} />
      <AppText variant="caption" muted style={{ flexShrink: 1 }}>
        {`У ${name} новое устройство в этом чате · ${clockTime(message.sentAt)}`}
      </AppText>
    </View>
  );
}

/** "Пропущенный звонок · 12:40" in the middle of the chat; tapping calls back. */
function CallNote({ message, onCall }: { message: Message; onCall: (video: boolean) => void }) {
  const p = usePalette();
  const event = message.event as CallEvent;
  const missed = !message.outgoing && (event.outcome === "missed" || event.outcome === "no_answer" || event.outcome === "cancelled");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${callText(message)}, ${clockTime(message.sentAt)}. Нажмите, чтобы перезвонить`}
      onPress={() => onCall(event.video)}
      style={({ pressed }) => ({
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 16,
        marginVertical: 4,
        backgroundColor: pressed ? p.surfaceMuted : p.surface,
      })}
    >
      <Icon name={event.video ? "video" : "phone"} size={16} color={missed ? p.danger : p.accentText} strokeWidth={2.2} />
      <AppText variant="caption" color={missed ? p.danger : p.text} style={{ fontFamily: fonts.semibold }}>
        {callText(message)}
      </AppText>
      <AppText variant="caption" muted>
        {clockTime(message.sentAt)}
      </AppText>
    </Pressable>
  );
}
