import * as SQLite from "expo-sqlite";
import type { Conversation, Message, MessageStatus, MessageStore, OutboxItem } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  peer_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  username TEXT,
  last_text TEXT,
  last_at INTEGER NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS conversations_peer ON conversations (peer_account_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_account_id TEXT NOT NULL,
  outgoing INTEGER NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, sent_at);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipients TEXT NOT NULL,
  payload TEXT NOT NULL,
  message_id TEXT
);
`;

interface ConversationRow {
  id: string;
  peer_account_id: string;
  title: string;
  username: string | null;
  last_text: string | null;
  last_at: number;
  unread: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_account_id: string;
  outgoing: number;
  text: string;
  sent_at: number;
  status: MessageStatus;
}

interface OutboxRow {
  id: string;
  created_at: number;
  kind: OutboxItem["kind"];
  recipients: string;
  payload: string;
  message_id: string | null;
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  peerAccountId: r.peer_account_id,
  title: r.title,
  username: r.username,
  lastText: r.last_text,
  lastAt: r.last_at,
  unread: r.unread,
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderAccountId: r.sender_account_id,
  outgoing: r.outgoing === 1,
  text: r.text,
  sentAt: r.sent_at,
  status: r.status,
});

/**
 * Chats on the phone, in the app's private SQLite database (one file per
 * device id). Message text is stored only here, never on the server.
 */
export class SqliteStore implements MessageStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name: string): Promise<SqliteStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync(SCHEMA);
    return new SqliteStore(db);
  }

  async conversations() {
    const rows = await this.db.getAllAsync<ConversationRow>("SELECT * FROM conversations ORDER BY last_at DESC");
    return rows.map(toConversation);
  }

  async conversation(id: string) {
    const row = await this.db.getFirstAsync<ConversationRow>("SELECT * FROM conversations WHERE id = ?", [id]);
    return row ? toConversation(row) : null;
  }

  async conversationWith(peerAccountId: string) {
    const row = await this.db.getFirstAsync<ConversationRow>(
      "SELECT * FROM conversations WHERE peer_account_id = ? ORDER BY last_at DESC LIMIT 1",
      [peerAccountId],
    );
    return row ? toConversation(row) : null;
  }

  async saveConversation(c: Conversation) {
    await this.db.runAsync(
      `INSERT INTO conversations (id, peer_account_id, title, username, last_text, last_at, unread)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET peer_account_id = excluded.peer_account_id, title = excluded.title,
         username = excluded.username, last_text = excluded.last_text, last_at = excluded.last_at, unread = excluded.unread`,
      [c.id, c.peerAccountId, c.title, c.username, c.lastText, c.lastAt, c.unread],
    );
  }

  async messages(conversationId: string, limit = 200) {
    const rows = await this.db.getAllAsync<MessageRow>(
      "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT ?) ORDER BY sent_at ASC",
      [conversationId, limit],
    );
    return rows.map(toMessage);
  }

  async addMessage(m: Message) {
    const result = await this.db.runAsync(
      `INSERT OR IGNORE INTO messages (id, conversation_id, sender_account_id, outgoing, text, sent_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.conversationId, m.senderAccountId, m.outgoing ? 1 : 0, m.text, m.sentAt, m.status],
    );
    return result.changes > 0;
  }

  async setStatus(messageId: string, status: MessageStatus) {
    await this.db.runAsync("UPDATE messages SET status = ? WHERE id = ?", [status, messageId]);
  }

  async markRead(conversationId: string) {
    await this.db.runAsync("UPDATE conversations SET unread = 0 WHERE id = ?", [conversationId]);
  }

  async enqueue(item: OutboxItem) {
    await this.db.runAsync(
      "INSERT OR REPLACE INTO outbox (id, created_at, kind, recipients, payload, message_id) VALUES (?, ?, ?, ?, ?, ?)",
      [item.id, item.createdAt, item.kind, JSON.stringify(item.recipients), item.payload, item.messageId],
    );
  }

  async outbox() {
    const rows = await this.db.getAllAsync<OutboxRow>("SELECT * FROM outbox ORDER BY created_at ASC");
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      kind: r.kind,
      recipients: JSON.parse(r.recipients) as string[],
      payload: r.payload,
      messageId: r.message_id,
    }));
  }

  async dequeue(id: string) {
    await this.db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
  }

  async clear() {
    await this.db.execAsync("DELETE FROM outbox; DELETE FROM messages; DELETE FROM conversations;");
  }
}
