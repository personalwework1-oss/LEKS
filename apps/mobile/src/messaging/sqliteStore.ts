import * as SQLite from "expo-sqlite";
import { type Attachment, type ChatEvent, type Conversation, type GroupMember, type Message, type MessageStatus, type GeoPoint, type MessageStore, type OutboxItem, type Person, STATUS_RANK } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  peer_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  username TEXT,
  last_text TEXT,
  last_at INTEGER NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'direct',
  members TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  left_group INTEGER NOT NULL DEFAULT 0,
  rejoining INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  timer INTEGER NOT NULL DEFAULT 0,
  draft TEXT,
  accepted INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS conversations_peer ON conversations (peer_account_id);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_account_id TEXT NOT NULL,
  outgoing INTEGER NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  reply_to TEXT,
  edited_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  reactions TEXT NOT NULL DEFAULT '{}',
  attachment TEXT,
  event TEXT,
  location TEXT,
  forwarded INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, sent_at);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  recipients TEXT NOT NULL,
  payload TEXT NOT NULL,
  message_id TEXT,
  wake TEXT,
  chat TEXT
);
CREATE TABLE IF NOT EXISTS people (
  account_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  username TEXT,
  about TEXT NOT NULL DEFAULT '',
  photo TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  nickname TEXT,
  blocked INTEGER NOT NULL DEFAULT 0
);
`;

/** Columns added after the first test builds; applied once to older databases. */
const UPGRADES: string[] = [
  `ALTER TABLE messages ADD COLUMN reply_to TEXT;
   ALTER TABLE messages ADD COLUMN edited_at INTEGER;
   ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE messages ADD COLUMN reactions TEXT NOT NULL DEFAULT '{}';`,
  `ALTER TABLE messages ADD COLUMN attachment TEXT;`,
  `ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct';
   ALTER TABLE conversations ADD COLUMN members TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE conversations ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE conversations ADD COLUMN left_group INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE outbox ADD COLUMN wake TEXT;`,
  `ALTER TABLE messages ADD COLUMN event TEXT;`,
  `ALTER TABLE conversations ADD COLUMN rejoining INTEGER NOT NULL DEFAULT 0;`,
  // The people table comes from SCHEMA (CREATE TABLE IF NOT EXISTS).
  `SELECT 1;`,
  `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE messages ADD COLUMN location TEXT;
   ALTER TABLE messages ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE conversations ADD COLUMN timer INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE conversations ADD COLUMN draft TEXT;
   ALTER TABLE messages ADD COLUMN expires_at INTEGER;`,
  `ALTER TABLE conversations ADD COLUMN accepted INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE people ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE conversations ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE outbox ADD COLUMN chat TEXT;`,
];

interface PersonRow {
  account_id: string;
  display_name: string;
  username: string | null;
  about: string;
  photo: string | null;
  version: number;
  nickname: string | null;
  blocked: number;
}

const toPerson = (r: PersonRow): Person => ({
  accountId: r.account_id,
  displayName: r.display_name,
  username: r.username,
  about: r.about,
  photo: r.photo,
  version: r.version,
  nickname: r.nickname,
  blocked: r.blocked === 1,
});

interface ConversationRow {
  id: string;
  peer_account_id: string;
  title: string;
  username: string | null;
  last_text: string | null;
  last_at: number;
  unread: number;
  kind: "direct" | "group";
  members: string;
  version: number;
  left_group: number;
  rejoining: number;
  pinned: number;
  timer: number;
  draft: string | null;
  accepted: number;
  archived: number;
  muted_until: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_account_id: string;
  outgoing: number;
  text: string;
  sent_at: number;
  status: MessageStatus;
  reply_to: string | null;
  edited_at: number | null;
  deleted: number;
  reactions: string;
  attachment: string | null;
  event: string | null;
  location: string | null;
  forwarded: number;
  expires_at: number | null;
}

interface OutboxRow {
  id: string;
  created_at: number;
  kind: OutboxItem["kind"];
  recipients: string;
  payload: string;
  message_id: string | null;
  wake: "message" | "call" | null;
  chat: string | null;
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  peerAccountId: r.peer_account_id,
  title: r.title,
  username: r.username,
  lastText: r.last_text,
  lastAt: r.last_at,
  unread: r.unread,
  kind: r.kind === "group" ? "group" : "direct",
  members: parseMembers(r.members),
  version: r.version,
  left: r.left_group === 1,
  rejoining: r.rejoining === 1,
  pinned: r.pinned === 1,
  timer: r.timer ?? 0,
  draft: r.draft,
  accepted: r.accepted !== 0,
  archived: r.archived === 1,
  mutedUntil: r.muted_until || 0,
});

function parseMembers(json: string): GroupMember[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as GroupMember[]) : [];
  } catch {
    return [];
  }
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  senderAccountId: r.sender_account_id,
  outgoing: r.outgoing === 1,
  text: r.text,
  sentAt: r.sent_at,
  status: r.status,
  replyTo: r.reply_to,
  editedAt: r.edited_at,
  deleted: r.deleted === 1,
  reactions: parseReactions(r.reactions),
  attachment: parseAttachment(r.attachment),
  event: r.event ? (JSON.parse(r.event) as ChatEvent) : null,
  location: r.location ? (JSON.parse(r.location) as GeoPoint) : null,
  forwarded: r.forwarded === 1,
  expiresAt: r.expires_at,
});

function parseAttachment(json: string | null): Attachment | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Attachment;
  } catch {
    return null;
  }
}

function parseReactions(json: string): Record<string, string> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const RANK_SQL = `CASE status ${Object.entries(STATUS_RANK)
  .map(([status, rank]) => `WHEN '${status}' THEN ${rank}`)
  .join(" ")} ELSE 0 END`;

/**
 * Chats on the phone, in the app's private SQLite database (one file per
 * device id). Message text is stored only here, never on the server.
 */
export class SqliteStore implements MessageStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name: string): Promise<SqliteStore> {
    const db = await SQLite.openDatabaseAsync(name);
    const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
    const fresh = !(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'"));
    await db.execAsync(SCHEMA);
    if (!fresh) {
      for (let i = version; i < UPGRADES.length; i++) await db.execAsync(UPGRADES[i]!);
    }
    // Indexes on columns that older databases get from UPGRADES, so only after them.
    await db.execAsync("CREATE INDEX IF NOT EXISTS messages_expiry ON messages (expires_at) WHERE expires_at IS NOT NULL;");
    await db.execAsync(`PRAGMA user_version = ${UPGRADES.length}`);
    return new SqliteStore(db);
  }

  async conversations() {
    const rows = await this.db.getAllAsync<ConversationRow>("SELECT * FROM conversations ORDER BY pinned DESC, last_at DESC");
    return rows.map(toConversation);
  }

  async conversation(id: string) {
    const row = await this.db.getFirstAsync<ConversationRow>("SELECT * FROM conversations WHERE id = ?", [id]);
    return row ? toConversation(row) : null;
  }

  async conversationWith(peerAccountId: string) {
    const row = await this.db.getFirstAsync<ConversationRow>(
      "SELECT * FROM conversations WHERE kind = 'direct' AND peer_account_id = ? ORDER BY last_at DESC LIMIT 1",
      [peerAccountId],
    );
    return row ? toConversation(row) : null;
  }

  async saveConversation(c: Conversation) {
    await this.db.runAsync(
      `INSERT INTO conversations (id, peer_account_id, title, username, last_text, last_at, unread, kind, members, version, left_group, rejoining, pinned, timer, draft, accepted, archived, muted_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET peer_account_id = excluded.peer_account_id, title = excluded.title,
         username = excluded.username, last_text = excluded.last_text, last_at = excluded.last_at, unread = excluded.unread,
         kind = excluded.kind, members = excluded.members, version = excluded.version, left_group = excluded.left_group,
         rejoining = excluded.rejoining, pinned = excluded.pinned, timer = excluded.timer, draft = excluded.draft, accepted = excluded.accepted,
         archived = excluded.archived, muted_until = excluded.muted_until`,
      [c.id, c.peerAccountId, c.title, c.username, c.lastText, c.lastAt, c.unread, c.kind, JSON.stringify(c.members), c.version, c.left ? 1 : 0, c.rejoining ? 1 : 0, c.pinned ? 1 : 0, c.timer ?? 0, c.draft ?? null, c.accepted === false ? 0 : 1, c.archived ? 1 : 0, c.mutedUntil ?? 0],
    );
  }

  async messages(conversationId: string, limit = 200) {
    const rows = await this.db.getAllAsync<MessageRow>(
      "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT ?) ORDER BY sent_at ASC",
      [conversationId, limit],
    );
    return rows.map(toMessage);
  }

  async message(id: string) {
    const row = await this.db.getFirstAsync<MessageRow>("SELECT * FROM messages WHERE id = ?", [id]);
    return row ? toMessage(row) : null;
  }

  async addMessage(m: Message) {
    const result = await this.db.runAsync(
      `INSERT OR IGNORE INTO messages (id, conversation_id, sender_account_id, outgoing, text, sent_at, status, reply_to, edited_at, deleted, reactions, attachment, event, location, forwarded, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id,
        m.conversationId,
        m.senderAccountId,
        m.outgoing ? 1 : 0,
        m.text,
        m.sentAt,
        m.status,
        m.replyTo,
        m.editedAt,
        m.deleted ? 1 : 0,
        JSON.stringify(m.reactions),
        m.attachment ? JSON.stringify(m.attachment) : null,
        m.event ? JSON.stringify(m.event) : null,
        m.location ? JSON.stringify(m.location) : null,
        m.forwarded ? 1 : 0,
        m.expiresAt ?? null,
      ],
    );
    return result.changes > 0;
  }

  async setStatus(messageId: string, status: MessageStatus) {
    await this.db.runAsync(`UPDATE messages SET status = ? WHERE id = ? AND (? = 'failed' OR ${RANK_SQL} < ?)`, [
      status,
      messageId,
      status,
      STATUS_RANK[status],
    ]);
  }

  async updateMessage(m: Message) {
    await this.db.runAsync(
      "UPDATE messages SET text = ?, status = ?, reply_to = ?, edited_at = ?, deleted = ?, reactions = ?, attachment = ? WHERE id = ?",
      [m.text, m.status, m.replyTo, m.editedAt, m.deleted ? 1 : 0, JSON.stringify(m.reactions), m.attachment ? JSON.stringify(m.attachment) : null, m.id],
    );
  }

  async removeMessage(id: string) {
    await this.db.runAsync("DELETE FROM messages WHERE id = ?", [id]);
  }

  async pendingUploads() {
    const rows = await this.db.getAllAsync<MessageRow>(
      "SELECT * FROM messages WHERE outgoing = 1 AND json_extract(attachment, '$.state') = 'uploading' ORDER BY sent_at ASC",
    );
    return rows.map(toMessage);
  }

  async unreadIncoming(conversationId: string) {
    const rows = await this.db.getAllAsync<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = ? AND outgoing = 0 AND status = 'received' ORDER BY sent_at ASC",
      [conversationId],
    );
    return rows.map(toMessage);
  }

  async markRead(conversationId: string) {
    await this.db.runAsync("UPDATE conversations SET unread = 0 WHERE id = ?", [conversationId]);
  }

  async expired(now: number) {
    const rows = await this.db.getAllAsync<MessageRow>("SELECT * FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?", [now]);
    return rows.map(toMessage);
  }

  async people() {
    return (await this.db.getAllAsync<PersonRow>("SELECT * FROM people")).map(toPerson);
  }

  async person(accountId: string) {
    const row = await this.db.getFirstAsync<PersonRow>("SELECT * FROM people WHERE account_id = ?", [accountId]);
    return row ? toPerson(row) : null;
  }

  async savePerson(p: Person) {
    await this.db.runAsync(
      `INSERT INTO people (account_id, display_name, username, about, photo, version, nickname, blocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name, username = excluded.username, about = excluded.about,
         photo = excluded.photo, version = excluded.version, nickname = excluded.nickname, blocked = excluded.blocked`,
      [p.accountId, p.displayName, p.username, p.about, p.photo, p.version, p.nickname, p.blocked ? 1 : 0],
    );
  }

  async enqueue(item: OutboxItem) {
    await this.db.runAsync(
      "INSERT OR REPLACE INTO outbox (id, created_at, kind, recipients, payload, message_id, wake, chat) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [item.id, item.createdAt, item.kind, JSON.stringify(item.recipients), item.payload, item.messageId, item.wake ?? null, item.chat ?? null],
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
      wake: r.wake,
      chat: r.chat,
    }));
  }

  async dequeue(id: string) {
    await this.db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
  }

  async clear() {
    await this.db.execAsync("DELETE FROM outbox; DELETE FROM messages; DELETE FROM conversations; DELETE FROM people;");
  }
}
