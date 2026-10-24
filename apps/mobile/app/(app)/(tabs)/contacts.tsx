import { type PublicUser, Username } from "@leks/protocol";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Icon } from "@/components/Icon";
import { AppText, Avatar } from "@/components/ui";
import { MessengerError } from "@/messaging/messenger";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Search = { phase: "idle" } | { phase: "searching" } | { phase: "done"; user: PublicUser | null } | { phase: "error" };

/** Find a person by username and open a chat with them. */
export default function Contacts() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { realtime, session, messenger } = useSession();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ phase: "idle" });
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function openChat(user: PublicUser) {
    if (!messenger) {
      setOpenError("Шифрование ещё запускается. Попробуйте через пару секунд.");
      return;
    }
    setOpening(true);
    setOpenError(null);
    try {
      const id = await messenger.startChat(user);
      router.push({ pathname: "/chat/[id]", params: { id } });
    } catch (error) {
      setOpenError(
        error instanceof MessengerError && error.code === "no_devices"
          ? `${user.displayName} пока не может получать сообщения: приложение у него ещё не подключилось к серверу.`
          : "Не удалось начать чат. Проверьте интернет и попробуйте ещё раз.",
      );
    } finally {
      setOpening(false);
    }
  }

  const handle = Username.safeParse(query.replace(/^@/, ""));

  useEffect(() => {
    if (!handle.success || !realtime) {
      setSearch({ phase: "idle" });
      return;
    }
    setSearch({ phase: "searching" });
    let cancelled = false;
    const timer = setTimeout(() => {
      realtime
        .request({ type: "lookup_user", username: handle.data }, "user")
        .then((answer) => !cancelled && setSearch({ phase: "done", user: answer.user }))
        .catch(() => !cancelled && setSearch({ phase: "error" }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle.success ? handle.data : null, realtime]);

  const found = search.phase === "done" ? search.user : null;
  const isMe = found?.accountId === session?.accountId;

  return (
    <View style={{ flex: 1, backgroundColor: p.scheme === "dark" ? p.ground : p.surface, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text accessibilityRole="header" style={{ fontFamily: fonts.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6, color: p.text }}>
          Новый чат
        </Text>
      </View>
      <ConnectionBanner />

      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <View style={{ height: 48, borderRadius: 14, backgroundColor: p.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
          <Icon name="search" size={20} color={p.textMuted} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={(text) => setQuery(text.replace(/\s/g, ""))}
            placeholder="Имя пользователя, например @sanya_k"
            placeholderTextColor={p.textSubtle}
            accessibilityLabel="Поиск по имени пользователя"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: p.text, paddingVertical: 0 }}
          />
        </View>
      </View>

      <View style={{ paddingTop: 12 }}>
        {search.phase === "searching" ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator color={p.textMuted} />
          </View>
        ) : null}

        {found && !isMe ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Написать ${found.displayName}, @${found.username}`}
            disabled={opening}
            onPress={() => void openChat(found)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 9, backgroundColor: pressed ? p.surfaceMuted : "transparent" })}
          >
            <Avatar name={found.displayName} seed={found.accountId} size={48} />
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{found.displayName}</AppText>
              <AppText variant="caption" muted style={{ fontSize: 14 }}>
                @{found.username} · написать
              </AppText>
            </View>
            {opening ? <ActivityIndicator color={p.textMuted} /> : <Icon name="chevron" size={18} color={p.textSubtle} strokeWidth={2} />}
          </Pressable>
        ) : null}
        {openError ? (
          <AppText variant="caption" color={p.danger} style={{ paddingHorizontal: 20, paddingTop: 4 }} accessibilityLiveRegion="assertive">
            {openError}
          </AppText>
        ) : null}

        {isMe ? <Hint text="Это вы. Найдите другого человека." /> : null}
        {search.phase === "done" && !found ? <Hint text={`Пользователь @${handle.success ? handle.data : ""} не найден.`} /> : null}
        {search.phase === "error" ? <Hint text="Не удалось выполнить поиск. Проверьте интернет." /> : null}
        {search.phase === "idle" ? (
          <Hint text={query.length > 0 ? "Имя пользователя: 3–32 символа, латинские буквы, цифры и _." : "Введите точное имя пользователя. Поиск по номеру телефона здесь не нужен."} />
        ) : null}
      </View>
    </View>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <AppText muted style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
      {text}
    </AppText>
  );
}
