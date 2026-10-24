-- Encrypted photos and files. The server stores only ciphertext on disk and
-- this bookkeeping; the keys travel inside end-to-end encrypted messages.
CREATE TABLE blobs (
  id                  uuid PRIMARY KEY,
  uploader_device_id  uuid NOT NULL,
  size                bigint NOT NULL CHECK (size > 0),
  -- SHA-256 of the one-time upload token; cleared once the file is uploaded.
  token_hash          bytea,
  token_expires_at    timestamptz,
  uploaded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blobs_uploader_created_idx ON blobs (uploader_device_id, created_at);
CREATE INDEX blobs_created_idx ON blobs (created_at);
