import type { DeliveredMessage, PublicUser } from "@leks/protocol";
import type { Realtime } from "../api/realtime";
import { type Engine, utf8Decode, utf8Encode } from "../crypto/engine";
import { type Conversation, type Message, type MessageStore, type OutboxItem, type Payload, REACTIONS } from "./types";

/** The part of the server connection the messenger uses (the Realtime client in the app). */
export type Transport = Pick<Realtime, "connectionState" | "request" | "sendMessage" | "ack">;

export interface Me {
  accountId: string;
  deviceId: string;
  displayName: string;
  username: string;
}

export class MessengerError extends Error {
  constructor(readonly code: "no_devices" | "unknown_chat" | "not_ready" | "not_allowed") {
    super(code);
  }
}

/** Key packages kept on the server so others can start chats while this phone is offline. */
const KEY_PACKAGE_TARGET = 50;
const KEY_PACKAGE_LOW = 20;
/** How long "typing…" stays without a new signal, and how often we send one. */
const TYPING_SHOW_MS = 6000;
const TYPING_SEND_EVERY_MS = 4000;
/** A typing signal older than this (for example, delivered after being offline) is ignored. */
const TYPING_STALE_MS = 15000;
const MAX_TEXT = 4000;

export const identityOf = (me: { accountId: string; deviceId: string }) => `${me.accountId}:${me.deviceId}`;

export function parseIdentity(identity: string): { accountId: string; deviceId: string } | null {
  const [accountId, deviceId, ...rest] = identity.split(":");
  return accountId && deviceId && rest.length === 0 ? { accountId, deviceId } : null;
}

const isString = (v: unknown): v is string => typeof v === "string";

/** Checks what arrived; anything malformed is ignored rather than trusted. */
export function decodePayload(bytes: Uint8Array): Payload | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(utf8Decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || value.v !== 1) return null;
  switch (value.type) {
    case "intro":
      return isString(value.accountId) && isString(value.displayName) && isString(value.username) ? (value as Payload) : null;
    case "text":
      return isString(value.id) && isString(value.text) && typeof value.sentAt === "number" && (value.replyTo === undefined || isString(value.replyTo))
        ? (value as Payload)
        : null;
    case "receipt":
      return (value.state === "delivered" || value.state === "read") && Array.isArray(value.ids) && value.ids.every(isString)
        ? (value as Payload)
        : null;
    case "edit":
      return isString(value.id) && isString(value.text) && typeof value.editedAt === "number" ? (value as Payload) : null;
    case "delete":
      return isString(value.id) ? (value as Payload) : null;
    case "reaction":
      return isString(value.id) && isString(value.emoji) && (value.emoji === "" || (REACTIONS as readonly string[]).includes(value.emoji))
        ? (value as Payload)
        : null;
    case "typing":
      return value as Payload;
    default:
      return null;
  }
}

/** What the chat list shows for a message. */
export const previewOf = (m: Message | null): string | null => (m ? (m.deleted ? "Сообщение удалено" : m.text) : null);

/**
 * Chats on this phone: starting them, sending and receiving encrypted
 * messages, and the outbox that keeps unsent messages until the server
 * has stored them (so nothing is lost when the network drops).
 */
export class Messenger {
  private readonly listeners = new Set<() => void>();
  private incoming: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  /** conversation id → when "typing…" stops showing. */
  private readonly typingUntil = new Map<string, number>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly typingSentAt = new Map<string, number>();
  private lastQueued = 0;

  constructor(
    private readonly engine: Engine,
    private readonly transport: Transport,
    private readonly store: MessageStore,
    private readonly me: Me,
    private readonly uuid: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  get identity(): string {
    return identityOf(this.me);
  }

  /** Re-renders screens after any change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  conversations(): Promise<Conversation[]> {
    return this.store.conversations();
  }

  conversation(id: string): Promise<Conversation | null> {
    return this.store.conversation(id);
  }

  messages(conversationId: string): Promise<Message[]> {
    return this.store.messages(conversationId);
  }

  /** Marks the chat read here and tells the other side which messages were read. */
  async markRead(conversationId: string): Promise<void> {
    const unread = await this.store.unreadIncoming(conversationId);
    await this.store.markRead(conversationId);
    for (const message of unread) await this.store.setStatus(message.id, "read");
    if (unread.length > 0) {
      await this.sendPayload(conversationId, { v: 1, type: "receipt", state: "read", ids: unread.map((m) => m.id) }, null);
    }
    this.changed();
  }

  /** True while the other person is typing in this chat. */
  isTyping(conversationId: string): boolean {
    return (this.typingUntil.get(conversationId) ?? 0) > this.now();
  }

  /** Called after each sign-in to the server. */
  async onAuthenticated(keyPackagesAvailable: number): Promise<void> {
    if (keyPackagesAvailable < KEY_PACKAGE_LOW) {
      const keyPackages = await this.engine.keyPackages(KEY_PACKAGE_TARGET - keyPackagesAvailable);
      await this.transport.request({ type: "publish_key_packages", keyPackages }, "key_packages_published");
    }
    await this.flush();
  }

  /** Messages from the server, processed strictly in order, then confirmed. */
  onMessages(messages: DeliveredMessage[]): Promise<void> {
    this.incoming = this.incoming.then(async () => {
      const delivered = new Map<string, string[]>();
      for (const message of messages) {
        try {
          const text = await this.receiveOne(message);
          if (text) delivered.set(text.conversationId, [...(delivered.get(text.conversationId) ?? []), text.id]);
        } catch (error) {
          // A message that cannot be decrypted (for example, sent to an old
          // key) is dropped rather than retried forever.
          console.warn("message dropped", message.id, error);
        }
      }
      // Receipts are queued before the ack, so a crash in between at worst sends one twice.
      for (const [conversationId, ids] of delivered) {
        await this.sendPayload(conversationId, { v: 1, type: "receipt", state: "delivered", ids }, null).catch((error) =>
          console.warn("receipt not queued", error),
        );
      }
      this.transport.ack(messages.map((m) => m.id));
      this.changed();
    });
    return this.incoming;
  }

  /** Returns the new text message, if this was one (for the delivered receipt). */
  private async receiveOne(message: DeliveredMessage): Promise<{ conversationId: string; id: string } | null> {
    if (message.kind === "welcome") {
      const groupId = await this.engine.join(message.payload);
      if (!(await this.store.conversation(groupId))) {
        await this.store.saveConversation({
          id: groupId,
          peerAccountId: message.from.accountId,
          title: "Новый чат",
          username: null,
          lastText: null,
          lastAt: message.sentAt,
          unread: 0,
        });
      }
      return null;
    }

    const result = await this.engine.receive(message.payload);
    if (result.kind !== "message") return null;
    const sender = parseIdentity(result.sender);
    const payload = decodePayload(result.plaintext);
    if (!sender || !payload) return null;
    // Only the person this chat is with (or my own other devices) can write in it.

    const conversation =
      (await this.store.conversation(result.groupId)) ??
      ({
        id: result.groupId,
        peerAccountId: sender.accountId,
        title: "Новый чат",
        username: null,
        lastText: null,
        lastAt: message.sentAt,
        unread: 0,
      } satisfies Conversation);

    if (sender.accountId !== conversation.peerAccountId && sender.accountId !== this.me.accountId) return null;
    const fromPeer = sender.accountId === conversation.peerAccountId;

    switch (payload.type) {
      case "intro":
        if (fromPeer && payload.accountId === sender.accountId) {
          await this.store.saveConversation({ ...conversation, title: payload.displayName, username: payload.username });
        }
        return null;

      case "text": {
        const added = await this.store.addMessage({
          id: payload.id,
          conversationId: conversation.id,
          senderAccountId: sender.accountId,
          outgoing: sender.accountId === this.me.accountId,
          text: payload.text.slice(0, MAX_TEXT),
          sentAt: payload.sentAt,
          status: sender.accountId === this.me.accountId ? "sent" : "received",
          replyTo: payload.replyTo ?? null,
          editedAt: null,
          deleted: false,
          reactions: {},
        });
        if (!added) return null;
        // A message I sent from another of my phones is not unread and needs no receipt.
        const mine = sender.accountId === this.me.accountId;
        if (!mine) this.stopTyping(conversation.id);
        await this.store.saveConversation({
          ...conversation,
          lastText: payload.text,
          lastAt: Math.max(conversation.lastAt, payload.sentAt),
          unread: conversation.unread + (mine ? 0 : 1),
        });
        return mine ? null : { conversationId: conversation.id, id: payload.id };
      }

      case "receipt":
        // Receipts are about my messages, sent by the other side.
        if (!fromPeer) return null;
        for (const id of payload.ids) {
          const target = await this.store.message(id);
          if (target?.outgoing && target.conversationId === conversation.id) await this.store.setStatus(id, payload.state);
        }
        return null;

      case "edit": {
        const target = await this.store.message(payload.id);
        if (!target || target.deleted || target.conversationId !== conversation.id || target.senderAccountId !== sender.accountId) return null;
        await this.store.updateMessage({ ...target, text: payload.text.slice(0, MAX_TEXT), editedAt: payload.editedAt });
        await this.refreshPreview(conversation.id);
        return null;
      }

      case "delete": {
        const target = await this.store.message(payload.id);
        if (!target || target.conversationId !== conversation.id || target.senderAccountId !== sender.accountId) return null;
        await this.store.updateMessage({ ...target, text: "", deleted: true, reactions: {}, status: target.status === "received" ? "read" : target.status });
        await this.refreshPreview(conversation.id, target.status === "received" ? 1 : 0);
        return null;
      }

      case "reaction": {
        const target = await this.store.message(payload.id);
        if (!target || target.deleted || target.conversationId !== conversation.id) return null;
        const reactions = { ...target.reactions };
        if (payload.emoji) reactions[sender.accountId] = payload.emoji;
        else delete reactions[sender.accountId];
        await this.store.updateMessage({ ...target, reactions });
        return null;
      }

      case "typing":
        if (fromPeer && Math.abs(this.now() - message.sentAt) < TYPING_STALE_MS) this.showTyping(conversation.id);
        return null;
    }
  }

  private showTyping(conversationId: string) {
    this.typingUntil.set(conversationId, this.now() + TYPING_SHOW_MS);
    clearTimeout(this.typingTimers.get(conversationId));
    this.typingTimers.set(
      conversationId,
      setTimeout(() => {
        this.typingTimers.delete(conversationId);
        this.typingUntil.delete(conversationId);
        this.changed();
      }, TYPING_SHOW_MS),
    );
  }

  private stopTyping(conversationId: string) {
    clearTimeout(this.typingTimers.get(conversationId));
    this.typingTimers.delete(conversationId);
    this.typingUntil.delete(conversationId);
  }

  /** Keeps the chat list preview in line with the newest message after an edit or delete. */
  private async refreshPreview(conversationId: string, readOne = 0) {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) return;
    const [latest] = (await this.store.messages(conversationId, 1)).slice(-1);
    await this.store.saveConversation({
      ...conversation,
      lastText: previewOf(latest ?? null),
      unread: Math.max(0, conversation.unread - readOne),
    });
  }

  /** Opens the chat with this person, creating it (and inviting all their devices) if needed. */
  async startChat(peer: PublicUser): Promise<string> {
    const existing = await this.store.conversationWith(peer.accountId);
    if (existing) return existing.id;

    const claimed = await this.transport.request({ type: "claim_key_packages", accountId: peer.accountId }, "key_packages");
    if (claimed.items.length === 0) throw new MessengerError("no_devices");

    const groupId = await this.engine.createGroup();
    const invited: string[] = [];
    for (const item of claimed.items) {
      const invitation = await this.engine.addMember(groupId, item.keyPackage);
      // Devices invited earlier must apply the change too.
      if (invited.length > 0) await this.queue("commit", invited, invitation.commit, null);
      await this.queue("welcome", [item.deviceId], invitation.welcome, null);
      invited.push(item.deviceId);
    }

    const intro: Payload = { v: 1, type: "intro", accountId: this.me.accountId, displayName: this.me.displayName, username: this.me.username };
    await this.queue("message", invited, await this.engine.encrypt(groupId, utf8Encode(JSON.stringify(intro))), null);

    await this.store.saveConversation({
      id: groupId,
      peerAccountId: peer.accountId,
      title: peer.displayName,
      username: peer.username,
      lastText: null,
      lastAt: this.now(),
      unread: 0,
    });
    this.changed();
    void this.flush();
    return groupId;
  }

  /** Encrypts and queues a text message; it is shown right away as "sending". */
  async send(conversationId: string, text: string, replyTo: string | null = null): Promise<Message> {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) throw new MessengerError("unknown_chat");
    const body = text.slice(0, MAX_TEXT);

    const message: Message = {
      id: this.uuid(),
      conversationId,
      senderAccountId: this.me.accountId,
      outgoing: true,
      text: body,
      sentAt: this.now(),
      status: "sending",
      replyTo,
      editedAt: null,
      deleted: false,
      reactions: {},
    };
    const payload: Payload = { v: 1, type: "text", id: message.id, text: body, sentAt: message.sentAt, ...(replyTo ? { replyTo } : {}) };

    await this.store.addMessage(message);
    await this.store.saveConversation({ ...conversation, lastText: body, lastAt: message.sentAt });
    this.typingSentAt.delete(conversationId);
    await this.sendPayload(conversationId, payload, message.id, message.id);
    return message;
  }

  /** Changes the text of my own message, here and on the other side. */
  async edit(messageId: string, text: string): Promise<void> {
    const message = await this.ownMessage(messageId);
    const body = text.slice(0, MAX_TEXT);
    if (body === message.text) return;
    const editedAt = this.now();
    await this.store.updateMessage({ ...message, text: body, editedAt });
    await this.refreshPreview(message.conversationId);
    await this.sendPayload(message.conversationId, { v: 1, type: "edit", id: messageId, text: body, editedAt }, null);
  }

  /** Deletes my own message for both sides. */
  async deleteForEveryone(messageId: string): Promise<void> {
    const message = await this.ownMessage(messageId);
    await this.store.updateMessage({ ...message, text: "", deleted: true, reactions: {} });
    await this.refreshPreview(message.conversationId);
    await this.sendPayload(message.conversationId, { v: 1, type: "delete", id: messageId }, null);
  }

  /** Removes a message from this phone only. */
  async deleteForMe(messageId: string): Promise<void> {
    const message = await this.store.message(messageId);
    if (!message) return;
    await this.store.removeMessage(messageId);
    await this.refreshPreview(message.conversationId, !message.outgoing && message.status === "received" ? 1 : 0);
    this.changed();
  }

  /** Sets my reaction to a message; the same emoji again (or null) removes it. */
  async react(messageId: string, emoji: string | null): Promise<void> {
    const message = await this.store.message(messageId);
    if (!message || message.deleted) throw new MessengerError("not_allowed");
    if (emoji !== null && !(REACTIONS as readonly string[]).includes(emoji)) throw new MessengerError("not_allowed");
    const current = message.reactions[this.me.accountId];
    const next = emoji === null || emoji === current ? "" : emoji;
    const reactions = { ...message.reactions };
    if (next) reactions[this.me.accountId] = next;
    else delete reactions[this.me.accountId];
    await this.store.updateMessage({ ...message, reactions });
    await this.sendPayload(message.conversationId, { v: 1, type: "reaction", id: messageId, emoji: next }, null);
  }

  /**
   * Called as the user types. Sends a short-lived signal at most every few
   * seconds, and only when nothing is waiting in the outbox (so it never
   * jumps ahead of real messages).
   */
  async typing(conversationId: string): Promise<void> {
    const last = this.typingSentAt.get(conversationId) ?? 0;
    if (this.now() - last < TYPING_SEND_EVERY_MS) return;
    if (this.transport.connectionState !== "online" || this.flushing) return;
    if ((await this.store.outbox()).length > 0) return;
    this.typingSentAt.set(conversationId, this.now());
    try {
      const recipients = await this.recipients(conversationId);
      if (recipients.length === 0) return;
      const ciphertext = await this.engine.encrypt(conversationId, utf8Encode(JSON.stringify({ v: 1, type: "typing" } satisfies Payload)));
      await this.transport.sendMessage({ type: "send", id: this.uuid(), recipients, kind: "message", payload: ciphertext });
    } catch {
      // Best effort only.
    }
  }

  private async ownMessage(messageId: string): Promise<Message> {
    const message = await this.store.message(messageId);
    if (!message || !message.outgoing || message.deleted) throw new MessengerError("not_allowed");
    return message;
  }

  /** The other devices in the chat (the other person's, and my own other phones). */
  private async recipients(conversationId: string): Promise<string[]> {
    return (await this.engine.members(conversationId))
      .filter((identity) => identity !== this.identity)
      .map((identity) => parseIdentity(identity)?.deviceId)
      .filter((id): id is string => !!id);
  }

  /** Encrypts something for the chat and puts it in the outbox, then starts sending. */
  private async sendPayload(conversationId: string, payload: Payload, messageId: string | null, id?: string): Promise<void> {
    const recipients = await this.recipients(conversationId);
    const ciphertext = await this.engine.encrypt(conversationId, utf8Encode(JSON.stringify(payload)));
    await this.queue("message", recipients, ciphertext, messageId, id);
    this.changed();
    void this.flush();
  }

  private async queue(
    kind: OutboxItem["kind"],
    recipients: string[],
    payload: string,
    messageId: string | null,
    id: string = this.uuid(),
  ): Promise<void> {
    // Strictly increasing, so the outbox keeps the order things were created in.
    this.lastQueued = Math.max(this.now(), this.lastQueued + 1);
    await this.store.enqueue({ id, createdAt: this.lastQueued, kind, recipients, payload, messageId });
  }

  /** Sends whatever is waiting in the outbox, in order; stops at the first failure and resumes later. */
  flush(): Promise<void> {
    // Something queued while a flush is running is picked up by another pass.
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          if (!(await this.flushOnce())) break;
        } while (this.flushAgain);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** One pass over the outbox; false if it stopped early (offline or a send failed). */
  private async flushOnce(): Promise<boolean> {
    for (const item of await this.store.outbox()) {
      if (this.transport.connectionState !== "online") return false;
      try {
        await this.transport.sendMessage({ type: "send", id: item.id, recipients: item.recipients, kind: item.kind, payload: item.payload });
      } catch {
        return false;
      }
      await this.store.dequeue(item.id);
      if (item.messageId) {
        await this.store.setStatus(item.messageId, "sent");
        this.changed();
      }
    }
    return true;
  }

  /** Sign-out: forget chats and keys on this phone. */
  async wipe(): Promise<void> {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    this.typingUntil.clear();
    await this.store.clear();
    await this.engine.reset();
    this.changed();
  }
}
