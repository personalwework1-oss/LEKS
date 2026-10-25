import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText, NavHeader, Screen } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { clockTime, dayLabel } from "@/format";
import { useSession } from "@/state/session";
import { usePalette } from "@/theme";

interface Device {
  deviceId: string;
  platform: string;
  lastSeenAt: number | null;
}

/** My phones signed in to this account; any other one can be signed out and removed from all chats. */
export default function DevicesScreen() {
  const p = usePalette();
  const { realtime, session, messenger } = useSession();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!realtime || !session) return;
    realtime
      .request({ type: "list_devices", accountId: session.accountId }, "devices")
      .then((answer) => {
        setDevices(answer.devices);
        setError(null);
      })
      .catch(() => setError("Не удалось загрузить список. Проверьте интернет."));
  }, [realtime, session]);
  useFocusEffect(load);

  function confirmRemove(device: Device) {
    Alert.alert(
      "Выйти на этом устройстве?",
      "Оно выйдет из аккаунта и больше не получит новых сообщений. Если это не ваше устройство — смените пароль.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Выйти",
          style: "destructive",
          onPress: async () => {
            if (!realtime || !session) return;
            try {
              await realtime.request({ type: "remove_device", deviceId: device.deviceId }, "device_removed");
              // Out of every chat right away (and the others in them are told to check too).
              void messenger?.onNudge(session.accountId).catch(() => undefined);
              void messenger?.nudgeContacts().catch(() => undefined);
              load();
            } catch {
              setError("Не удалось. Проверьте интернет и попробуйте ещё раз.");
            }
          },
        },
      ],
    );
  }

  const name = (d: Device) => (d.platform === "ios" ? "iPhone" : d.platform === "android" ? "Android" : "Устройство");
  const seen = (d: Device) => (d.lastSeenAt ? `Был в сети ${dayLabel(d.lastSeenAt).toLowerCase()}, ${clockTime(d.lastSeenAt)}` : "Давно не был в сети");

  return (
    <Screen scroll>
      <NavHeader title="Устройства" onBack={() => router.back()} />
      <AppText muted style={{ marginTop: 16 }}>
        Телефоны, на которых выполнен вход в ваш аккаунт. Каждый получает сообщения в зашифрованном виде; новый появляется в ваших чатах с отметкой «новое
        устройство».
      </AppText>
      <View style={{ borderRadius: 16, backgroundColor: p.surface, overflow: "hidden", marginTop: 20 }}>
        {(devices ?? []).map((d, i) => {
          const self = d.deviceId === session?.deviceId;
          return (
            <View key={d.deviceId}>
              {i > 0 ? <View style={{ height: 1, marginLeft: 14, backgroundColor: p.separator }} /> : null}
              <View style={{ minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Icon name="lock" size={18} color={p.accentText} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <AppText>{self ? `${name(d)} · это устройство` : name(d)}</AppText>
                  <AppText variant="caption" muted>
                    {self ? "Сейчас в сети" : seen(d)}
                  </AppText>
                </View>
                {self ? null : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Выйти на устройстве ${name(d)}`} onPress={() => confirmRemove(d)} hitSlop={8}>
                    <AppText color={p.danger}>Выйти</AppText>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
        {devices === null && !error ? (
          <AppText muted style={{ padding: 14 }}>
            Загружаем…
          </AppText>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" color={p.danger} style={{ marginTop: 14, textAlign: "center" }}>
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}
