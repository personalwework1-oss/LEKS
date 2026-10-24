import { type DeliveredMessage, MAX_BLOB_BYTES, type PublicUser } from "@leks/protocol";
import type { Realtime } from "../api/realtime";
import { type Engine, utf8Decode, utf8Encode } from "../crypto/engine";
import type { FileIO } from "./files";
import {
  type Attachment,
  type AttachmentKind,
  type Conversation,
  type GroupMember,
  type Message,
  MAX_GROUP_MEMBERS,
  type MessageStore,
  type OutboxItem,
  type Payload,
  REACTIONS,
} from "./types";

/** The part of the server connection the messenger uses (the Realtime client in the app). */
export type Transport = Pick<Realtime, "connectionState" | "request" | "sendMessage" | "ack">;

export interface Me {
  accountId: string;
  deviceId: string;
  displayName: string;
  username: string;
}

export class MessengerError extends Error {
  constructor(readonly code: "no_devices" | "unknown_chat" | "not_ready" | "not_allowed" | "too_large" | "too_many") {
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
/** Photos up to this size download by themselves; bigger ones and other files on a tap. */
const AUTO_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_THUMB = 12_000;
const KINDS: AttachmentKind[] = ["image", "video", "file", "voice"];
const MAX_WAVEFORM = 64;

/** A call signal from someone in a chat, handed to the call screen. */
export type CallSignal =
  | { type: "invite"; conversationId: string; from: string; callId: string; video: boolean; key: string; sentAt: number }
  | { type: "accept" | "decline" | "end"; conversationId: string; from: string; callId: string };

/** A file picked to send (already resized if it is a photo). */
export interface OutgoingFile {
  uri: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  width: number | null;
  height: number | null;
  thumb: string | null;
  duration?: number | null;
  waveform?: number[] | null;
}

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
    case "file":
      return isString(value.id) &&
        typeof value.sentAt === "number" &&
        isString(value.caption) &&
        isString(value.blobId) &&
        isString(value.key) &&
        KINDS.includes(value.kind as AttachmentKind) &&
        isString(value.name) &&
        isString(value.mime) &&
        typeof value.size === "number" &&
        (value.replyTo === undefined || isString(value.replyTo)) &&
        (value.width === undefined || typeof value.width === "number") &&
        (value.height === undefined || typeof value.height === "number") &&
        (value.thumb === undefined || (isString(value.thumb) && value.thumb.length <= MAX_THUMB)) &&
        (value.duration === undefined || typeof value.duration === "number") &&
        (value.waveform === undefined ||
          (Array.isArray(value.waveform) && value.waveform.length <= MAX_WAVEFORM && value.waveform.every((n: unknown) => typeof n === "number")))
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
    case "group_info":
      return isString(value.title) &&
        typeof value.version === "number" &&
        Array.isArray(value.members) &&
        value.members.length <= MAX_GROUP_MEMBERS &&
        value.members.every(
          (m: Record<string, unknown>) =>
            m && isString(m.accountId) && isString(m.displayName) && isString(m.username) && (m.role === "admin" || m.role === "member"),
        )
        ? (value as Payload)
        : null;
    case "call_invite":
      return isString(value.callId) && typeof value.video === "boolean" && isString(value.key) && typeof value.sentAt === "number" ? (value as Payload) : null;
    case "call_accept":
    case "call_decline":
    case "call_end":
      return isString(value.callId) ? (value as Payload) : null;
    case "leave":
    case "typing":
      return value as Payload;
    default:
      return null;
  }
}

/** A chat that is not (yet) known to be a group. */
function directChat(id: string, peerAccountId: string, at: number): Conversation {
  return {
    id,
    kind: "direct",
    peerAccountId,
    title: "Новый чат",
    username: null,
    lastText: null,
    lastAt: at,
    unread: 0,
    members: [],
    version: 0,
    left: false,
  };
}

/** Admins first, then by name, so everyone sees the same order. */
const sortMembers = (members: GroupMember[]) =>
  [...members].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, "ru") : a.role === "admin" ? -1 : 1));

/** What the chat list shows for a message. */
export function previewOf(m: Message | null): string | null {
  if (!m) return null;
  if (m.deleted) return "Сообщение удалено";
  if (m.attachment && !m.text) {
    const kind = m.attachment.kind;
    return kind === "image" ? "📷 Фото" : kind === "video" ? "🎬 Видео" : kind === "voice" ? "🎤 Голосовое сообщение" : `📎 ${m.attachment.name}`;
  }
  return m.text;
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
    private readonly files: FileIO | null = null,
  ) {}

  /** Attachments being uploaded or downloaded right now (message ids). */
  private readonly transfers = new Set<string>();
  private callListener: ((signal: CallSignal) => void) | null = null;

  /** The call screen listens here for invites, answers and hang-ups. */
  onCall(listener: ((signal: CallSignal) => void) | null): void {
    this.callListener = listener;
  }

  /** Sends a call signal into the chat (through the outbox, so it keeps its place in line). */
  async sendCallSignal(conversationId: string, payload: Extract<Payload, { type: `call_${string}` }>): Promise<void> {
    const chat = await this.store.conversation(conversationId);
    if (!chat || chat.left) throw new MessengerError("not_allowed");
    await this.sendPayload(conversationId, payload, null);
  }

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

  message(id: string): Promise<Message | null> {
    return this.store.message(id);
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
    // Uploads cut off by a lost connection or a closed app continue now.
    for (const message of await this.store.pendingUploads()) void this.upload(message.id);
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
        await this.store.saveConversation(directChat(groupId, message.from.accountId, message.sentAt));
      }
      return null;
    }

    const result = await this.engine.receive(message.payload);
    if (result.kind === "group_updated") {
      // A commit may have removed me from a group.
      const state = await this.engine.groupState(result.groupId).catch(() => null);
      const chat = await this.store.conversation(result.groupId);
      if (state && !state.active && chat && !chat.left) await this.store.saveConversation({ ...chat, left: true });
      return null;
    }
    if (result.kind !== "message") return null;
    const sender = parseIdentity(result.sender);
    const payload = decodePayload(result.plaintext);
    if (!sender || !payload) return null;
    // Only the person this chat is with (or my own other devices) can write in it.

    const conversation = (await this.store.conversation(result.groupId)) ?? directChat(result.groupId, sender.accountId, message.sentAt);
    const mine = sender.accountId === this.me.accountId;
    const isGroup = conversation.kind === "group";
    // Direct chats: only the other person (or my own other phones). Groups: only current members.
    const allowed = mine || (isGroup ? conversation.members.some((m) => m.accountId === sender.accountId) : sender.accountId === conversation.peerAccountId);
    if (!allowed) return null;
    // "Peer" here means anyone else in the chat.
    const fromPeer = !mine;
    // After leaving, only news about the group itself still counts.
    if (conversation.left && payload.type !== "group_info") return null;

    switch (payload.type) {
      case "intro":
        if (!isGroup && fromPeer && payload.accountId === sender.accountId) {
          await this.store.saveConversation({ ...conversation, title: payload.displayName, username: payload.username });
        }
        return null;

      case "group_info": {
        // The inviter turns a fresh chat into a group; after that only admins can change it.
        const fresh = !isGroup && conversation.lastText === null && sender.accountId === conversation.peerAccountId;
        const byAdmin = isGroup && conversation.members.some((m) => m.accountId === sender.accountId && m.role === "admin");
        if (!(fresh || byAdmin || mine) || payload.version <= conversation.version) return null;
        const members = sortMembers(payload.members);
        const stillIn = members.some((m) => m.accountId === this.me.accountId);
        await this.store.saveConversation({
          ...conversation,
          kind: "group",
          title: payload.title.slice(0, 100) || "Группа",
          username: null,
          members,
          version: payload.version,
          left: conversation.left || !stillIn,
        });
        return null;
      }

      case "leave": {
        if (!isGroup || mine) return null;
        const members = conversation.members.filter((m) => m.accountId !== sender.accountId);
        await this.store.saveConversation({ ...conversation, members });
        // One admin (the first in the list) removes the leaver's devices and tells everyone.
        const firstAdmin = members.find((m) => m.role === "admin");
        if (firstAdmin?.accountId === this.me.accountId && !conversation.left) {
          await this.removeDevices(conversation.id, sender.accountId);
          await this.publishGroupInfo({ ...conversation, members });
        }
        return null;
      }

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
          attachment: null,
        });
        if (!added) return null;
        // A message I sent from another of my phones is not unread and needs no receipt.
        if (!mine) this.stopTyping(conversation.id);
        await this.store.saveConversation({
          ...conversation,
          lastText: payload.text,
          lastAt: Math.max(conversation.lastAt, payload.sentAt),
          unread: conversation.unread + (mine ? 0 : 1),
        });
        return mine ? null : { conversationId: conversation.id, id: payload.id };
      }

      case "file": {
        const message: Message = {
          id: payload.id,
          conversationId: conversation.id,
          senderAccountId: sender.accountId,
          outgoing: mine,
          text: payload.caption.slice(0, MAX_TEXT),
          sentAt: payload.sentAt,
          status: mine ? "sent" : "received",
          replyTo: payload.replyTo ?? null,
          editedAt: null,
          deleted: false,
          reactions: {},
          attachment: {
            kind: payload.kind,
            name: payload.name.slice(0, 200),
            mime: payload.mime.slice(0, 100),
            size: payload.size,
            width: payload.width ?? null,
            height: payload.height ?? null,
            thumb: payload.thumb ?? null,
            duration: payload.duration ?? null,
            waveform: payload.waveform?.map((n) => Math.min(1, Math.max(0, n))) ?? null,
            blobId: payload.blobId,
            key: payload.key,
            localUri: null,
            state: "remote",
          },
        };
        if (!(await this.store.addMessage(message))) return null;
        if (!mine) this.stopTyping(conversation.id);
        await this.store.saveConversation({
          ...conversation,
          lastText: previewOf(message),
          lastAt: Math.max(conversation.lastAt, payload.sentAt),
          unread: conversation.unread + (mine ? 0 : 1),
        });
        if ((payload.kind === "image" || payload.kind === "voice") && payload.size <= AUTO_DOWNLOAD_BYTES) void this.download(message.id);
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
        if (target.attachment?.localUri) await this.files?.remove(target.attachment.localUri).catch(() => undefined);
        await this.store.updateMessage({
          ...target,
          text: "",
          deleted: true,
          reactions: {},
          attachment: null,
          status: target.status === "received" ? "read" : target.status,
        });
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

      case "call_invite":
        if (fromPeer) {
          this.callListener?.({
            type: "invite",
            conversationId: conversation.id,
            from: sender.accountId,
            callId: payload.callId,
            video: payload.video,
            key: payload.key,
            // The server's time, so a phone with a wrong clock still rings only for fresh calls.
            sentAt: message.sentAt,
          });
        }
        return null;

      case "call_accept":
      case "call_decline":
      case "call_end":
        // My own other phones answering also counts: they stop ringing here.
        this.callListener?.({ type: payload.type.slice(5) as "accept" | "decline" | "end", conversationId: conversation.id, from: sender.accountId, callId: payload.callId });
        return null;

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
      ...directChat(groupId, peer.accountId, this.now()),
      title: peer.displayName,
      username: peer.username,
    });
    this.changed();
    void this.flush();
    return groupId;
  }

  /** Encrypts and queues a text message; it is shown right away as "sending". */
  async send(conversationId: string, text: string, replyTo: string | null = null): Promise<Message> {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) throw new MessengerError("unknown_chat");
    if (conversation.left) throw new MessengerError("not_allowed");
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
      attachment: null,
    };
    const payload: Payload = { v: 1, type: "text", id: message.id, text: body, sentAt: message.sentAt, ...(replyTo ? { replyTo } : {}) };

    await this.store.addMessage(message);
    await this.store.saveConversation({ ...conversation, lastText: body, lastAt: message.sentAt });
    this.typingSentAt.delete(conversationId);
    await this.sendPayload(conversationId, payload, message.id, message.id);
    return message;
  }

  /**
   * Sends a photo or file: it shows up right away while it is encrypted and
   * uploaded; the message with its key goes out once the upload is done.
   */
  async sendFile(conversationId: string, file: OutgoingFile, caption = "", replyTo: string | null = null): Promise<Message> {
    if (!this.files) throw new MessengerError("not_ready");
    if (file.size > MAX_BLOB_BYTES - 1024 * 1024) throw new MessengerError("too_large");
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) throw new MessengerError("unknown_chat");
    if (conversation.left) throw new MessengerError("not_allowed");

    const id = this.uuid();
    const localUri = this.files.mediaUri(id, file.name);
    await this.files.copy(file.uri, localUri);
    const message: Message = {
      id,
      conversationId,
      senderAccountId: this.me.accountId,
      outgoing: true,
      text: caption.slice(0, MAX_TEXT),
      sentAt: this.now(),
      status: "sending",
      replyTo,
      editedAt: null,
      deleted: false,
      reactions: {},
      attachment: {
        kind: file.kind,
        name: file.name,
        mime: file.mime,
        size: file.size,
        width: file.width,
        height: file.height,
        thumb: file.thumb && file.thumb.length <= MAX_THUMB ? file.thumb : null,
        duration: file.duration ?? null,
        waveform: file.waveform?.slice(0, MAX_WAVEFORM) ?? null,
        blobId: null,
        key: null,
        localUri,
        state: "uploading",
      },
    };
    await this.store.addMessage(message);
    await this.store.saveConversation({ ...conversation, lastText: previewOf(message), lastAt: message.sentAt });
    this.changed();
    void this.upload(id);
    return message;
  }

  /** Tries a failed upload again. */
  async retryUpload(messageId: string): Promise<void> {
    const message = await this.store.message(messageId);
    if (!message?.outgoing || !message.attachment || message.attachment.state !== "failed") return;
    await this.store.updateMessage({ ...message, status: "sending", attachment: { ...message.attachment, state: "uploading" } });
    this.changed();
    await this.upload(messageId);
  }

  /** Encrypts, uploads, then sends the key. Stays "uploading" if the network drops, to be resumed. */
  private async upload(messageId: string): Promise<void> {
    if (!this.files || this.transfers.has(messageId)) return;
    this.transfers.add(messageId);
    const files = this.files;
    const encrypted = files.tempUri();
    try {
      const message = await this.store.message(messageId);
      const attachment = message?.attachment;
      if (!message || !attachment?.localUri || attachment.state !== "uploading" || message.deleted) return;
      if (this.transport.connectionState !== "online") return;

      const { key, size } = await this.engine.encryptFile(attachment.localUri, encrypted);
      let ticket;
      try {
        ticket = await this.transport.request({ type: "request_upload", size }, "upload_ready");
      } catch (error) {
        if ((error as { code?: string }).code === "upload_quota_exceeded" || (error as { code?: string }).code === "bad_frame") {
          await this.failUpload(messageId);
        }
        return;
      }
      await files.upload(ticket.blobId, ticket.token, encrypted);

      const latest = await this.store.message(messageId);
      if (!latest?.attachment || latest.deleted) return;
      const sent: Attachment = { ...latest.attachment, blobId: ticket.blobId, key, state: "sent" };
      await this.store.updateMessage({ ...latest, attachment: sent });
      const payload: Payload = {
        v: 1,
        type: "file",
        id: latest.id,
        sentAt: latest.sentAt,
        ...(latest.replyTo ? { replyTo: latest.replyTo } : {}),
        caption: latest.text,
        blobId: ticket.blobId,
        key,
        kind: sent.kind,
        name: sent.name,
        mime: sent.mime,
        size: sent.size,
        ...(sent.width ? { width: sent.width } : {}),
        ...(sent.height ? { height: sent.height } : {}),
        ...(sent.thumb ? { thumb: sent.thumb } : {}),
        ...(sent.duration ? { duration: sent.duration } : {}),
        ...(sent.waveform ? { waveform: sent.waveform.map((n) => Math.round(n * 100) / 100) } : {}),
      };
      await this.sendPayload(latest.conversationId, payload, latest.id);
    } catch (error) {
      // Network trouble leaves it "uploading" for the next connection; anything else is a failure.
      if (this.transport.connectionState === "online") {
        console.warn("upload failed", error);
        await this.failUpload(messageId);
      }
    } finally {
      this.transfers.delete(messageId);
      await files.remove(encrypted).catch(() => undefined);
      this.changed();
    }
  }

  private async failUpload(messageId: string) {
    const message = await this.store.message(messageId);
    if (!message?.attachment) return;
    await this.store.updateMessage({ ...message, status: "failed", attachment: { ...message.attachment, state: "failed" } });
  }

  /** Fetches and decrypts a received photo or file. */
  async download(messageId: string): Promise<void> {
    if (!this.files || this.transfers.has(messageId)) return;
    const message = await this.store.message(messageId);
    const attachment = message?.attachment;
    if (!message || !attachment?.blobId || !attachment.key || attachment.state === "ready" || message.deleted) return;
    this.transfers.add(messageId);
    const files = this.files;
    const encrypted = files.tempUri();
    await this.store.updateMessage({ ...message, attachment: { ...attachment, state: "downloading" } });
    this.changed();
    try {
      await files.download(attachment.blobId, encrypted);
      const localUri = files.mediaUri(message.id, attachment.name);
      await this.engine.decryptFile(encrypted, localUri, attachment.key);
      const latest = await this.store.message(messageId);
      if (!latest?.attachment || latest.deleted) {
        await files.remove(localUri);
        return;
      }
      await this.store.updateMessage({ ...latest, attachment: { ...latest.attachment, localUri, state: "ready" } });
    } catch (error) {
      console.warn("download failed", error);
      const latest = await this.store.message(messageId);
      if (latest?.attachment) await this.store.updateMessage({ ...latest, attachment: { ...latest.attachment, state: "failed" } });
    } finally {
      this.transfers.delete(messageId);
      await files.remove(encrypted).catch(() => undefined);
      this.changed();
    }
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
    if (message.attachment?.localUri) await this.files?.remove(message.attachment.localUri).catch(() => undefined);
    await this.store.updateMessage({ ...message, text: "", deleted: true, reactions: {}, attachment: null });
    await this.refreshPreview(message.conversationId);
    await this.sendPayload(message.conversationId, { v: 1, type: "delete", id: messageId }, null);
  }

  /** Removes a message from this phone only. */
  async deleteForMe(messageId: string): Promise<void> {
    const message = await this.store.message(messageId);
    if (!message) return;
    if (message.attachment?.localUri) await this.files?.remove(message.attachment.localUri).catch(() => undefined);
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
    if (recipients.length === 0) {
      // Nobody else is in the chat (a group of one): nothing to send, but my message counts as sent.
      if (messageId) await this.store.setStatus(messageId, "sent");
      this.changed();
      return;
    }
    // Only things a person should see wake their phone; receipts, reactions and edits wait.
    const wake = payload.type === "text" || payload.type === "file" ? "message" : payload.type === "call_invite" ? "call" : null;
    await this.queue("message", recipients, ciphertext, messageId, id, wake);
    this.changed();
    void this.flush();
  }

  private async queue(
    kind: OutboxItem["kind"],
    recipients: string[],
    payload: string,
    messageId: string | null,
    id: string = this.uuid(),
    wake: OutboxItem["wake"] = null,
  ): Promise<void> {
    // Strictly increasing, so the outbox keeps the order things were created in.
    this.lastQueued = Math.max(this.now(), this.lastQueued + 1);
    await this.store.enqueue({ id, createdAt: this.lastQueued, kind, recipients, payload, messageId, wake });
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
        await this.transport.sendMessage({
          type: "send",
          id: item.id,
          recipients: item.recipients,
          kind: item.kind,
          payload: item.payload,
          ...(item.wake ? { wake: item.wake } : {}),
        });
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

  // ---- groups -------------------------------------------------------------

  /** Creates a group with these people, with me as its admin. People without a connected phone are skipped. */
  async createGroup(title: string, people: PublicUser[]): Promise<{ id: string; skipped: PublicUser[] }> {
    const others = this.distinctOthers(people);
    if (others.length + 1 > MAX_GROUP_MEMBERS) throw new MessengerError("too_many");
    const groupId = await this.engine.createGroup();
    const { added, skipped } = await this.invite(groupId, others);
    const conversation: Conversation = {
      ...directChat(groupId, this.me.accountId, this.now()),
      kind: "group",
      title: title.trim().slice(0, 100) || "Группа",
      members: [this.self("admin"), ...added.map((p) => ({ accountId: p.accountId, displayName: p.displayName, username: p.username, role: "member" as const }))],
    };
    await this.publishGroupInfo(conversation);
    return { id: groupId, skipped };
  }

  /** Adds people to a group I am an admin of. */
  async addMembers(conversationId: string, people: PublicUser[]): Promise<{ skipped: PublicUser[] }> {
    const chat = await this.adminChat(conversationId);
    const fresh = this.distinctOthers(people).filter((p) => !chat.members.some((m) => m.accountId === p.accountId));
    if (chat.members.length + fresh.length > MAX_GROUP_MEMBERS) throw new MessengerError("too_many");
    const { added, skipped } = await this.invite(conversationId, fresh);
    if (added.length > 0) {
      await this.publishGroupInfo({
        ...chat,
        members: [...chat.members, ...added.map((p) => ({ accountId: p.accountId, displayName: p.displayName, username: p.username, role: "member" as const }))],
      });
    }
    return { skipped };
  }

  /** Removes someone (all their devices) from a group I am an admin of. */
  async removeMember(conversationId: string, accountId: string): Promise<void> {
    const chat = await this.adminChat(conversationId);
    if (accountId === this.me.accountId || !chat.members.some((m) => m.accountId === accountId)) throw new MessengerError("not_allowed");
    await this.removeDevices(conversationId, accountId);
    await this.publishGroupInfo({ ...chat, members: chat.members.filter((m) => m.accountId !== accountId) });
  }

  /** Makes someone an admin or a regular member; a group always keeps at least one admin. */
  async setRole(conversationId: string, accountId: string, role: GroupMember["role"]): Promise<void> {
    const chat = await this.adminChat(conversationId);
    const members = chat.members.map((m) => (m.accountId === accountId ? { ...m, role } : m));
    if (!members.some((m) => m.role === "admin") || !chat.members.some((m) => m.accountId === accountId)) throw new MessengerError("not_allowed");
    await this.publishGroupInfo({ ...chat, members });
  }

  async renameGroup(conversationId: string, title: string): Promise<void> {
    const chat = await this.adminChat(conversationId);
    const next = title.trim().slice(0, 100);
    if (!next || next === chat.title) return;
    await this.publishGroupInfo({ ...chat, title: next });
  }

  /** Leaves a group. If I am its only admin, the next person becomes admin first. */
  async leaveGroup(conversationId: string): Promise<void> {
    const chat = await this.store.conversation(conversationId);
    if (!chat || chat.kind !== "group" || chat.left) throw new MessengerError("not_allowed");
    const others = chat.members.filter((m) => m.accountId !== this.me.accountId);
    const admins = others.filter((m) => m.role === "admin");
    let members = others;
    if (admins.length === 0 && others.length > 0) {
      members = others.map((m, i) => (i === 0 ? { ...m, role: "admin" as const } : m));
      await this.publishGroupInfo({ ...chat, members: [...members, this.self("admin")] });
    }
    await this.sendPayload(conversationId, { v: 1, type: "leave" }, null);
    const latest = (await this.store.conversation(conversationId)) ?? chat;
    await this.store.saveConversation({ ...latest, members, left: true });
    this.changed();
  }

  private self(role: GroupMember["role"]): GroupMember {
    return { accountId: this.me.accountId, displayName: this.me.displayName, username: this.me.username, role };
  }

  private distinctOthers(people: PublicUser[]): PublicUser[] {
    const seen = new Set<string>([this.me.accountId]);
    return people.filter((p) => !seen.has(p.accountId) && seen.add(p.accountId));
  }

  private async adminChat(conversationId: string): Promise<Conversation> {
    const chat = await this.store.conversation(conversationId);
    const me = chat?.members.find((m) => m.accountId === this.me.accountId);
    if (!chat || chat.kind !== "group" || chat.left || me?.role !== "admin") throw new MessengerError("not_allowed");
    return chat;
  }

  /** Brings every device of these people into the MLS group. */
  private async invite(groupId: string, people: PublicUser[]): Promise<{ added: PublicUser[]; skipped: PublicUser[] }> {
    const added: PublicUser[] = [];
    const skipped: PublicUser[] = [];
    for (const person of people) {
      const claimed = await this.transport.request({ type: "claim_key_packages", accountId: person.accountId }, "key_packages");
      if (claimed.items.length === 0) {
        skipped.push(person);
        continue;
      }
      for (const item of claimed.items) {
        // Everyone already in the group must apply the change.
        const before = await this.recipients(groupId);
        const invitation = await this.engine.addMember(groupId, item.keyPackage);
        if (before.length > 0) await this.queue("commit", before, invitation.commit, null);
        await this.queue("welcome", [item.deviceId], invitation.welcome, null);
      }
      added.push(person);
    }
    return { added, skipped };
  }

  /** Takes all devices of an account out of the MLS group; they get the commit too, so they know. */
  private async removeDevices(groupId: string, accountId: string): Promise<void> {
    const state = await this.engine.groupState(groupId);
    const identities = state.members.filter((identity) => parseIdentity(identity)?.accountId === accountId);
    if (identities.length === 0) return;
    const before = await this.recipients(groupId);
    const commit = await this.engine.removeMembers(groupId, identities);
    if (before.length > 0) await this.queue("commit", before, commit, null);
  }

  /** Saves the next version of the group's name and members and sends it to everyone in it. */
  private async publishGroupInfo(chat: Conversation): Promise<void> {
    const next: Conversation = { ...chat, members: sortMembers(chat.members), version: chat.version + 1 };
    await this.store.saveConversation(next);
    await this.sendPayload(next.id, { v: 1, type: "group_info", title: next.title, members: next.members, version: next.version }, null);
  }

  /** Sign-out: forget chats and keys on this phone. */
  async wipe(): Promise<void> {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    this.typingUntil.clear();
    await this.store.clear();
    await this.files?.clear().catch(() => undefined);
    await this.engine.reset();
    this.changed();
  }
}
