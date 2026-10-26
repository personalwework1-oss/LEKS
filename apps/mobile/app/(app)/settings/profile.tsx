import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Platform, Pressable, View } from "react-native";
import { PhotoViewer } from "@/components/PhotoViewer";
import { AppText, Avatar, Button, NavHeader, Screen, TextField } from "@/components/ui";
import { pickProfilePhoto } from "@/features/attachments";
import { usePeople } from "@/messaging/hooks";
import { MAX_ABOUT, MAX_DISPLAY_NAME } from "@/messaging/types";
import { useSession } from "@/state/session";
import { fonts, usePalette } from "@/theme";

/** My photo, name and "about": seen only by people I chat with (the name also by those who look me up). */
export default function ProfileScreen() {
  const p = usePalette();
  const { session, messenger } = useSession();
  const people = usePeople();
  const me = session ? people.get(session.accountId) : undefined;
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  // Fill the form once, from what is saved.
  useEffect(() => {
    if (loaded || !session || !messenger) return;
    void messenger.person(session.accountId).then((saved) => {
      setName(saved?.displayName ?? session.displayName);
      setAbout(saved?.about ?? "");
      setPhoto(saved?.photo ?? null);
      setLoaded(true);
    });
  }, [loaded, session, messenger]);

  if (!session) return null;
  const savedName = me?.displayName ?? session.displayName;
  const changed = loaded && (name.trim() !== savedName || about.trim() !== (me?.about ?? "") || photo !== (me?.photo ?? null));
  const canSave = changed && name.trim().length > 0 && !busy && !!messenger;

  async function choose(source: "gallery" | "camera") {
    setError(null);
    try {
      const picked = await pickProfilePhoto(source);
      if (picked) setPhoto(picked);
    } catch {
      setError("Не удалось открыть фото. Попробуйте другое.");
    }
  }

  function photoMenu() {
    const options = ["Выбрать из галереи", "Сделать фото", ...(photo ? ["Удалить фото"] : []), "Отмена"];
    const act = (index: number) => {
      if (index === 0) void choose("gallery");
      else if (index === 1) void choose("camera");
      else if (photo && index === 2) setPhoto(null);
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: photo ? 2 : undefined },
        act,
      );
    } else {
      Alert.alert("Фото профиля", undefined, [
        { text: "Галерея", onPress: () => act(0) },
        { text: "Камера", onPress: () => act(1) },
        ...(photo ? [{ text: "Удалить", style: "destructive" as const, onPress: () => act(2) }] : []),
      ], { cancelable: true });
    }
  }

  async function save() {
    if (!canSave || !messenger) return;
    setBusy(true);
    setError(null);
    try {
      await messenger.setProfile({ displayName: name, about, photo });
      router.back();
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <NavHeader title="Профиль" onBack={() => router.back()} />
      <View style={{ alignItems: "center", marginTop: 20, gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={photo ? "Открыть фото" : "Добавить фото"}
          onPress={() => (photo ? setViewing(true) : photoMenu())}
        >
          <Avatar name={name || savedName} seed={session.accountId} size={112} photo={photo} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={photoMenu} hitSlop={8}>
          <AppText color={p.accentText} style={{ fontFamily: fonts.semibold }}>
            {photo ? "Изменить фото" : "Добавить фото"}
          </AppText>
        </Pressable>
      </View>

      <View style={{ gap: 16, marginTop: 24 }}>
        <TextField label="Имя" value={name} onChangeText={setName} maxLength={MAX_DISPLAY_NAME} autoCapitalize="words" />
        <TextField
          label="О себе"
          value={about}
          onChangeText={setAbout}
          maxLength={MAX_ABOUT}
          multiline
          hint={`${about.length}/${MAX_ABOUT}`}
          placeholder="Например: дизайнер, на связи с 10 до 19"
        />
        <AppText variant="caption" muted>
          {`@${session.username} · фото и «о себе» видят только те, с кем у вас есть чат, — они передаются в зашифрованном виде.`}
        </AppText>
      </View>

      <View style={{ marginTop: 20 }}>
        <Button title="Мой QR-код и ссылка" variant="soft" icon="qr" onPress={() => router.push("/settings/qr")} />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      {error ? (
        <AppText variant="caption" color={p.danger} style={{ textAlign: "center", marginBottom: 12 }}>
          {error}
        </AppText>
      ) : null}
      <Button title="Сохранить" onPress={() => void save()} disabled={!canSave} loading={busy} />
      <PhotoViewer photo={viewing ? photo : null} name={name} onClose={() => setViewing(false)} />
    </Screen>
  );
}
