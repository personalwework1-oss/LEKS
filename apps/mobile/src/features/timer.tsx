import { ActionSheet } from "@/components/ActionSheet";
import type { Messenger } from "@/messaging/messenger";
import { type Conversation, TIMER_CHOICES, timerLabel } from "@/messaging/types";

/** Picks how long new messages in the chat live. */
export function TimerSheet({ messenger, chat, visible, onClose }: { messenger: Messenger; chat: Conversation; visible: boolean; onClose: () => void }) {
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title="Исчезающие сообщения"
      subtitle="Новые сообщения удалятся у всех через выбранное время"
      actions={TIMER_CHOICES.map((seconds) => ({
        icon: seconds ? "timer" : "close",
        label: seconds ? timerLabel(seconds) : "Выключить",
        selected: (chat.timer ?? 0) === seconds,
        onPress: () => {
          onClose();
          void messenger.setTimer(chat.id, seconds).catch(() => undefined);
        },
      }))}
    />
  );
}
