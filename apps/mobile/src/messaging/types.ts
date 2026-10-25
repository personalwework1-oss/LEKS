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
  /** A note in the chat about a call (kept only on this phone). */
  event?: ChatEvent | null;
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

export type ChatEvent = CallEvent | DeviceEvent;

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
  enqueue(item: OutboxItem): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  dequeue(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** What travels inside the encryption: never readable by the server. */
export type Payload =
  | { v: 1; type: "intro"; accountId: string; displayName: string; username: string }
  | { v: 1; type: "text"; id: string; text: string; sentAt: number; replyTo?: string }
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
