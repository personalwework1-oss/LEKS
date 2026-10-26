import type { ReportReason } from "@leks/protocol";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { AppText, Button } from "@/components/ui";
import { usePalette } from "@/theme";

const REASONS: { id: ReportReason; label: string }[] = [
  { id: "spam", label: "Спам или реклама" },
  { id: "scam", label: "Мошенничество" },
  { id: "abuse", label: "Оскорбления или угрозы" },
  { id: "illegal", label: "Незаконный контент" },
  { id: "other", label: "Другое" },
];

export interface ReportChoice {
  reason: ReportReason;
  attach: boolean;
  block: boolean;
}

/** Why I report someone, whether their last messages go with it, and whether to block them too. */
export function ReportSheet({
  name,
  visible,
  canAttach,
  onClose,
  onSend,
}: {
  name: string;
  visible: boolean;
  canAttach: boolean;
  onClose: () => void;
  onSend: (choice: ReportChoice) => Promise<void>;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [attach, setAttach] = useState(true);
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ reason, attach: canAttach && attach, block });
      setReason(null);
    } catch {
      setError("Не удалось отправить. Проверьте интернет.");
    } finally {
      setBusy(false);
    }
  }

  const check = (on: boolean, label: string, hint: string, toggle: () => void) => (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={toggle} style={{ flexDirection: "row", gap: 12, paddingVertical: 8 }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: on ? p.accent : p.textSubtle,
          backgroundColor: on ? p.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on ? <Icon name="check" size={16} color={p.onAccent} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <AppText>{label}</AppText>
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
        <Pressable
          onPress={() => undefined}
          style={{ backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 6 }}
        >
          <AppText variant="heading">{`Пожаловаться на ${name}`}</AppText>
          <AppText variant="caption" muted style={{ marginBottom: 8 }}>
            Он не узнает, кто пожаловался.
          </AppText>
          {REASONS.map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r.id }}
              onPress={() => setReason(r.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: reason === r.id ? p.accent : p.textSubtle, alignItems: "center", justifyContent: "center" }}>
                {reason === r.id ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.accent }} /> : null}
              </View>
              <AppText>{r.label}</AppText>
            </Pressable>
          ))}
          <View style={{ height: 1, backgroundColor: p.separator, marginVertical: 8 }} />
          {canAttach
            ? check(attach, "Приложить последние сообщения", "До 10 его сообщений из этого чата. Иначе мы не сможем их увидеть: переписка зашифрована.", () => setAttach(!attach))
            : null}
          {check(block, "Заблокировать", "Он больше не сможет писать и звонить вам.", () => setBlock(!block))}
          {error ? (
            <AppText variant="caption" color={p.danger}>
              {error}
            </AppText>
          ) : null}
          <View style={{ marginTop: 10 }}>
            <Button title="Отправить жалобу" onPress={() => void send()} disabled={!reason} loading={busy} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
