import { useEffect, useState } from "react";
import { useSession } from "../state/session";
import type { Messenger } from "./messenger";
import type { Conversation, Message } from "./types";

/** Runs `query` now and again after every change in the messenger. */
function useLive<T>(query: (m: Messenger) => Promise<T>, initial: T, key: string): { data: T; ready: boolean } {
  const { messenger } = useSession();
  const [state, setState] = useState<{ data: T; ready: boolean }>({ data: initial, ready: false });

  useEffect(() => {
    if (!messenger) return;
    let alive = true;
    const run = () =>
      void query(messenger)
        .then((data) => alive && setState({ data, ready: true }))
        .catch((error) => console.warn("query failed", error));
    run();
    const unsubscribe = messenger.subscribe(run);
    return () => {
      alive = false;
      unsubscribe();
    };
    // `query` is recreated every render; `key` identifies what it reads.
  }, [messenger, key]);

  return state;
}

export function useConversations() {
  return useLive<Conversation[]>((m) => m.conversations(), [], "conversations");
}

export function useConversation(id: string) {
  return useLive<Conversation | null>((m) => m.conversation(id), null, `conversation:${id}`);
}

export function useMessages(conversationId: string) {
  return useLive<Message[]>((m) => m.messages(conversationId), [], `messages:${conversationId}`);
}

/** True while the other person is typing in this chat. */
export function useTyping(conversationId: string) {
  return useLive<boolean>(async (m) => m.isTyping(conversationId), false, `typing:${conversationId}`).data;
}
