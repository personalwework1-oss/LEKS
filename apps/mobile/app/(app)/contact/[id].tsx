import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { PhotoViewer } from "@/components/PhotoViewer";
import { AppText, Avatar, Button, IconButton, NavHeader, Screen, TextField } from "@/components/ui";
import { nameOf, useConversations, usePeople } from "@/messaging/hooks";
import { MAX_DISPLAY_NAME } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

/** Someone's profile: photo, name, about; and my own name for them, kept on this phone. */
export default function ContactScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { messenger, calls } = useSession();
  const people = usePeople();
  const { data: chats } = useConversations();
  const person = people.get(id);
  const chat = chats.find((c) => c.kind === "direct" && c.peerAccountId === id);
  const theirName = person?.displayName || chat?.title || "Собеседник";
  const shown = nameOf(people, id, theirName);
  const username = person?.username ?? chat?.username ?? null;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [viewing, setViewing] = useState(false);

  async function saveNickname(value: string | null) {
    await messenger?.setNickname(id, value);
    setRenaming(false);
  }

  async function openChat() {
    if (chat) router.replace({ pathname: "/chat/[id]", params: { id: chat.id } });
    else if (messenger && username) {
      const chatId = await messenger.startChat({ accountId: id, username, displayName: theirName });
      router.replace({ pathname: "/chat/[id]", params: { id: chatId } });
    }
  }

  return (
    <Screen scroll>
      <NavHeader title="Профиль" onBack={() => router.back()} />
      <View style={{ alignItems: "center", marginTop: 20, gap: 8 }}>
        <Pressable
          disabled={!person?.photo}
          accessibilityRole={person?.photo ? "button" : undefined}
          accessibilityLabel="Открыть фото"
          onPress={() => setViewing(true)}
        >
          <Avatar name={shown} seed={id} size={120} photo={person?.photo} />
        </Pressable>
        <AppText variant="title" style={{ textAlign: "center", marginTop: 8 }}>
          {shown}
        </AppText>
        {person?.nickname ? (
          <AppText muted>{`В профиле: ${theirName}`}</AppText>
        ) : null}
        {username ? <AppText muted>@{username}</AppText> : null}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 18, marginTop: 20 }}>
        <IconButton icon="compose" label="Написать" tone="soft" onPress={() => void openChat()} />
        {chat && !chat.left ? (
          <>
            <IconButton icon="phone" label="Аудиозвонок" tone="soft" onPress={() => void calls?.start(chat.id, false)} />
            <IconButton icon="video" label="Видеозвонок" tone="soft" onPress={() => void calls?.start(chat.id, true)} />
          </>
        ) : null}
      </View>

      {person?.about ? (
        <View style={{ marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: p.surface, gap: 4 }}>
          <AppText variant="caption" muted>
            О себе
          </AppText>
          <AppText>{person.about}</AppText>
        </View>
      ) : null}

      <View style={{ marginTop: 16, padding: 16, borderRadius: 16, backgroundColor: p.surface, gap: 12 }}>
        {renaming ? (
          <>
            <TextField label="Как вы его подпишете" value={draft} onChangeText={setDraft} maxLength={MAX_DISPLAY_NAME} autoFocus autoCapitalize="words" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Отмена" variant="ghost" onPress={() => setRenaming(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Сохранить" onPress={() => void saveNickname(draft)} disabled={!draft.trim()} />
              </View>
            </View>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDraft(person?.nickname ?? theirName);
                setRenaming(true);
              }}
            >
              <AppText color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                {person?.nickname ? "Изменить имя контакта" : "Переименовать контакт"}
              </AppText>
            </Pressable>
            {person?.nickname ? (
              <Pressable accessibilityRole="button" onPress={() => void saveNickname(null)}>
                <AppText muted>{`Вернуть имя «${theirName}»`}</AppText>
              </Pressable>
            ) : null}
            <AppText variant="caption" muted>
              Это имя видите только вы, оно хранится на этом телефоне.
            </AppText>
          </>
        )}
      </View>
      <PhotoViewer photo={viewing ? (person?.photo ?? null) : null} name={shown} onClose={() => setViewing(false)} />
    </Screen>
  );
}
