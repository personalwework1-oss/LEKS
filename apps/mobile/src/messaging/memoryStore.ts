import type { Conversation, Message, MessageStatus, MessageStore, OutboxItem } from "./types";

/** An in-memory store with the same behaviour as the SQLite one; used by tests. */
export class MemoryStore implements MessageStore {
  private readonly chats = new Map<string, Conversation>();
  private readonly msgs = new Map<string, Message>();
  private readonly queue = new Map<string, OutboxItem>();

  async conversations() {
    return [...this.chats.values()].sort((a, b) => b.lastAt - a.lastAt);
  }
  async conversation(id: string) {
    return this.chats.get(id) ?? null;
  }
  async conversationWith(peerAccountId: string) {
    return [...this.chats.values()].find((c) => c.peerAccountId === peerAccountId) ?? null;
  }
  async saveConversation(conversation: Conversation) {
    this.chats.set(conversation.id, { ...conversation });
  }
  async messages(conversationId: string, limit = 200) {
    return [...this.msgs.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.sentAt - b.sentAt)
      .slice(-limit);
  }
  async addMessage(message: Message) {
    if (this.msgs.has(message.id)) return false;
    this.msgs.set(message.id, { ...message });
    return true;
  }
  async setStatus(messageId: string, status: MessageStatus) {
    const message = this.msgs.get(messageId);
    if (message) message.status = status;
  }
  async markRead(conversationId: string) {
    const chat = this.chats.get(conversationId);
    if (chat) chat.unread = 0;
  }
  async enqueue(item: OutboxItem) {
    this.queue.set(item.id, { ...item });
  }
  async outbox() {
    return [...this.queue.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  async dequeue(id: string) {
    this.queue.delete(id);
  }
  async clear() {
    this.chats.clear();
    this.msgs.clear();
    this.queue.clear();
  }
}
