export interface Conversation {
  /** The MLS group id (base64url); one group per chat. */
  id: string;
  peerAccountId: string;
  title: string;
  username: string | null;
  lastText: string | null;
  lastAt: number;
  unread: number;
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
  | { v: 1; type: "receipt"; state: "delivered" | "read"; ids: string[] }
  | { v: 1; type: "edit"; id: string; text: string; editedAt: number }
  | { v: 1; type: "delete"; id: string }
  /** An empty emoji removes the reaction. */
  | { v: 1; type: "reaction"; id: string; emoji: string }
  /** Not stored or retried: only shows "typing…" for a few seconds. */
  | { v: 1; type: "typing" };
