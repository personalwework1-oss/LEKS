import type { DeliveredMessage, PublicUser } from "@leks/protocol";
import type { Realtime } from "../api/realtime";
import { type Engine, utf8Decode, utf8Encode } from "../crypto/engine";
import type { Conversation, Message, MessageStore, OutboxItem, Payload } from "./types";

/** The part of the server connection the messenger uses (the Realtime client in the app). */
export type Transport = Pick<Realtime, "connectionState" | "request" | "sendMessage" | "ack">;

export interface Me {
  accountId: string;
  deviceId: string;
  displayName: string;
  username: string;
}

export class MessengerError extends Error {
  constructor(readonly code: "no_devices" | "unknown_chat" | "not_ready") {
    super(code);
  }
}

/** Key packages kept on the server so others can start chats while this phone is offline. */
const KEY_PACKAGE_TARGET = 50;
const KEY_PACKAGE_LOW = 20;

export const identityOf = (me: { accountId: string; deviceId: string }) => `${me.accountId}:${me.deviceId}`;

export function parseIdentity(identity: string): { accountId: string; deviceId: string } | null {
  const [accountId, deviceId, ...rest] = identity.split(":");
  return accountId && deviceId && rest.length === 0 ? { accountId, deviceId } : null;
}

function decodePayload(bytes: Uint8Array): Payload | null {
  try {
    const value = JSON.parse(utf8Decode(bytes)) as Payload;
    if (value && value.v === 1 && (value.type === "text" || value.type === "intro")) return value;
  } catch {
    // Not ours; ignore.
  }
  return null;
}

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

  async markRead(conversationId: string): Promise<void> {
    await this.store.markRead(conversationId);
    this.changed();
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
      for (const message of messages) {
        try {
          await this.receiveOne(message);
        } catch (error) {
          // A message that cannot be decrypted (for example, sent to an old
          // key) is dropped rather than retried forever.
          console.warn("message dropped", message.id, error);
        }
      }
      this.transport.ack(messages.map((m) => m.id));
      this.changed();
    });
    return this.incoming;
  }

  private async receiveOne(message: DeliveredMessage): Promise<void> {
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
      return;
    }

    const result = await this.engine.receive(message.payload);
    if (result.kind !== "message") return;
    const sender = parseIdentity(result.sender);
    const payload = decodePayload(result.plaintext);
    if (!sender || !payload) return;

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

    if (payload.type === "intro") {
      if (sender.accountId === conversation.peerAccountId && payload.accountId === sender.accountId) {
        await this.store.saveConversation({ ...conversation, title: payload.displayName, username: payload.username });
      }
      return;
    }

    const added = await this.store.addMessage({
      id: payload.id,
      conversationId: conversation.id,
      senderAccountId: sender.accountId,
      outgoing: sender.accountId === this.me.accountId,
      text: payload.text,
      sentAt: payload.sentAt,
      status: "received",
    });
    if (added) {
      await this.store.saveConversation({
        ...conversation,
        lastText: payload.text,
        lastAt: Math.max(conversation.lastAt, payload.sentAt),
        unread: conversation.unread + 1,
      });
    }
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
  async send(conversationId: string, text: string): Promise<Message> {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) throw new MessengerError("unknown_chat");

    const recipients = (await this.engine.members(conversationId))
      .filter((identity) => identity !== this.identity)
      .map((identity) => parseIdentity(identity)?.deviceId)
      .filter((id): id is string => !!id);

    const message: Message = {
      id: this.uuid(),
      conversationId,
      senderAccountId: this.me.accountId,
      outgoing: true,
      text,
      sentAt: this.now(),
      status: "sending",
    };
    const payload: Payload = { v: 1, type: "text", id: message.id, text, sentAt: message.sentAt };
    const ciphertext = await this.engine.encrypt(conversationId, utf8Encode(JSON.stringify(payload)));

    await this.store.addMessage(message);
    await this.store.saveConversation({ ...conversation, lastText: text, lastAt: message.sentAt });
    await this.queue("message", recipients, ciphertext, message.id, message.id);
    this.changed();
    void this.flush();
    return message;
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
    await this.store.clear();
    await this.engine.reset();
    this.changed();
  }
}
