import type { PublicUser } from "@leks/protocol";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, NavHeader, Notice, TextField } from "@/components/ui";
import { PeoplePicker } from "@/features/PeoplePicker";
import { MessengerError } from "@/messaging/messenger";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

export default function NewGroup() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { messenger } = useSession();
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = title.trim().length > 0 && people.length > 0 && !!messenger;

  async function create() {
    if (!ready || !messenger) return;
    setBusy(true);
    setError(null);
    try {
      const { id, skipped } = await messenger.createGroup(title, people);
      router.replace({ pathname: "/chat/[id]", params: { id, ...(skipped.length ? { skipped: skipped.map((s) => s.displayName).join(", ") } : {}) } });
    } catch (e) {
      setError(e instanceof MessengerError && e.code === "too_many" ? "В группе может быть до 200 человек." : "Не удалось создать группу. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.ground, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 8 }}>
        <NavHeader title="Новая группа" onBack={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <TextField label="Название" value={title} onChangeText={setTitle} placeholder="Например, «Команда продаж»" maxLength={100} autoFocus />
        <View style={{ gap: 8 }}>
          <AppText variant="bodyStrong">Участники · {people.length}</AppText>
          <PeoplePicker selected={people} onChange={setPeople} />
        </View>
        <Notice icon="lock">Название, участники и все сообщения группы зашифрованы. Сервер не знает даже, как называется группа.</Notice>
        {error ? (
          <AppText color={p.danger} accessibilityLiveRegion="assertive">
            {error}
          </AppText>
        ) : null}
        <Button title="Создать группу" onPress={() => void create()} disabled={!ready} loading={busy} />
      </ScrollView>
    </View>
  );
}
