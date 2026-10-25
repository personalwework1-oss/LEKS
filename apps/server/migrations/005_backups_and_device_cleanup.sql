-- One encrypted backup of the chats per account. The server keeps the
-- encrypted file and the backup key wrapped with a key only the user's
-- password gives (derived on the phone; the server never sees either).
CREATE TABLE backups (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  blob_id      uuid NOT NULL,
  wrapped_key  text NOT NULL,
  size         bigint NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The current backup file is kept until it is replaced, not deleted after 30 days.
ALTER TABLE blobs ADD COLUMN kept boolean NOT NULL DEFAULT false;
