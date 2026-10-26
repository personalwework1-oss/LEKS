import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { AppText, Avatar, NavHeader, Screen } from "@/components/ui";
import { nameOf, usePeople } from "@/messaging/hooks";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

/** People I blocked; kept on the server, so the list is the same on all my phones. */
export default function BlockedScreen() {
  const p = usePalette();
  const { messenger } = useSession();
  const people = usePeople();
  const blocked = [...people.values()].filter((person) => person.blocked);

  useEffect(() => {
    void messenger?.refreshBlocks().catch(() => undefined);
  }, [messenger]);

  return (
    <Screen scroll>
      <NavHeader title="Заблокированные" onBack={() => router.back()} />
      <AppText muted style={{ marginTop: 16 }}>
        Они не могут писать, звонить и начинать с вами новые чаты. Они не узнают, что вы их заблокировали.
      </AppText>
      <View style={{ borderRadius: 16, backgroundColor: p.surface, overflow: "hidden", marginTop: 20 }}>
        {blocked.length === 0 ? (
          <AppText muted style={{ padding: 16 }}>
            Никого нет.
          </AppText>
        ) : (
          blocked.map((person, i) => {
            const name = nameOf(people, person.accountId, person.displayName || "Пользователь");
            return (
              <View key={person.accountId}>
                {i > 0 ? <View style={{ height: 1, marginLeft: 14, backgroundColor: p.separator }} /> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
                  <Avatar name={name} seed={person.accountId} size={40} photo={person.photo} />
                  <View style={{ flex: 1 }}>
                    <AppText numberOfLines={1}>{name}</AppText>
                    {person.username ? (
                      <AppText variant="caption" muted>
                        @{person.username}
                      </AppText>
                    ) : null}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Разблокировать ${name}`} onPress={() => void messenger?.unblock(person.accountId)} hitSlop={8}>
                    <AppText color={p.accentText}>Разблокировать</AppText>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}
