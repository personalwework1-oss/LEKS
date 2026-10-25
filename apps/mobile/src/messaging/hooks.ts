import { useEffect, useState } from "react";
import { useSession } from "../state/session";
import type { Messenger } from "./messenger";
import type { Conversation, Message, Person } from "./types";

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

/** Names, photos and my own names for people, by account id. */
export function usePeople(): Map<string, Person> {
  return useLive<Map<string, Person>>(async (m) => new Map((await m.people()).map((p) => [p.accountId, p])), new Map(), "people").data;
}

/** The name to show: mine for them first, then theirs. */
export function nameOf(people: Map<string, Person>, accountId: string, fallback: string): string {
  const person = people.get(accountId);
  return person?.nickname || person?.displayName || fallback;
}

/** A chat's title and photo: for a direct chat, the person's. */
export function chatFace(people: Map<string, Person>, chat: Conversation): { title: string; photo: string | null } {
  if (chat.kind === "group") return { title: chat.title, photo: null };
  return { title: nameOf(people, chat.peerAccountId, chat.title), photo: people.get(chat.peerAccountId)?.photo ?? null };
}
