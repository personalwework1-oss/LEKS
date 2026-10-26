import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { type ComponentRef, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, Modal, PanResponder, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttachmentView } from "@/components/AttachmentView";
import { Icon, type IconName } from "@/components/Icon";
import { AppText, Avatar, IconButton } from "@/components/ui";
import { pickDocuments, pickFromGallery } from "@/features/attachments";
import { currentLocation, describePoint, openInMaps } from "@/features/location";
import { ReportSheet } from "@/features/ReportSheet";
import { MicButton, VoiceRecorder } from "@/features/VoiceRecorder";
import { clockTime, dayKey, dayLabel } from "@/format";
import { callText, MessengerError, previewOf } from "@/messaging/messenger";
import { chatFace, nameOf, useConversation, useConversations, useMessages, usePeople, useTyping } from "@/messaging/hooks";
import { type CallEvent, type Conversation, type GeoPoint, type Message, type Person, REACTIONS, timerLabel } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

/** How far (dp) a message is swiped right to answer it. */
const SWIPE_REPLY_AT = 56;

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
  const [locating, setLocating] = useState(false);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [reporting, setReporting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const list = useRef<FlatList<Row>>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Scrolled up: a "down" button, with how many new messages came meanwhile.
  const [away, setAway] = useState(false);
  const awayMark = useRef<string | null>(null);

  // The unsent text comes back when the chat is opened again.
  const draftLoaded = useRef(false);
  const latestDraft = useRef("");
  useEffect(() => {
    if (draftLoaded.current || !chat) return;
    draftLoaded.current = true;
    if (chat.draft) setDraft(chat.draft);
  }, [chat]);
  useEffect(() => {
    if (mode?.kind !== "edit") latestDraft.current = draft;
  }, [draft, mode]);
  useEffect(() => () => void messenger?.setDraft(id, latestDraft.current).catch(() => undefined), [messenger, id]);

  // Search in this chat as the person types.
  useEffect(() => {
    if (!searching || !messenger) return;
    let alive = true;
    const timer = setTimeout(() => void messenger.search(id, query).then((found) => alive && setResults(found)), 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searching, query, messenger, id]);

  function closeSearch() {
    setSearching(false);
    setQuery("");
    setResults([]);
  }

  function jumpTo(message: Message) {
    closeSearch();
    const index = rows.findIndex((row) => row.kind === "message" && row.message.id === message.id);
    if (index < 0) return;
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    setHighlight(message.id);
    setTimeout(() => setHighlight((current) => (current === message.id ? null : current)), 1800);
  }

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

  const people = usePeople();
  const face = chat ? chatFace(people, chat) : { title: "Чат", photo: null };
  const title = face.title;
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

  /** Takes the current position and, after a confirmation, sends it. */
  async function shareLocation() {
    setAttachOpen(false);
    setAttachError(null);
    if (!messenger) return;
    setLocating(true);
    const result = await currentLocation();
    setLocating(false);
    if (!result.ok) {
      setAttachError(
        result.reason === "denied"
          ? "Нет доступа к геопозиции. Разрешите его в настройках телефона."
          : result.reason === "off"
            ? "Геолокация на телефоне выключена. Включите её и попробуйте снова."
            : "Не удалось определить, где вы. Попробуйте ещё раз на улице или у окна.",
      );
      return;
    }
    const accuracy = result.point.accuracy !== undefined ? ` Точность — около ${Math.round(result.point.accuracy)} м.` : "";
    Alert.alert("Отправить геопозицию?", `Собеседник увидит, где вы сейчас.${accuracy}`, [
      { text: "Отмена", style: "cancel" },
      { text: "Отправить", onPress: () => void messenger.sendLocation(id, result.point).catch(() => setAttachError("Не удалось отправить.")) },
    ]);
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

  const newSinceAway = (() => {
    if (!away || !awayMark.current) return 0;
    const from = messages.findIndex((m) => m.id === awayMark.current);
    return from < 0 ? 0 : messages.slice(from + 1).filter((m) => !m.outgoing && !m.event).length;
  })();
  const isGroup = chat?.kind === "group";
  const peerBlocked = !isGroup && !!chat && !!people.get(chat.peerAccountId)?.blocked;
  const names = useMemo(
    () => new Map((chat?.members ?? []).map((m) => [m.accountId, nameOf(people, m.accountId, m.displayName)])),
    [chat?.members, people],
  );
  const status = typing
    ? "печатает…"
    : connection !== "online"
      ? "ожидание сети…"
      : isGroup
        ? `${chat.members.length} ${chat.members.length % 10 === 1 && chat.members.length % 100 !== 11 ? "участник" : [2, 3, 4].includes(chat.members.length % 10) && ![12, 13, 14].includes(chat.members.length % 100) ? "участника" : "участников"}`
        : chat?.username
          ? `@${chat.username}`
          : "защищённый чат";
  const timerNote = chat?.timer ? ` · ⏱ ${timerLabel(chat.timer)}` : "";

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
        {searching ? (
          <>
            <IconButton icon="back" label="Закрыть поиск" tone="plain" onPress={closeSearch} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск в чате"
              placeholderTextColor={p.textSubtle}
              accessibilityLabel="Поиск в чате"
              returnKeyType="search"
              style={{ flex: 1, height: 42, borderRadius: 12, backgroundColor: p.surfaceMuted, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 16, color: p.text }}
            />
          </>
        ) : (
        <>
        <IconButton icon="back" label="Назад к чатам" tone="plain" onPress={() => router.back()} />
        <Pressable
          disabled={!chat}
          onPress={() =>
            isGroup
              ? router.push({ pathname: "/group/[id]", params: { id } })
              : chat && router.push({ pathname: "/contact/[id]", params: { id: chat.peerAccountId } })
          }
          accessibilityRole="button"
          accessibilityHint={isGroup ? "Открыть участников и настройки группы" : "Открыть профиль"}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
        >
        <Avatar name={title} seed={isGroup ? id : (chat?.peerAccountId ?? id)} size={42} photo={face.photo} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" numberOfLines={1}>
            {title}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {typing ? null : <Icon name="lock" size={12} color={p.textMuted} strokeWidth={2.4} />}
            <AppText variant="caption" color={typing ? p.accentText : p.textMuted} numberOfLines={1} accessibilityLiveRegion="polite">
              {typing ? status : `${status}${timerNote}`}
            </AppText>
          </View>
        </View>
        </Pressable>
        <IconButton icon="search" label="Поиск в чате" tone="plain" onPress={() => setSearching(true)} />
        {chat && !chat.left && !chat.rejoining && !peerBlocked ? (
          <>
            <IconButton icon="phone" label="Аудиозвонок" tone="plain" onPress={() => void calls?.start(id, false)} />
            <IconButton icon="video" label="Видеозвонок" tone="plain" onPress={() => void calls?.start(id, true)} />
          </>
        ) : null}
        </>
        )}
      </View>

      {searching && query.trim() ? (
        <View style={{ flex: 1, backgroundColor: p.surface }}>
          <AppText variant="caption" muted style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            {results.length === 0 ? "Ничего не найдено" : `Найдено: ${results.length}`}
          </AppText>
          <FlatList
            data={results}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => jumpTo(item)}
                style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: p.separator, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
              >
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {item.outgoing ? "Вы" : isGroup ? (names.get(item.senderAccountId) ?? "Участник") : title}
                  </AppText>
                  <AppText variant="caption" muted>
                    {`${dayLabel(item.sentAt)}, ${clockTime(item.sentAt)}`}
                  </AppText>
                </View>
                <AppText muted numberOfLines={2}>
                  {previewOf(item)}
                </AppText>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      <View style={[{ flex: 1 }, searching && query.trim() ? { display: "none" } : null]}>
      <FlatList
        ref={list}
        inverted
        scrollEventThrottle={100}
        onScroll={(e) => {
          const isAway = e.nativeEvent.contentOffset.y > 400;
          if (isAway === away) return;
          awayMark.current = isAway ? (messages[messages.length - 1]?.id ?? null) : null;
          setAway(isAway);
        }}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 100);
        }}
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
          ) : item.message.event?.type === "timer" ? (
            <TimerNote message={item.message} name={item.message.outgoing ? "Вы" : isGroup ? (names.get(item.message.senderAccountId) ?? "Участник") : title} />
          ) : item.message.event?.type === "device" ? (
            <DeviceNote
              message={item.message}
              name={item.message.outgoing ? "вас" : isGroup ? (names.get(item.message.senderAccountId) ?? "участника") : title}
            />
          ) : item.message.event ? (
            <CallNote message={item.message} onCall={(video) => void calls?.start(id, video)} />
          ) : (
            <Bubble
              highlighted={highlight === item.message.id}
              onSwipeReply={chat?.left || peerBlocked ? undefined : () => startMode({ kind: "reply", message: item.message })}
              onDoubleTap={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                void messenger?.react(item.message.id, "❤️");
              }}
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
      {away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={newSinceAway > 0 ? `Вниз, новых сообщений: ${newSinceAway}` : "Вниз, к последним сообщениям"}
          onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
          style={{
            position: "absolute",
            right: 14,
            bottom: 14,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: p.surface,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Icon name="arrowDown" size={22} color={p.text} strokeWidth={2.2} />
          {newSinceAway > 0 ? (
            <View style={{ position: "absolute", top: -6, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}>
              <AppText variant="caption" color={p.onAccent} style={{ fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold }}>
                {newSinceAway}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      </View>

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
      {chat && !isGroup && chat.accepted === false && !peerBlocked ? (
        <View style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.separator, padding: 16, gap: 12 }}>
          <AppText style={{ textAlign: "center" }}>
            {`${title}${chat.username ? ` (@${chat.username})` : ""} нет среди ваших собеседников.`}
          </AppText>
          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            Пока вы не ответите, он не увидит, что вы прочитали, и не получит ваше фото. Никогда не переводите деньги и не сообщайте коды незнакомым.
          </AppText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(`Заблокировать ${title}?`, "Он не сможет писать и звонить вам.", [
                  { text: "Отмена", style: "cancel" },
                  { text: "Заблокировать", style: "destructive", onPress: () => void messenger?.block(chat.peerAccountId) },
                ])
              }
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: p.surfaceMuted, alignItems: "center", justifyContent: "center" }}
            >
              <AppText color={p.danger}>Заблокировать</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setReporting(true)}
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: p.surfaceMuted, alignItems: "center", justifyContent: "center" }}
            >
              <AppText color={p.danger}>Пожаловаться</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void messenger?.accept(id)}
              style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}
            >
              <AppText color={p.onAccent}>Принять</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
      {peerBlocked && chat ? (
        <View style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.separator, padding: 16, paddingBottom: Math.max(insets.bottom, 16), gap: 10, alignItems: "center" }}>
          <AppText muted style={{ textAlign: "center" }}>
            {`Вы заблокировали ${title}. Его сообщения и звонки к вам не приходят.`}
          </AppText>
          <Pressable accessibilityRole="button" onPress={() => void messenger?.unblock(chat.peerAccountId)} hitSlop={8}>
            <AppText color={p.accentText}>Разблокировать</AppText>
          </Pressable>
        </View>
      ) : chat?.left ? (
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
        {locating ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
            <ActivityIndicator size="small" color={p.accent} />
            <AppText variant="caption" muted>
              Определяем, где вы…
            </AppText>
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

      <AttachMenu
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPick={(source) => (source === "location" ? void shareLocation() : void attach(source))}
      />

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
        onForward={() => {
          setForwarding(menuFor);
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
      {chat && !isGroup ? (
        <ReportSheet
          name={title}
          visible={reporting}
          canAttach
          onClose={() => setReporting(false)}
          onSend={async (choice) => {
            await messenger?.report(chat.peerAccountId, { ...choice, conversationId: id });
            setReporting(false);
            Alert.alert("Жалоба отправлена", choice.block ? `Спасибо. ${title} заблокирован.` : "Спасибо, мы её рассмотрим.");
          }}
        />
      ) : null}
      <ForwardPicker
        message={forwarding}
        people={people}
        onClose={() => setForwarding(null)}
        onPick={async (target) => {
          const message = forwarding;
          setForwarding(null);
          if (!message || !messenger) return;
          try {
            await messenger.forward(message.id, target.id);
            if (target.id !== id) router.replace({ pathname: "/chat/[id]", params: { id: target.id } });
          } catch {
            setAttachError("Не удалось переслать. Попробуйте ещё раз.");
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}

/** A place on the map: no map is loaded (that would tell a map service where you are) until it is opened. */
function LocationCard({ point, outgoing }: { point: GeoPoint; outgoing: boolean }) {
  const p = usePalette();
  const fg = outgoing ? p.onAccent : p.bubbleInText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Геопозиция ${describePoint(point)}. Открыть в картах`}
      onPress={() => void openInMaps(point)}
      style={({ pressed }) => ({
        width: 220,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 4,
        opacity: pressed ? 0.85 : 1,
        backgroundColor: outgoing ? "rgba(255,255,255,0.14)" : p.surface,
      })}
    >
      <View style={{ height: 96, alignItems: "center", justifyContent: "center", backgroundColor: outgoing ? "rgba(255,255,255,0.1)" : p.accentSoft }}>
        {/* A simple street-grid pattern behind the pin. */}
        {[0, 1, 2, 3].map((i) => (
          <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: 12 + i * 24, height: 2, backgroundColor: outgoing ? "rgba(255,255,255,0.12)" : "rgba(91,108,255,0.12)" }} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: 20 + i * 46, width: 2, backgroundColor: outgoing ? "rgba(255,255,255,0.12)" : "rgba(91,108,255,0.12)" }} />
        ))}
        <Icon name="location" size={38} color={outgoing ? p.onAccent : p.accent} strokeWidth={2.2} />
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        <AppText variant="bodyStrong" color={fg}>
          Геопозиция
        </AppText>
        <AppText variant="caption" color={outgoing ? "rgba(255,255,255,0.85)" : p.textMuted}>
          {describePoint(point)}
        </AppText>
      </View>
    </Pressable>
  );
}

/** Where to forward a message: any chat I can still write in. */
function ForwardPicker({
  message,
  people,
  onClose,
  onPick,
}: {
  message: Message | null;
  people: Map<string, Person>;
  onClose: () => void;
  onPick: (chat: Conversation) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { data: chats } = useConversations();
  const open = chats.filter((c) => !c.left);
  return (
    <Modal visible={!!message} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <Pressable
          onPress={() => undefined}
          style={{ maxHeight: "75%", backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 14) }}
        >
          <AppText variant="heading" style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
            Переслать в…
          </AppText>
          <FlatList
            data={open}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => {
              const face = chatFace(people, item);
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPick(item)}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
                >
                  <Avatar name={face.title} seed={item.kind === "group" ? item.id : item.peerAccountId} size={42} photo={face.photo} />
                  <AppText style={{ flex: 1 }} numberOfLines={1}>
                    {face.title}
                  </AppText>
                </Pressable>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
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
  highlighted,
  onSwipeReply,
  onDoubleTap,
}: {
  highlighted?: boolean;
  onSwipeReply?: () => void;
  onDoubleTap?: () => void;
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

  // Swipe right to answer, like in other messengers.
  const shift = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const replyRef = useRef(onSwipeReply);
  replyRef.current = onSwipeReply;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => !!replyRef.current && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          const x = Math.max(0, Math.min(g.dx * 0.8, SWIPE_REPLY_AT + 24));
          shift.setValue(x);
          if (x >= SWIPE_REPLY_AT && !armed.current) {
            armed.current = true;
            void Haptics.selectionAsync();
          } else if (x < SWIPE_REPLY_AT && armed.current) armed.current = false;
        },
        onPanResponderRelease: () => {
          if (armed.current) replyRef.current?.();
          armed.current = false;
          Animated.spring(shift, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [shift],
  );

  // Two quick taps: ❤️.
  const lastTap = useRef(0);
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      onDoubleTap?.();
    } else lastTap.current = now;
  };

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
    <Animated.View
      {...pan.panHandlers}
      style={{ alignItems: out ? "flex-end" : "flex-start", borderRadius: 12, backgroundColor: highlighted ? p.accentSoft : "transparent", transform: [{ translateX: shift }] }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: -36,
          top: "50%",
          marginTop: -14,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: p.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: shift.interpolate({ inputRange: [0, SWIPE_REPLY_AT], outputRange: [0, 1], extrapolate: "clamp" }),
        }}
      >
        <Icon name="reply" size={16} color={p.accentText} strokeWidth={2.2} />
      </Animated.View>
      <Pressable
        onPress={message.deleted ? undefined : tap}
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

        {message.forwarded && !message.deleted ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 }}>
            <Icon name="forward" size={13} color={meta} strokeWidth={2.2} />
            <AppText variant="caption" color={meta} style={{ fontStyle: "italic" }}>
              Переслано
            </AppText>
          </View>
        ) : null}
        {message.location && !message.deleted ? <LocationCard point={message.location} outgoing={out} /> : null}
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
          {message.expiresAt ? (
            <AppText variant="caption" color={meta} style={{ fontSize: 11, lineHeight: 16 }} accessibilityLabel="Исчезающее сообщение">
              ⏱
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
    </Animated.View>
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
  onForward,
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
  onForward: () => void;
  onDeleteForEveryone: () => void;
  onDeleteForMe: () => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const own = !!message?.outgoing;
  const actions: { icon: IconName; label: string; onPress: () => void; danger?: boolean }[] = [
    { icon: "reply" as const, label: "Ответить", onPress: onReply },
    ...(message?.text ? [{ icon: "copy" as const, label: "Копировать", onPress: onCopy }] : []),
    ...(message && (!message.attachment || (message.attachment.blobId && message.attachment.key))
      ? [{ icon: "forward" as const, label: "Переслать", onPress: onForward }]
      : []),
    ...(message?.location ? [{ icon: "location" as const, label: "Открыть в картах", onPress: () => void openInMaps(message.location!) }] : []),
    ...(own && !message?.location ? [{ icon: "edit" as const, label: "Изменить", onPress: onEdit }] : []),
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

function AttachMenu({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (source: "gallery" | "files" | "location") => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const options: { source: "gallery" | "files" | "location"; icon: IconName; label: string; hint: string }[] = [
    { source: "gallery", icon: "image", label: "Фото или видео", hint: "Фото сжимаются, геометки удаляются" },
    { source: "files", icon: "file", label: "Файл", hint: "Отправляется как есть, до 99 МБ" },
    { source: "location", icon: "location", label: "Геопозиция", hint: "Где вы сейчас — видит только собеседник" },
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

/** "Анна включила исчезающие сообщения: 1 неделя". */
function TimerNote({ message, name }: { message: Message; name: string }) {
  const p = usePalette();
  const seconds = message.event?.type === "timer" ? message.event.seconds : 0;
  const text = seconds
    ? `${name}: исчезающие сообщения — ${timerLabel(seconds).toLowerCase()}. Новые сообщения удалятся у всех через это время.`
    : `${name}: исчезающие сообщения выключены.`;
  return (
    <View style={{ alignSelf: "center", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, marginVertical: 4, backgroundColor: p.surface, maxWidth: 320 }}>
      <AppText variant="caption" muted style={{ textAlign: "center" }}>
        {`⏱ ${text}`}
      </AppText>
    </View>
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
