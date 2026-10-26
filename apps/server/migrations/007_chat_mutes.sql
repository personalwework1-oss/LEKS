-- Muted chats: no push for new messages until `until` (calls still ring).
-- The chat is known only by a tag (a hash), not by its id or members.
CREATE TABLE chat_mutes (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  chat_tag    text NOT NULL,
  until       timestamptz NOT NULL,
  PRIMARY KEY (account_id, chat_tag)
);
