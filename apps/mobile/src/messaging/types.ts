export type GroupRole = "admin" | "member";

export interface GroupMember {
  accountId: string;
  displayName: string;
  username: string;
  role: GroupRole;
}

/** Most people in one group for now. */
export const MAX_GROUP_MEMBERS = 200;

export interface Conversation {
  /** The MLS group id (base64url); one group per chat. */
  id: string;
  kind: "direct" | "group";
  /** Direct chats: the other person. Groups: who invited me (or me, if I created it). */
  peerAccountId: string;
  title: string;
  username: string | null;
  lastText: string | null;
  lastAt: number;
  unread: number;
  /** Groups only: everyone in it (including me), and the version of that list. */
  members: GroupMember[];
  version: number;
  /** I left the group or was removed; it stays readable but closed. */
  left: boolean;
  /** Restored from a backup on a new phone: readable, waiting for someone in it to add this phone. */
  rejoining?: boolean;
  /** Kept at the top of the list (only on this phone). */
  pinned?: boolean;
  /** Disappearing messages: new messages are deleted on every phone this many seconds after sending (0 = off). */
  timer?: number;
  /** Unsent text in the composer (only on this phone). */
  draft?: string | null;
  /** false: someone I do not know started it (or added me to a group) and I have not answered yet. */
  accepted?: boolean;
  /** Moved out of the main list (only on this phone). */
  archived?: boolean;
  /** No notifications until then (ms); a far-future value means "always". */
  mutedUntil?: number;
}

/**
 * Outgoing: sending → sent (stored by the server) → delivered (on their phone) → read.
 * Incoming: received → read (by me).
 */
export type MessageStatus = "sending" | "sent" | "failed" | "delivered" | "read" | "received";

/** Statuses only move forward; a late "delivered" never undoes "read". */
export const STATUS_RANK: Record<MessageStatus, number> = { failed: 0, sending: 1, sent: 2, delivered: 3, received: 3, read: 4 };

export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export interface Message {
  /** Chosen by the sender; the same on both phones. */
  id: string;
  conversationId: string;
  senderAccountId: string;
  outgoing: boolean;
  text: string;
  sentAt: number;
  status: MessageStatus;
  /** Id of the message this one answers. */
  replyTo: string | null;
  editedAt: number | null;
  /** Deleted by the sender for everyone; the text is gone. */
  deleted: boolean;
  /** One reaction per person: account id → emoji. */
  reactions: Record<string, string>;
  /** A photo or file; `text` is then its caption. */
  attachment: Attachment | null;
  /** A place on the map (the text is then empty or a caption). */
  location?: GeoPoint | null;
  /** Forwarded from another chat (who wrote it first is not shown, like in other messengers). */
  forwarded?: boolean;
  /** Disappearing messages: when it is deleted on this phone (ms). */
  expiresAt?: number | null;
  /** A note in the chat about a call (kept only on this phone). */
  event?: ChatEvent | null;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Metres. */
  accuracy?: number;
}

export type CallOutcome = "ended" | "missed" | "declined" | "no_answer" | "cancelled" | "failed";

export interface CallEvent {
  type: "call";
  video: boolean;
  outcome: CallOutcome;
  /** How long the conversation lasted, in ms (ended calls). */
  duration: number;
}

/** Someone in the chat (the message's sender) started using another device. */
export interface DeviceEvent {
  type: "device";
}

/** Someone turned disappearing messages on or off (seconds; 0 = off). */
export interface TimerEvent {
  type: "timer";
  seconds: number;
}

export type ChatEvent = CallEvent | DeviceEvent | TimerEvent;

/** The choices for disappearing messages, in seconds. */
export const TIMER_CHOICES = [0, 24 * 3600, 7 * 24 * 3600, 30 * 24 * 3600] as const;

export function timerLabel(seconds: number): string {
  if (!seconds) return "Выкл.";
  if (seconds <= 24 * 3600) return "1 день";
  if (seconds <= 7 * 24 * 3600) return "1 неделя";
  return "1 месяц";
}

export type AttachmentKind = "image" | "video" | "file" | "voice";

/**
 * Where an attachment is:
 * uploading → sent (mine), or remote → downloading → ready (theirs); failed if a step did not work.
 */
export type AttachmentState = "uploading" | "sent" | "remote" | "downloading" | "ready" | "failed";

export interface Attachment {
  kind: AttachmentKind;
  name: string;
  mime: string;
  /** Size of the original file in bytes. */
  size: number;
  width: number | null;
  height: number | null;
  /** A tiny JPEG preview (base64) shown until the real image is here. */
  thumb: string | null;
  /** Voice messages: length in milliseconds and loudness bars (0–1). */
  duration?: number | null;
  waveform?: number[] | null;
  /** Where the encrypted copy is on the server, and its key (base64url); null until uploaded. */
  blobId: string | null;
  key: string | null;
  /** The decrypted file on this phone. */
  localUri: string | null;
  state: AttachmentState;
}

/**
 * Someone I chat with (or me): what they share about themselves, plus the
 * name I gave them, which stays on this phone.
 */
export interface Person {
  accountId: string;
  displayName: string;
  username: string | null;
  about: string;
  /** Square JPEG, base64 (no data: prefix); null when there is no photo. */
  photo: string | null;
  /** When they last changed it (their clock); older updates are ignored. */
  version: number;
  /** My own name for them; never sent anywhere. */
  nickname: string | null;
  /** I blocked them: nothing from them reaches me (the server enforces it too). */
  blocked?: boolean;
}

/** The longest "about" text. */
export const MAX_ABOUT = 140;

/** "Always" for muting: year 2100. */
export const MUTED_FOREVER = 4_102_444_800_000;

export const isMuted = (chat: { mutedUntil?: number } | null | undefined, now = Date.now()) => !!chat?.mutedUntil && chat.mutedUntil > now;
export const MAX_DISPLAY_NAME = 64;
/** Profile photos travel inside the encrypted message, so they are kept small. */
export const MAX_PHOTO_CHARS = 110_000;

/** Something waiting to go to the server, kept until the server confirms it. */
export interface OutboxItem {
  id: string;
  createdAt: number;
  kind: "welcome" | "commit" | "message";
  recipients: string[];
  payload: string;
  /** The chat message this delivers, if any, so its status can be updated. */
  messageId: string | null;
  /** Whether an offline recipient gets a push for it. */
  wake?: "message" | "call" | null;
  /** The chat's tag, so the server can skip pushes for a chat the recipient muted. */
  chat?: string | null;
}

/** Where chats live on the phone. */
export interface MessageStore {
  conversations(): Promise<Conversation[]>;
  conversation(id: string): Promise<Conversation | null>;
  conversationWith(peerAccountId: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;
  messages(conversationId: string, limit?: number): Promise<Message[]>;
  message(id: string): Promise<Message | null>;
  /** Returns false if a message with this id already exists. */
  addMessage(message: Message): Promise<boolean>;
  /** Sets the status unless the message already has a later one. */
  setStatus(messageId: string, status: MessageStatus): Promise<void>;
  /** My messages whose file is still being uploaded (to resume after a restart). */
  pendingUploads(): Promise<Message[]>;
  updateMessage(message: Message): Promise<void>;
  /** Removes a message from this phone only. */
  removeMessage(id: string): Promise<void>;
  /** Incoming messages in the chat not yet marked read, oldest first. */
  unreadIncoming(conversationId: string): Promise<Message[]>;
  markRead(conversationId: string): Promise<void>;
  /** Messages whose time is up (disappearing messages). */
  expired(now: number): Promise<Message[]>;
  people(): Promise<Person[]>;
  person(accountId: string): Promise<Person | null>;
  savePerson(person: Person): Promise<void>;
  enqueue(item: OutboxItem): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  dequeue(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** What travels inside the encryption: never readable by the server. */
export type Payload =
  /** `existing`: sent when a new phone is brought into a chat that already existed. */
  | { v: 1; type: "intro"; accountId: string; displayName: string; username: string; existing?: boolean }
  | { v: 1; type: "profile"; displayName: string; about: string; photo: string | null; version: number }
  | { v: 1; type: "text"; id: string; text: string; sentAt: number; replyTo?: string; location?: GeoPoint; forwarded?: boolean; ttl?: number }
  /** Turns disappearing messages on (seconds) or off (0) for the chat. */
  | { v: 1; type: "timer"; seconds: number; at: number }
  | {
      v: 1;
      type: "file";
      id: string;
      sentAt: number;
      replyTo?: string;
      caption: string;
      blobId: string;
      key: string;
      kind: AttachmentKind;
      name: string;
      mime: string;
      size: number;
      width?: number;
      height?: number;
      thumb?: string;
      duration?: number;
      waveform?: number[];
      forwarded?: boolean;
      ttl?: number;
    }
  | { v: 1; type: "receipt"; state: "delivered" | "read"; ids: string[] }
  | { v: 1; type: "edit"; id: string; text: string; editedAt: number }
  | { v: 1; type: "delete"; id: string }
  /** An empty emoji removes the reaction. */
  | { v: 1; type: "reaction"; id: string; emoji: string }
  /** The group's name and members, sent by an admin; a higher version replaces a lower one. */
  | { v: 1; type: "group_info"; title: string; members: GroupMember[]; version: number }
  /** I am leaving the group; an admin's phone then removes my devices. */
  | { v: 1; type: "leave" }
  /** Calls: the room id and the media key travel only inside this encryption. */
  | { v: 1; type: "call_invite"; callId: string; video: boolean; key: string; sentAt: number }
  | { v: 1; type: "call_accept" | "call_decline" | "call_end"; callId: string }
  /** Not stored or retried: only shows "typing…" for a few seconds. */
  | { v: 1; type: "typing" };
