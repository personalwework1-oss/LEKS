import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useSession } from "../state/session";
import { secure } from "../storage/secure";
import { fonts, usePalette } from "../theme";
import { Icon } from "./Icon";
import { AppText } from "./ui";

const REMIND_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;

/** On the chats list while the backup is off (phones signed in before it existed): one tap to turn it on. */
export function BackupReminder() {
  const p = usePalette();
  const { messenger } = useSession();
  const [show, setShow] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void secure.loadBackup().then((s) => setShow(!s.key && Date.now() > s.remindAfter), () => setShow(false));
    }, []),
  );

  if (!show || !messenger) return null;

  async function later() {
    setShow(false);
    const settings = await secure.loadBackup();
    await secure.saveBackup({ ...settings, remindAfter: Date.now() + REMIND_AGAIN_MS });
  }

  return (
    <View style={{ marginHorizontal: 20, marginTop: 12, borderRadius: 16, backgroundColor: p.accentSoft, padding: 14, flexDirection: "row", gap: 12 }}>
      <Icon name="shield" size={20} color={p.accentText} strokeWidth={2} />
      <View style={{ flex: 1, gap: 4 }}>
        <AppText style={{ fontFamily: fonts.semibold }}>Включите резервную копию</AppText>
        <AppText variant="caption" muted>
          Чтобы не потерять переписку при смене телефона. Нужно один раз ввести пароль.
        </AppText>
        <View style={{ flexDirection: "row", gap: 20, marginTop: 6 }}>
          <Pressable accessibilityRole="button" onPress={() => router.push("/settings/backup")} hitSlop={8}>
            <AppText color={p.accentText} style={{ fontFamily: fonts.semibold }}>
              Включить
            </AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void later()} hitSlop={8}>
            <AppText muted>Позже</AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
