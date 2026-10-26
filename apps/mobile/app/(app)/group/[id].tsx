import type { PublicUser } from "@leks/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { AppText, Avatar, Button, NavHeader, TextField } from "@/components/ui";
import { PeoplePicker } from "@/features/PeoplePicker";
import { nameOf, useConversation, usePeople } from "@/messaging/hooks";
import { TimerSheet } from "@/features/timer";
import { type GroupMember, timerLabel } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

/** Group name and members; admins can rename, add, remove and promote. */
export default function GroupInfo() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { messenger, session } = useSession();
  const { data: chat } = useConversation(id);
  const people = usePeople();
  const [title, setTitle] = useState<string | null>(null);
  const [adding, setAdding] = useState<PublicUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!chat || chat.kind !== "group") return <View style={{ flex: 1, backgroundColor: p.ground }} />;
  const myRole = chat.members.find((m) => m.accountId === session?.accountId)?.role;
  const isAdmin = myRole === "admin" && !chat.left;

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setNote(null);
    try {
      await work();
      if (done) setNote(done);
    } catch {
      setNote("Не получилось. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function memberActions(member: GroupMember) {
    if (!isAdmin || member.accountId === session?.accountId || !messenger) return;
    Alert.alert(member.displayName, `@${member.username}`, [
      member.role === "admin"
        ? { text: "Сделать участником", onPress: () => void run(() => messenger.setRole(id, member.accountId, "member")) }
        : { text: "Сделать админом", onPress: () => void run(() => messenger.setRole(id, member.accountId, "admin")) },
      { text: "Профиль", onPress: () => router.push({ pathname: "/contact/[id]", params: { id: member.accountId } }) },
      { text: "Удалить из группы", style: "destructive", onPress: () => void run(() => messenger.removeMember(id, member.accountId)) },
      { text: "Отмена", style: "cancel" },
    ]);
  }

  function leave() {
    if (!messenger) return;
    Alert.alert("Выйти из группы?", "Вы больше не будете получать сообщения этой группы.", [
      { text: "Отмена", style: "cancel" },
      { text: "Выйти", style: "destructive", onPress: () => void run(() => messenger.leaveGroup(id)) },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.ground, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 8 }}>
        <NavHeader title="О группе" onBack={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", gap: 10 }}>
          <Avatar name={chat.title} seed={chat.id} size={88} />
          {title === null ? (
            <Pressable disabled={!isAdmin} onPress={() => setTitle(chat.title)} accessibilityRole={isAdmin ? "button" : "header"} accessibilityHint={isAdmin ? "Изменить название" : undefined}>
              <AppText variant="title" style={{ textAlign: "center" }}>
                {chat.title} {isAdmin ? "✎" : ""}
              </AppText>
            </Pressable>
          ) : (
            <View style={{ alignSelf: "stretch", gap: 10 }}>
              <TextField label="Название" value={title} onChangeText={setTitle} maxLength={100} autoFocus />
              <Button
                title="Сохранить"
                loading={busy}
                disabled={!title.trim()}
                onPress={() => void run(async () => {
                  await messenger?.renameGroup(id, title);
                  setTitle(null);
                })}
              />
            </View>
          )}
          <AppText muted>
            {chat.members.length} {plural(chat.members.length)}
            {chat.left ? " · вы не в группе" : ""}
          </AppText>
        </View>

        {isAdmin ? (
          adding === null ? (
            <Button title="Добавить участников" variant="soft" icon="groupAdd" onPress={() => setAdding([])} />
          ) : (
            <View style={{ gap: 10 }}>
              <PeoplePicker selected={adding} onChange={setAdding} exclude={chat.members.map((m) => m.accountId)} />
              <Button
                title={adding.length ? `Добавить (${adding.length})` : "Добавить"}
                disabled={adding.length === 0}
                loading={busy}
                onPress={() =>
                  void run(async () => {
                    const result = await messenger?.addMembers(id, adding);
                    setAdding(null);
                    if (result?.skipped.length) setNote(`Не добавлены (ещё не подключили телефон): ${result.skipped.map((s) => s.displayName).join(", ")}`);
                  })
                }
              />
            </View>
          )
        ) : null}

        {!chat.left && messenger ? (
          <Pressable
            accessibilityRole="button"
            disabled={!isAdmin}
            onPress={() => setTimerOpen(true)}
            style={({ pressed }) => ({ padding: 16, borderRadius: 16, backgroundColor: pressed ? p.surfaceMuted : p.surface, flexDirection: "row", alignItems: "center", gap: 12 })}
          >
            <View style={{ flex: 1 }}>
              <AppText>Исчезающие сообщения</AppText>
              {isAdmin ? null : (
                <AppText variant="caption" muted>
                  Меняют админы
                </AppText>
              )}
            </View>
            <AppText muted>{timerLabel(chat.timer ?? 0)}</AppText>
          </Pressable>
        ) : null}

        <View style={{ borderRadius: 16, backgroundColor: p.surface, overflow: "hidden" }}>
          {chat.members.map((member, i) => (
            <Pressable
              key={member.accountId}
              disabled={member.accountId === session?.accountId}
              onPress={() => (isAdmin ? memberActions(member) : router.push({ pathname: "/contact/[id]", params: { id: member.accountId } }))}
              accessibilityRole={member.accountId !== session?.accountId ? "button" : undefined}
              accessibilityLabel={`${nameOf(people, member.accountId, member.displayName)}, @${member.username}${member.role === "admin" ? ", админ" : ""}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: p.separator,
                backgroundColor: pressed ? p.surfaceMuted : "transparent",
              })}
            >
              <Avatar name={member.displayName} seed={member.accountId} size={42} photo={people.get(member.accountId)?.photo} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {member.accountId === session?.accountId
                    ? `${nameOf(people, member.accountId, member.displayName)} (вы)`
                    : nameOf(people, member.accountId, member.displayName)}
                </AppText>
                <AppText variant="caption" muted>
                  @{member.username}
                </AppText>
              </View>
              {member.role === "admin" ? (
                <AppText variant="caption" color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                  админ
                </AppText>
              ) : null}
              {isAdmin && member.accountId !== session?.accountId ? <Icon name="chevron" size={16} color={p.textSubtle} strokeWidth={2} /> : null}
            </Pressable>
          ))}
        </View>

        {note ? (
          <AppText muted accessibilityLiveRegion="polite">
            {note}
          </AppText>
        ) : null}

        {chat.left ? null : <Button title="Выйти из группы" variant="ghost" onPress={leave} />}
      </ScrollView>
      {messenger ? <TimerSheet messenger={messenger} chat={chat} visible={timerOpen} onClose={() => setTimerOpen(false)} /> : null}
    </View>
  );
}

function plural(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "участников";
  if (ones === 1) return "участник";
  if (ones >= 2 && ones <= 4) return "участника";
  return "участников";
}
