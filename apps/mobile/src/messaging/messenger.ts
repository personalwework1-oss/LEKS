import { type DeliveredMessage, MAX_BLOB_BYTES, type PublicUser } from "@leks/protocol";
import type { Realtime } from "../api/realtime";
import { type Engine, utf8Decode, utf8Encode } from "../crypto/engine";
import type { FileIO } from "./files";
import {
  type Attachment,
  type AttachmentKind,
  type CallOutcome,
  type Conversation,
  type GroupMember,
  type Message,
  MAX_GROUP_MEMBERS,
  type MessageStore,
  MAX_ABOUT,
  MAX_DISPLAY_NAME,
  MAX_PHOTO_CHARS,
  type OutboxItem,
  type Payload,
  type Person,
  REACTIONS,
} from "./types";

/** The part of the server connection the messenger uses (the Realtime client in the app). */
export type Transport = Pick<Realtime, "connectionState" | "request" | "sendMessage" | "ack" | "notify">;

export interface Me {
  accountId: string;
  deviceId: string;
  displayName: string;
  username: string;
}

/** What a backup holds (encrypted as a whole before it leaves the phone). */
export interface BackupDump {
  v: 1;
  at: number;
  accountId: string;
  conversations: Conversation[];
  messages: Message[];
  /** Names, photos and my nicknames for people (added later; older copies have none). */
  people?: Person[];
}

export class MessengerError extends Error {
  constructor(readonly code: "no_devices" | "unknown_chat" | "not_ready" | "not_allowed" | "too_large" | "too_many" | "bad_backup") {
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
/** Groups up to this size get my profile again whenever someone new joins. */
const PROFILE_RESEND_MAX_MEMBERS = 30;
/** How long a list of someone's devices is trusted before asking the server again. */
const DEVICE_CACHE_MS = 5 * 60 * 1000;
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
    case "profile":
      return isString(value.displayName) &&
        value.displayName.trim().length > 0 &&
        value.displayName.length <= MAX_DISPLAY_NAME &&
        isString(value.about) &&
        value.about.length <= MAX_ABOUT &&
        (value.photo === null || (isString(value.photo) && value.photo.length <= MAX_PHOTO_CHARS && /^[A-Za-z0-9+/=]+$/.test(value.photo))) &&
        typeof value.version === "number"
        ? (value as Payload)
        : null;
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
/** The message that carries a sent file's link and key. */
function filePayload(message: Message): Payload {
  const sent = message.attachment!;
  return {
    v: 1,
    type: "file",
    id: message.id,
    sentAt: message.sentAt,
    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    caption: message.text,
    blobId: sent.blobId!,
    key: sent.key!,
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
}

/** What goes out for a message of mine, rebuilt from what is stored (held while a restored phone rejoins). */
function payloadOf(message: Message): Payload | null {
  if (message.attachment) return message.attachment.state === "sent" && message.attachment.blobId && message.attachment.key ? filePayload(message) : null;
  return { v: 1, type: "text", id: message.id, text: message.text, sentAt: message.sentAt, ...(message.replyTo ? { replyTo: message.replyTo } : {}) };
}

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
const CALL_TEXT: Record<CallOutcome, [string, string]> = {
  // [mine, theirs]
  ended: ["Исходящий звонок", "Входящий звонок"],
  missed: ["Отменённый звонок", "Пропущенный звонок"],
  declined: ["Звонок отклонён", "Вы отклонили звонок"],
  no_answer: ["Нет ответа", "Пропущенный звонок"],
  cancelled: ["Отменённый звонок", "Пропущенный звонок"],
  failed: ["Звонок не удался", "Звонок не удался"],
};

/** "Пропущенный звонок", "Исходящий видеозвонок · 2:15" and so on. */
export function callText(m: Message): string {
  const event = m.event!;
  if (event.type !== "call") return "Новое устройство";
  let text = CALL_TEXT[event.outcome][m.outgoing ? 0 : 1];
  if (event.video) text = text.replace("звонок", "видеозвонок");
  if (event.outcome === "ended" && event.duration > 0) {
    const s = Math.round(event.duration / 1000);
    text += ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  return text;
}

export function previewOf(m: Message | null): string | null {
  if (!m) return null;
  if (m.event?.type === "call") return `📞 ${callText(m)}`;
  if (m.event?.type === "device") return "🔒 Новое устройство в чате";
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
  private readonly deviceCache = new Map<string, { at: number; ids: string[] }>();
  private readonly syncing = new Map<string, Promise<void>>();
  /** Group members just before a commit is applied, to tell which devices it added. */
  private readonly knownMembers = new Map<string, string[]>();
  private arrivalListener: ((conversationId: string) => void) | null = null;

  /** Told when a message from someone else arrives (to notify if the app is in the background). */
  onArrival(listener: ((conversationId: string) => void) | null): void {
    this.arrivalListener = listener;
  }

  /** The call screen listens here for invites, answers and hang-ups. */
  onCall(listener: ((signal: CallSignal) => void) | null): void {
    this.callListener = listener;
  }

  /** Notes a call in the chat, on this phone only. A missed call counts as unread. */
  async logCall(conversationId: string, outgoing: boolean, video: boolean, outcome: CallOutcome, duration: number): Promise<void> {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) return;
    const message: Message = {
      id: this.uuid(),
      conversationId,
      senderAccountId: outgoing ? this.me.accountId : conversation.peerAccountId,
      outgoing,
      text: "",
      sentAt: this.now(),
      status: outgoing ? "sent" : "read",
      replyTo: null,
      editedAt: null,
      deleted: false,
      reactions: {},
      attachment: null,
      event: { type: "call", video, outcome, duration },
    };
    await this.store.addMessage(message);
    const missed = !outgoing && outcome !== "ended" && outcome !== "declined";
    await this.store.saveConversation({
      ...conversation,
      lastText: previewOf(message),
      lastAt: Math.max(conversation.lastAt, message.sentAt),
      unread: conversation.unread + (missed ? 1 : 0),
    });
    this.changed();
  }

  /** Sends a call signal into the chat (through the outbox, so it keeps its place in line). */
  async sendCallSignal(conversationId: string, payload: Extract<Payload, { type: `call_${string}` }>): Promise<void> {
    const chat = await this.store.conversation(conversationId);
    if (!chat || chat.left || chat.rejoining) throw new MessengerError("not_allowed");
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
    // Devices that appeared or disappeared since last time (a friend's new phone, a removed one).
    void this.rememberAllMembers().then(() => this.syncAll());
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
      this.knownMembers.set(groupId, await this.engine.members(groupId));
      const existing = await this.store.conversation(groupId);
      if (!existing) {
        // The inviter may be one of my own phones, so the person this chat is with comes from the group.
        const others = (await this.engine.members(groupId)).map((m) => parseIdentity(m)?.accountId).filter((a) => a && a !== this.me.accountId);
        const peer = others.includes(message.from.accountId) ? message.from.accountId : (others[0] ?? message.from.accountId);
        await this.store.saveConversation(directChat(groupId, peer, message.sentAt));
        await this.shareProfile(groupId);
      } else if (existing.rejoining || existing.left) {
        // This phone (restored from a backup) is back in the chat.
        await this.store.saveConversation({ ...existing, rejoining: false, left: false });
        if (existing.rejoining) await this.releaseHeld(groupId);
      }
      return null;
    }

    const result = await this.engine.receive(message.payload);
    if (result.kind === "group_updated") {
      // A commit may have removed me from a group.
      const state = await this.engine.groupState(result.groupId).catch(() => null);
      const chat = await this.store.conversation(result.groupId);
      if (state && !state.active && chat && !chat.left) await this.store.saveConversation({ ...chat, left: true });
      // A new phone of someone already in the chat: shown to everyone, not just to the phone that added it.
      if (state?.active && chat && !chat.left) {
        const known = this.knownMembers.get(result.groupId);
        if (known) {
          const accountsBefore = new Set(known.map((m) => parseIdentity(m)?.accountId));
          const newDevices = state.members.filter((m) => !known.includes(m));
          for (const account of new Set(newDevices.map((m) => parseIdentity(m)?.accountId))) {
            if (account && accountsBefore.has(account)) await this.noteDevice(result.groupId, account);
          }
          // Newcomers (people or phones) get my photo and "about"; in big groups they get it when I change it.
          if (newDevices.length > 0 && (chat.kind === "direct" || chat.members.length <= PROFILE_RESEND_MAX_MEMBERS)) {
            await this.shareProfile(result.groupId);
          }
        }
        this.knownMembers.set(result.groupId, state.members);
      }
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
        // From the person themselves, or from one of my phones bringing a new phone of mine into the chat.
        if (!isGroup && ((fromPeer && payload.accountId === sender.accountId) || (mine && payload.accountId === conversation.peerAccountId))) {
          await this.store.saveConversation({ ...conversation, title: payload.displayName, username: payload.username || null });
        }
        return null;

      case "profile": {
        const known = await this.store.person(sender.accountId);
        if (known && payload.version <= known.version) return null;
        await this.store.savePerson({
          accountId: sender.accountId,
          displayName: payload.displayName.trim(),
          username: known?.username ?? (!isGroup ? conversation.username : null),
          about: payload.about,
          photo: payload.photo,
          version: payload.version,
          nickname: known?.nickname ?? null,
        });
        // The chat list shows the new name too.
        const direct = await this.store.conversationWith(sender.accountId);
        if (direct && !mine) await this.store.saveConversation({ ...direct, title: payload.displayName.trim() });
        return null;
      }

      case "group_info": {
        // The inviter turns a fresh chat into a group; after that only admins can change it.
        // (or, on a phone just brought into an existing group, any member telling it what the group is).
        const fresh = !isGroup && conversation.lastText === null && conversation.version === 0;
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
        if (!mine) this.arrivalListener?.(conversation.id);
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
        if (!mine) this.arrivalListener?.(conversation.id);
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

    const intro = await this.introPayload();
    await this.queue("message", invited, await this.engine.encrypt(groupId, utf8Encode(JSON.stringify(intro))), null);
    const profile = await this.profilePayload();
    if (profile) await this.queue("message", invited, await this.engine.encrypt(groupId, utf8Encode(JSON.stringify(profile))), null);

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
    if (conversation.rejoining) {
      // Restored phone not back in the chat yet: kept as "sending" and sent the moment it is.
      this.changed();
      this.askToRejoin();
      return message;
    }
    await this.sendPayload(conversationId, payload, message.id, message.id);
    void this.syncDevices(conversationId);
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
      const payload = filePayload({ ...latest, attachment: sent });
      if ((await this.store.conversation(latest.conversationId))?.rejoining) {
        this.askToRejoin();
        return;
      }
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
    // Not back in the chat yet (restored phone): receipts, reactions and the like are skipped.
    if ((await this.store.conversation(conversationId))?.rejoining) return;
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

  // ---- profiles --------------------------------------------------------------

  /** Everyone I know something about (and me), for names and photos on screens. */
  people(): Promise<Person[]> {
    return this.store.people();
  }

  person(accountId: string): Promise<Person | null> {
    return this.store.person(accountId);
  }

  private async introPayload(): Promise<Payload> {
    const mine = await this.store.person(this.me.accountId);
    return { v: 1, type: "intro", accountId: this.me.accountId, displayName: mine?.displayName ?? this.me.displayName, username: this.me.username };
  }

  private async profilePayload(): Promise<Payload | null> {
    const mine = await this.store.person(this.me.accountId);
    if (!mine) return null;
    return { v: 1, type: "profile", displayName: mine.displayName, about: mine.about, photo: mine.photo, version: mine.version };
  }

  /** Sends my name, "about" and photo into a chat (only if I ever set them). */
  private async shareProfile(conversationId: string): Promise<void> {
    const profile = await this.profilePayload();
    if (profile) await this.sendPayload(conversationId, profile, null).catch((error: unknown) => console.warn("profile", error));
  }

  /**
   * Changes my name, "about" or photo (square JPEG, base64; null removes it).
   * Goes to everyone I chat with, end-to-end encrypted: the server sees only
   * the name (it already knows it, to find me by @username).
   */
  async setProfile(change: { displayName?: string; about?: string; photo?: string | null }): Promise<Person> {
    const current = (await this.store.person(this.me.accountId)) ?? {
      accountId: this.me.accountId,
      displayName: this.me.displayName,
      username: this.me.username,
      about: "",
      photo: null,
      version: 0,
      nickname: null,
    };
    const displayName = (change.displayName ?? current.displayName).trim().slice(0, MAX_DISPLAY_NAME);
    if (!displayName) throw new MessengerError("not_allowed");
    const photo = change.photo === undefined ? current.photo : change.photo;
    if (photo && photo.length > MAX_PHOTO_CHARS) throw new MessengerError("too_large");
    const next: Person = {
      ...current,
      displayName,
      about: (change.about ?? current.about).trim().slice(0, MAX_ABOUT),
      photo,
      version: Math.max(this.now(), current.version + 1),
    };
    await this.store.savePerson(next);
    if (displayName !== current.displayName) {
      await this.transport.request({ type: "update_profile", displayName }, "profile_updated").catch((error: unknown) => console.warn("name on server", error));
    }
    this.changed();
    for (const chat of await this.store.conversations()) {
      if (!chat.left && !chat.rejoining) await this.shareProfile(chat.id);
    }
    void this.flush();
    return next;
  }

  /** My own name for someone (only on this phone); null or empty goes back to their name. */
  async setNickname(accountId: string, nickname: string | null): Promise<void> {
    const direct = await this.store.conversationWith(accountId);
    const known = (await this.store.person(accountId)) ?? {
      accountId,
      displayName: direct?.title ?? "",
      username: direct?.username ?? null,
      about: "",
      photo: null,
      version: 0,
      nickname: null,
    };
    const clean = nickname?.trim().slice(0, MAX_DISPLAY_NAME) || null;
    await this.store.savePerson({ ...known, nickname: clean });
    this.changed();
  }

  // ---- backup ---------------------------------------------------------------

  /**
   * Saves an encrypted copy of all chats on the server. The copy is encrypted
   * with a new key; `wrap` locks that key with the password (on this phone),
   * so the server holds nothing it can read. Attachments are included as
   * links (they stay on the server for a while) and download again when opened.
   */
  async backup(wrap: (fileKey: string) => Promise<string>): Promise<{ size: number; chats: number; messages: number }> {
    if (!this.files) throw new MessengerError("not_allowed");
    const conversations = await this.store.conversations();
    const messages: Message[] = [];
    for (const chat of conversations) {
      for (const m of await this.store.messages(chat.id, Number.MAX_SAFE_INTEGER)) {
        messages.push({
          ...m,
          status: m.status === "sending" ? "failed" : m.status,
          attachment: m.attachment ? { ...m.attachment, localUri: null, state: m.attachment.blobId ? "remote" : "failed" } : null,
        });
      }
    }
    const people = await this.store.people();
    const dump: BackupDump = { v: 1, at: this.now(), accountId: this.me.accountId, conversations, messages, people };
    const plain = this.files.tempUri();
    const encrypted = this.files.tempUri();
    try {
      await this.files.writeText(plain, JSON.stringify(dump));
      const { key, size } = await this.engine.encryptFile(plain, encrypted);
      await this.files.remove(plain);
      if (size > MAX_BLOB_BYTES) throw new MessengerError("too_large");
      const ticket = await this.transport.request({ type: "request_upload", size }, "upload_ready");
      await this.files.upload(ticket.blobId, ticket.token, encrypted);
      await this.transport.request({ type: "set_backup", blobId: ticket.blobId, wrappedKey: await wrap(key) }, "backup_saved");
      return { size, chats: conversations.length, messages: messages.length };
    } finally {
      await this.files.remove(plain).catch(() => undefined);
      await this.files.remove(encrypted).catch(() => undefined);
    }
  }

  /** When the last copy was saved, or null if there is none. */
  async backupInfo(): Promise<{ size: number; updatedAt: number } | null> {
    const answer = await this.transport.request({ type: "get_backup" }, "backup");
    return answer.backup ? { size: answer.backup.size, updatedAt: answer.backup.updatedAt } : null;
  }

  /**
   * Brings the chats back from the copy on the server. `unwrap` unlocks the
   * copy's key with the password and throws if it is the wrong one. Restored
   * chats can be read at once; writing works once someone in each chat has
   * brought this phone in (they are asked to right away).
   */
  async restore(unwrap: (wrappedKey: string) => Promise<string>): Promise<{ chats: number; messages: number } | null> {
    if (!this.files) throw new MessengerError("not_allowed");
    const answer = await this.transport.request({ type: "get_backup" }, "backup");
    if (!answer.backup) return null;
    const key = await unwrap(answer.backup.wrappedKey);
    const encrypted = this.files.tempUri();
    const plain = this.files.tempUri();
    let dump: BackupDump;
    try {
      await this.files.download(answer.backup.blobId, encrypted);
      await this.engine.decryptFile(encrypted, plain, key);
      dump = JSON.parse(await this.files.readText(plain)) as BackupDump;
    } finally {
      await this.files.remove(plain).catch(() => undefined);
      await this.files.remove(encrypted).catch(() => undefined);
    }
    if (dump?.v !== 1 || dump.accountId !== this.me.accountId || !Array.isArray(dump.conversations) || !Array.isArray(dump.messages)) {
      throw new MessengerError("bad_backup");
    }
    let chats = 0;
    for (const chat of dump.conversations) {
      if (!chat?.id || (await this.store.conversation(chat.id))) continue;
      const state = await this.engine.groupState(chat.id).catch(() => null);
      await this.store.saveConversation({ ...chat, unread: 0, rejoining: !chat.left && !state?.active });
      chats++;
    }
    for (const person of dump.people ?? []) {
      const known = person?.accountId ? await this.store.person(person.accountId) : null;
      if (person?.accountId && (!known || known.version < person.version || (!known.nickname && person.nickname))) {
        await this.store.savePerson(known && known.version >= person.version ? { ...known, nickname: person.nickname } : person);
      }
    }
    let restored = 0;
    for (const m of dump.messages) {
      if (m?.id && m.conversationId && (await this.store.addMessage(m))) restored++;
    }
    this.changed();
    void this.nudgeContacts().catch((error: unknown) => console.warn("nudge", error));
    return { chats, messages: restored };
  }

  // ---- devices in chats -----------------------------------------------------

  private async devicesOf(accountId: string, fresh: boolean): Promise<string[]> {
    const cached = this.deviceCache.get(accountId);
    if (!fresh && cached && this.now() - cached.at < DEVICE_CACHE_MS) return cached.ids;
    const answer = await this.transport.request({ type: "list_devices", accountId }, "devices");
    const ids = answer.devices.map((d) => d.deviceId);
    this.deviceCache.set(accountId, { at: this.now(), ids });
    return ids;
  }

  private chatAccounts(chat: Conversation): string[] {
    const accounts = chat.kind === "group" ? chat.members.map((m) => m.accountId) : [chat.peerAccountId];
    return [...new Set([...accounts, this.me.accountId])];
  }

  private async rememberAllMembers(): Promise<void> {
    for (const chat of await this.store.conversations()) {
      if (chat.left || this.knownMembers.has(chat.id)) continue;
      const state = await this.engine.groupState(chat.id).catch(() => null);
      if (state?.active) this.knownMembers.set(chat.id, state.members);
    }
  }

  /** Checks every chat (after connecting). */
  async syncAll(fresh = false): Promise<void> {
    for (const chat of await this.store.conversations()) {
      if (!chat.left && !chat.rejoining) await this.syncDevices(chat.id, fresh);
    }
  }

  /** Someone's devices changed: check the chats with them right away. */
  async onNudge(accountId: string): Promise<void> {
    this.deviceCache.delete(accountId);
    for (const chat of await this.store.conversations()) {
      if (!chat.left && !chat.rejoining && this.chatAccounts(chat).includes(accountId)) await this.syncDevices(chat.id, true);
    }
  }

  /** Messages written while this phone was waiting to be brought back into the chat go out now, in order. */
  private async releaseHeld(conversationId: string): Promise<void> {
    const held = (await this.store.messages(conversationId, Number.MAX_SAFE_INTEGER))
      .filter((m) => m.outgoing && m.status === "sending" && !m.deleted && !m.event)
      .sort((a, b) => a.sentAt - b.sentAt);
    for (const message of held) {
      const payload = payloadOf(message);
      if (payload) await this.sendPayload(conversationId, payload, message.id, message.id);
      else if (message.attachment?.state === "uploading") void this.upload(message.id);
    }
  }

  private lastRejoinAsk = 0;
  /** Writing in a chat this phone is not back in yet: reminds the others' phones (at most once a minute). */
  private askToRejoin(): void {
    if (this.now() - this.lastRejoinAsk < 60_000) return;
    this.lastRejoinAsk = this.now();
    void this.nudgeContacts().catch(() => undefined);
  }

  /** After a restore: asks the people in my chats to bring this phone in now (they also do it on their own later). */
  async nudgeContacts(): Promise<void> {
    const accounts = new Set<string>();
    for (const chat of await this.store.conversations()) for (const account of this.chatAccounts(chat)) accounts.add(account);
    const devices: string[] = [];
    for (const account of accounts) {
      for (const id of await this.devicesOf(account, true).catch(() => [] as string[])) if (id !== this.me.deviceId) devices.push(id);
    }
    for (let i = 0; i < devices.length; i += 1000) this.transport.notify({ type: "nudge", deviceIds: devices.slice(i, i + 1000) });
  }

  /**
   * Brings a chat's encryption group in line with its members' current devices:
   * adds new ones (another phone, a reinstall) and removes deleted ones. Exactly
   * one device does it — the first, in sort order, of those that stay — so two
   * phones never change the group at the same moment.
   */
  syncDevices(conversationId: string, fresh = false): Promise<void> {
    const running = this.syncing.get(conversationId);
    if (running) return running;
    const run = this.doSyncDevices(conversationId, fresh)
      .catch((error: unknown) => console.warn("device sync", error))
      .finally(() => this.syncing.delete(conversationId));
    this.syncing.set(conversationId, run);
    return run;
  }

  private async doSyncDevices(conversationId: string, fresh: boolean): Promise<void> {
    const chat = await this.store.conversation(conversationId);
    if (!chat || chat.left || chat.rejoining) return;
    const state = await this.engine.groupState(conversationId);
    if (!state.active) return;
    const accounts = this.chatAccounts(chat);

    const expected = new Set<string>();
    for (const account of accounts) for (const id of await this.devicesOf(account, fresh)) expected.add(identityOf({ accountId: account, deviceId: id }));
    const current = state.members;
    const staying = current.filter((m) => expected.has(m)).sort();
    if (staying[0] !== this.identity) return;

    // Only devices of people already in the group: someone just removed (whose leaving
    // has not reached the member list yet) is never brought back.
    const present = new Set(current.map((m) => parseIdentity(m)?.accountId));
    const gone = current.filter((m) => !expected.has(m) && accounts.includes(parseIdentity(m)?.accountId ?? ""));
    const missing = [...expected].filter((m) => !current.includes(m) && present.has(parseIdentity(m)?.accountId));
    if (gone.length === 0 && missing.length === 0) return;
    // Never remove anyone on the strength of a list that may be out of date.
    if (gone.length > 0 && !fresh) return this.doSyncDevices(conversationId, true);

    if (gone.length > 0) {
      const before = await this.recipients(conversationId);
      const commit = await this.engine.removeMembers(conversationId, gone);
      if (before.length > 0) await this.queue("commit", before, commit, null);
    }

    const byAccount = new Map<string, string[]>();
    for (const identity of missing) {
      const parsed = parseIdentity(identity);
      if (parsed) byAccount.set(parsed.accountId, [...(byAccount.get(parsed.accountId) ?? []), parsed.deviceId]);
    }
    const addedAccounts: string[] = [];
    for (const [account, deviceIds] of byAccount) {
      const claimed = await this.transport.request({ type: "claim_key_packages", accountId: account }, "key_packages");
      let added = false;
      for (const item of claimed.items) {
        if (!deviceIds.includes(item.deviceId)) continue;
        const before = await this.recipients(conversationId);
        const invitation = await this.engine.addMember(conversationId, item.keyPackage);
        if (before.length > 0) await this.queue("commit", before, invitation.commit, null);
        await this.queue("welcome", [item.deviceId], invitation.welcome, null);
        added = true;
      }
      // Visible in the chat, so a device slipped in by someone else would not go unnoticed.
      if (added) {
        await this.noteDevice(conversationId, account);
        addedAccounts.push(account);
      }
    }

    if (addedAccounts.length > 0) {
      const latest = (await this.store.conversation(conversationId)) ?? chat;
      // Tell the new device what this chat is (same version: the others already know it).
      if (latest.kind === "group") {
        await this.sendPayload(conversationId, { v: 1, type: "group_info", title: latest.title, members: latest.members, version: latest.version }, null);
      } else {
        // A new phone of mine learns who the chat is with; a new phone of theirs learns who I am.
        if (addedAccounts.includes(this.me.accountId) && latest.peerAccountId !== this.me.accountId) {
          await this.sendPayload(conversationId, { v: 1, type: "intro", accountId: latest.peerAccountId, displayName: latest.title, username: latest.username ?? "" }, null);
        }
        if (addedAccounts.some((a) => a !== this.me.accountId)) {
          await this.sendPayload(conversationId, await this.introPayload(), null);
          await this.shareProfile(conversationId);
        }
      }
    }
    const after = await this.engine.groupState(conversationId).catch(() => null);
    if (after) this.knownMembers.set(conversationId, after.members);
    this.changed();
    void this.flush();
  }

  private async noteDevice(conversationId: string, accountId: string): Promise<void> {
    const conversation = await this.store.conversation(conversationId);
    if (!conversation) return;
    const message: Message = {
      id: this.uuid(),
      conversationId,
      senderAccountId: accountId,
      outgoing: accountId === this.me.accountId,
      text: "",
      sentAt: this.now(),
      status: "read",
      replyTo: null,
      editedAt: null,
      deleted: false,
      reactions: {},
      attachment: null,
      event: { type: "device" },
    };
    await this.store.addMessage(message);
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
