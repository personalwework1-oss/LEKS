import { router } from "expo-router";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/Icon";
import { LeksMark } from "@/components/LeksMark";
import { AppText, Button, Screen } from "@/components/ui";
import { usePalette } from "@/theme";

const points: { icon: IconName; title: string; text: string }[] = [
  { icon: "at", title: "Только имя пользователя", text: "Номер телефона и почта не нужны" },
  { icon: "lock", title: "Шифрование во всех чатах", text: "Включено всегда, в группах тоже" },
  { icon: "shield", title: "Сервер ничего не читает", text: "Ключи хранятся только на ваших устройствах" },
];

export default function Welcome() {
  const p = usePalette();
  return (
    <Screen scroll>
      <View style={{ marginTop: 28 }}>
        <LeksMark size={64} color={p.mark} />
      </View>
      <AppText variant="title" style={{ marginTop: 40, fontSize: 34, lineHeight: 40 }}>
        Переписка, которая принадлежит только вам
      </AppText>
      <AppText muted style={{ marginTop: 14, fontSize: 17, lineHeight: 24 }}>
        Мессенджер для личного общения и работы. Без номера телефона и лишних данных.
      </AppText>

      <View style={{ gap: 18, marginTop: 36 }}>
        {points.map((point) => (
          <View key={point.title} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name={point.icon} size={22} color={p.accentText} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{point.title}</AppText>
              <AppText variant="caption" muted style={{ fontSize: 14, lineHeight: 20 }}>
                {point.text}
              </AppText>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1, minHeight: 32 }} />

      <View style={{ gap: 12 }}>
        <Button title="Создать аккаунт" onPress={() => router.push("/register")} />
        <Button title="У меня уже есть аккаунт" variant="secondary" onPress={() => router.push("/login")} />
      </View>
      {/* Links to the Terms and Privacy Policy are added once those documents are published. */}
      <AppText variant="caption" muted style={{ marginTop: 16, textAlign: "center" }}>
        Продолжая, вы принимаете Условия и Политику конфиденциальности
      </AppText>
    </Screen>
  );
}
