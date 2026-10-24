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

export type MessageStatus = "sending" | "sent" | "failed" | "received";

export interface Message {
  /** Chosen by the sender; the same on both phones. */
  id: string;
  conversationId: string;
  senderAccountId: string;
  outgoing: boolean;
  text: string;
  sentAt: number;
  status: MessageStatus;
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
  /** Returns false if a message with this id already exists. */
  addMessage(message: Message): Promise<boolean>;
  setStatus(messageId: string, status: MessageStatus): Promise<void>;
  markRead(conversationId: string): Promise<void>;
  enqueue(item: OutboxItem): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  dequeue(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** What travels inside the encryption: never readable by the server. */
export type Payload =
  | { v: 1; type: "intro"; accountId: string; displayName: string; username: string }
  | { v: 1; type: "text"; id: string; text: string; sentAt: number };
