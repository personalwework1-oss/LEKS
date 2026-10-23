import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Text, View } from "react-native";
import { AppText, Button, Notice } from "../components/ui";
import { useSession } from "../state/session";
import { fonts, radius, usePalette } from "../theme";

export type BackupCodeState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "created"; code: string }
  | { phase: "error"; message: string };

/** Creates a backup code through the server and shows it once. */
export function useBackupCode() {
  const { realtime } = useSession();
  const [state, setState] = useState<BackupCodeState>({ phase: "idle" });
  return {
    state,
    async create() {
      if (!realtime) return;
      setState({ phase: "creating" });
      try {
        const answer = await realtime.request({ type: "create_recovery_code" }, "recovery_code");
        setState({ phase: "created", code: answer.recoveryCode });
      } catch {
        setState({ phase: "error", message: "Не удалось создать код. Проверьте интернет и попробуйте ещё раз." });
      }
    },
  };
}

export function BackupCodeCard({ code }: { code: string }) {
  const p = usePalette();
  const [copied, setCopied] = useState(false);
  const groups = code.split("-");
  return (
    <View style={{ padding: 16, borderRadius: radius.card, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, gap: 14 }}>
      <View
        accessible
        accessibilityLabel={`Запасной код: ${groups.join(", ")}`}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}
      >
        {groups.map((group, i) => (
          <View key={i} style={{ width: "30%", paddingVertical: 10, borderRadius: 10, backgroundColor: p.ground, alignItems: "center" }}>
            <Text selectable style={{ fontFamily: fonts.semibold, fontSize: 19, letterSpacing: 1.5, color: p.text }}>
              {group}
            </Text>
          </View>
        ))}
      </View>
      <Button
        title={copied ? "Скопировано" : "Скопировать"}
        icon={copied ? "check" : "copy"}
        variant="soft"
        onPress={async () => {
          await Clipboard.setStringAsync(code);
          setCopied(true);
        }}
      />
    </View>
  );
}

export function BackupCodeError({ message }: { message: string }) {
  const p = usePalette();
  return (
    <AppText variant="caption" color={p.danger} style={{ textAlign: "center" }} accessibilityLiveRegion="assertive">
      {message}
    </AppText>
  );
}

export const NO_CODE_WARNING =
  "Без кода забытый пароль восстановить нельзя: у нас нет вашего номера и почты. Создать код можно и позже, в настройках.";

export function NoCodeWarning() {
  return <Notice tone="warning">{NO_CODE_WARNING}</Notice>;
}
