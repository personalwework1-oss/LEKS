import { Alert } from "react-native";
import type { Messenger } from "@/messaging/messenger";
import { type Conversation, TIMER_CHOICES, timerLabel } from "@/messaging/types";

/** Lets the person pick how long new messages in the chat live. */
export function chooseTimer(messenger: Messenger, chat: Conversation): void {
  Alert.alert(
    "Исчезающие сообщения",
    "Новые сообщения в этом чате будут удаляться у всех через выбранное время. Уже отправленные останутся.",
    [
      ...TIMER_CHOICES.map((seconds) => ({
        text: `${timerLabel(seconds)}${(chat.timer ?? 0) === seconds ? " ✓" : ""}`,
        onPress: () => void messenger.setTimer(chat.id, seconds).catch(() => undefined),
      })),
      { text: "Отмена", style: "cancel" as const },
    ],
    { cancelable: true },
  );
}
