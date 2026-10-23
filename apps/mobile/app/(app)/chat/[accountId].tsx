import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { AppText, Avatar, IconButton } from "@/components/ui";
import { fonts, usePalette } from "@/theme";

/**
 * A conversation. Encrypting and sending arrive with the encryption module
 * (next build); this build shows the conversation screen and the composer.
 */
export default function Chat() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { accountId, name, username } = useLocalSearchParams<{ accountId: string; name?: string; username?: string }>();
  const displayName = name ?? username ?? "Собеседник";
  const [draft, setDraft] = useState("");

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.chatGround }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: p.surface,
          borderBottomWidth: 1,
          borderBottomColor: p.separator,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <IconButton icon="back" label="Назад к чатам" tone="plain" onPress={() => router.back()} />
        <Avatar name={displayName} seed={accountId} size={42} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading" numberOfLines={1}>
            {displayName}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Icon name="lock" size={12} color={p.textMuted} strokeWidth={2.4} />
            <AppText variant="caption" muted>
              {username ? `@${username}` : "защищённый чат"}
            </AppText>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", padding: 12, gap: 6 }}>
        <View style={{ alignSelf: "center", maxWidth: 300, padding: 14, borderRadius: 14, backgroundColor: p.surface, flexDirection: "row", gap: 10 }}>
          <Icon name="lock" size={16} color={p.accentText} strokeWidth={2.2} />
          <AppText variant="caption" muted style={{ flex: 1 }}>
            Сообщения защищены сквозным шифрованием. Прочитать их сможете только вы и {displayName}.
          </AppText>
        </View>
      </ScrollView>

      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: 10,
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: p.surface,
          borderTopWidth: 1,
          borderTopColor: p.separator,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
          <View style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: p.surfaceMuted, justifyContent: "center", paddingHorizontal: 16 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Сообщение"
              placeholderTextColor={p.textSubtle}
              accessibilityLabel="Сообщение"
              multiline
              style={{ fontFamily: fonts.regular, fontSize: 16, color: p.text, maxHeight: 120, paddingVertical: 10 }}
            />
          </View>
          <View style={{ opacity: 0.4 }}>
            <IconButton icon="send" label="Отправить (будет доступно в следующей сборке)" tone="accent" />
          </View>
        </View>
        <AppText variant="caption" muted style={{ textAlign: "center" }}>
          Отправка заработает в следующей сборке, вместе с шифрованием.
        </AppText>
      </View>
    </KeyboardAvoidingView>
  );
}
