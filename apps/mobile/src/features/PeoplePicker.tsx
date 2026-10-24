import { type PublicUser, Username } from "@leks/protocol";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { Icon } from "@/components/Icon";
import { AppText, Avatar } from "@/components/ui";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

type Search = { phase: "idle" } | { phase: "searching" } | { phase: "done"; user: PublicUser | null } | { phase: "error" };

/** Find people by exact username and collect them (for creating or extending a group). */
export function PeoplePicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: PublicUser[];
  onChange: (people: PublicUser[]) => void;
  /** Accounts that cannot be picked (already in the group). */
  exclude?: string[];
}) {
  const p = usePalette();
  const { realtime, session } = useSession();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search>({ phase: "idle" });
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

  const user = search.phase === "done" ? search.user : null;
  const unavailable =
    user && (user.accountId === session?.accountId ? "Это вы" : exclude.includes(user.accountId) ? "Уже в группе" : selected.some((s) => s.accountId === user.accountId) ? "Уже выбран" : null);

  return (
    <View style={{ gap: 10 }}>
      {selected.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {selected.map((person) => (
            <Pressable
              key={person.accountId}
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${person.displayName}`}
              onPress={() => onChange(selected.filter((s) => s.accountId !== person.accountId))}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 4, paddingRight: 10, height: 34, borderRadius: 17, backgroundColor: p.accentSoft }}
            >
              <Avatar name={person.displayName} seed={person.accountId} size={26} />
              <AppText variant="caption" color={p.accentText} style={{ fontFamily: fonts.semibold }}>
                {person.displayName}
              </AppText>
              <Icon name="close" size={14} color={p.accentText} strokeWidth={2.4} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ height: 48, borderRadius: 14, backgroundColor: p.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
        <Icon name="search" size={20} color={p.textMuted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={(text) => setQuery(text.replace(/\s/g, ""))}
          placeholder="Имя пользователя, например @sanya_k"
          placeholderTextColor={p.textSubtle}
          accessibilityLabel="Добавить участника по имени пользователя"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: p.text, paddingVertical: 0 }}
        />
      </View>

      {search.phase === "searching" ? <ActivityIndicator color={p.textMuted} /> : null}
      {user ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unavailable ? `${user.displayName}: ${unavailable}` : `Добавить ${user.displayName}`}
          disabled={!!unavailable}
          onPress={() => {
            onChange([...selected, user]);
            setQuery("");
          }}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, opacity: unavailable ? 0.5 : pressed ? 0.7 : 1 })}
        >
          <Avatar name={user.displayName} seed={user.accountId} size={44} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{user.displayName}</AppText>
            <AppText variant="caption" muted>
              @{user.username}
              {unavailable ? ` · ${unavailable}` : ""}
            </AppText>
          </View>
          {unavailable ? null : <Icon name="groupAdd" size={22} color={p.accentText} strokeWidth={2} />}
        </Pressable>
      ) : null}
      {search.phase === "done" && !search.user ? <AppText muted>Пользователь @{handle.success ? handle.data : ""} не найден.</AppText> : null}
      {search.phase === "error" ? <AppText muted>Не удалось выполнить поиск. Проверьте интернет.</AppText> : null}
      {search.phase === "idle" && query.length > 0 ? <AppText muted>3–32 символа: латинские буквы, цифры и _.</AppText> : null}
    </View>
  );
}
