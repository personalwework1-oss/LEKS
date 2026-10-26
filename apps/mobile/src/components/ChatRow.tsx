import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { clockTime, listTime } from "@/format";
import { chatFace } from "@/messaging/hooks";
import { type Conversation, isMuted, MUTED_FOREVER, type Person } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";
import { ActionSheet, type SheetAction } from "./ActionSheet";
import { Icon } from "./Icon";
import { AppText, Avatar } from "./ui";

/** One chat in a list: long press to pin, mute or archive it. */
export function ChatRow({ chat, people }: { chat: Conversation; people: Map<string, Person> }) {
  const p = usePalette();
  const { messenger } = useSession();
  const unread = chat.unread > 0;
  const face = chatFace(people, chat);
  const muted = isMuted(chat);
  const [sheet, setSheet] = useState<"main" | "mute" | null>(null);
  const menu = () => {
    void Haptics.selectionAsync();
    setSheet("main");
  };
  const act = (fn: () => void) => () => {
    setSheet(null);
    fn();
  };
  const mutedHint = muted && chat.mutedUntil && chat.mutedUntil < MUTED_FOREVER ? `до ${clockTime(chat.mutedUntil)}` : muted ? "навсегда" : undefined;
  const mainActions: SheetAction[] = [
    ...(unread ? [{ icon: "readTicks" as const, label: "Отметить прочитанным", onPress: act(() => void messenger?.markRead(chat.id)) }] : []),
    ...(chat.archived
      ? []
      : [{ icon: "pin" as const, label: chat.pinned ? "Открепить" : "Закрепить наверху", onPress: act(() => void messenger?.setPinned(chat.id, !chat.pinned)) }]),
    muted
      ? { icon: "bell" as const, label: "Включить звук", hint: mutedHint ? `Сейчас без звука ${mutedHint}` : undefined, onPress: act(() => void messenger?.setMuted(chat.id, null)) }
      : { icon: "bellOff" as const, label: "Без звука", hint: "Звонки по-прежнему будут звонить", onPress: () => setSheet("mute") },
    {
      icon: "archive" as const,
      label: chat.archived ? "Вернуть из архива" : "В архив",
      hint: chat.archived ? undefined : "Вернётся, когда придёт новое сообщение",
      onPress: act(() => void messenger?.setArchived(chat.id, !chat.archived)),
    },
  ];
  const muteActions: SheetAction[] = [
    { icon: "bellOff", label: "На 1 час", onPress: act(() => void messenger?.setMuted(chat.id, Date.now() + 3600_000)) },
    { icon: "bellOff", label: "На 8 часов", onPress: act(() => void messenger?.setMuted(chat.id, Date.now() + 8 * 3600_000)) },
    { icon: "bellOff", label: "На неделю", onPress: act(() => void messenger?.setMuted(chat.id, Date.now() + 7 * 24 * 3600_000)) },
    { icon: "bellOff", label: "Навсегда", onPress: act(() => void messenger?.setMuted(chat.id, MUTED_FOREVER)) },
  ];

  return (
    <>
    <ActionSheet
      visible={sheet !== null}
      onClose={() => setSheet(null)}
      header={
        <View style={{ alignItems: "center", gap: 6, paddingBottom: 4 }}>
          <Avatar name={face.title} seed={chat.peerAccountId} size={48} photo={face.photo} />
        </View>
      }
      title={sheet === "mute" ? "Без звука" : face.title}
      subtitle={sheet === "mute" ? "Уведомлений о сообщениях не будет" : undefined}
      actions={sheet === "mute" ? muteActions : mainActions}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${face.title}${unread ? `, непрочитанных: ${chat.unread}` : ""}`}
      onPress={() => router.push({ pathname: "/chat/[id]", params: { id: chat.id } })}
      onLongPress={menu}
      delayLongPress={350}
      accessibilityHint="Удерживайте: закрепить, без звука, в архив"
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
    >
      <Avatar name={face.title} seed={chat.peerAccountId} size={54} photo={face.photo} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {face.title}
          </AppText>
          {chat.accepted === false && chat.kind === "direct" ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: p.warningSoft }}>
              <AppText variant="caption" color={p.warningText} style={{ fontSize: 11, lineHeight: 15 }}>
                запрос
              </AppText>
            </View>
          ) : null}
          {muted ? <Icon name="bellOff" size={14} color={p.textMuted} strokeWidth={2.2} /> : null}
          {chat.pinned ? <Icon name="pin" size={14} color={p.textMuted} strokeWidth={2.2} /> : null}
          <AppText variant="caption" color={unread ? p.accentText : p.textMuted}>
            {listTime(chat.lastAt)}
          </AppText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {chat.draft ? (
            <AppText numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 20 }} color={p.textMuted}>
              <Text style={{ color: p.danger }}>Черновик: </Text>
              {chat.draft}
            </AppText>
          ) : (
            <AppText muted numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 20 }}>
              {chat.lastText ?? (chat.username ? `@${chat.username}` : "Пока нет сообщений")}
            </AppText>
          )}
          {unread ? (
            <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: muted ? p.textSubtle : p.accent, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: p.onAccent }}>{chat.unread}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
    </>
  );
}
