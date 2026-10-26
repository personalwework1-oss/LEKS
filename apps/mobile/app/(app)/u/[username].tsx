import type { PublicUser } from "@leks/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { AppText, Avatar, Button, NavHeader, Screen } from "@/components/ui";
import { MessengerError } from "@/messaging/messenger";
import { useSession } from "@/state/session";

/** Opened from a profile link or QR code: who it is, and a button to write. */
export default function ProfileLink() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { realtime, messenger, session } = useSession();
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!realtime || !username) return;
    let alive = true;
    realtime
      .request({ type: "lookup_user", username: username.toLowerCase() }, "user")
      .then((answer) => alive && setUser(answer.user))
      .catch(() => alive && setUser(null));
    return () => {
      alive = false;
    };
  }, [realtime, username]);

  async function write() {
    if (!user || !messenger) return;
    setBusy(true);
    setError(null);
    try {
      const id = await messenger.startChat(user);
      router.replace({ pathname: "/chat/[id]", params: { id } });
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof MessengerError && e.code === "no_devices"
          ? "У этого человека приложение ещё не подключилось к серверу."
          : (e as { code?: string })?.code === "new_chats_limited"
            ? "Сейчас нельзя начинать новые чаты. Попробуйте завтра."
            : "Не удалось открыть чат. Проверьте интернет.",
      );
    }
  }

  const isMe = user && user.accountId === session?.accountId;
  return (
    <Screen>
      <NavHeader title="Профиль" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        {user === undefined ? (
          <ActivityIndicator />
        ) : user === null ? (
          <AppText muted style={{ textAlign: "center" }}>{`Пользователь @${username} не найден.`}</AppText>
        ) : (
          <>
            <Avatar name={user.displayName} seed={user.accountId} size={96} />
            <AppText variant="title">{user.displayName}</AppText>
            <AppText muted>@{user.username}</AppText>
          </>
        )}
      </View>
      {error ? (
        <AppText variant="caption" style={{ textAlign: "center", marginBottom: 12 }} muted>
          {error}
        </AppText>
      ) : null}
      {user && !isMe ? <Button title="Написать" onPress={() => void write()} loading={busy} /> : null}
      {isMe ? <AppText muted style={{ textAlign: "center" }}>Это ваш профиль.</AppText> : null}
    </Screen>
  );
}
