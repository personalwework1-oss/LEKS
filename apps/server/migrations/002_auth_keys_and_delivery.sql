-- Devices sign in with a dedicated Ed25519 key, separate from their MLS keys.
ALTER TABLE devices RENAME COLUMN signature_public_key TO auth_public_key;
ALTER INDEX devices_signature_public_key_key RENAME TO devices_auth_public_key_key;

-- Account recovery: only a slow hash of the code is stored, plus a counter
-- that locks recovery after repeated wrong codes.
ALTER TABLE accounts
  ADD COLUMN recovery_hash text NOT NULL,
  ADD COLUMN recovery_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN recovery_locked_until timestamptz;

-- One-time MLS key packages a device publishes so others can start chats
-- with it while it is offline.
CREATE TABLE key_packages (
  id          bigserial PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX key_packages_device_id_idx ON key_packages (device_id, id);

-- Encrypted messages waiting for a device. A row is deleted as soon as the
-- device confirms it has stored the message, or after 30 days.
CREATE TABLE message_queue (
  id                   bigserial PRIMARY KEY,
  recipient_device_id  uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  sender_account_id    uuid NOT NULL,
  sender_device_id     uuid NOT NULL,
  client_message_id    uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('welcome', 'commit', 'message')),
  payload              bytea NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_queue_recipient_idx ON message_queue (recipient_device_id, id);
CREATE INDEX message_queue_created_at_idx ON message_queue (created_at);
-- Resending the same message is harmless: it is stored once per recipient.
CREATE UNIQUE INDEX message_queue_dedup_key
  ON message_queue (recipient_device_id, sender_device_id, client_message_id);

-- Where to send the "you have new messages" signal. The signal never carries
-- message content.
CREATE TABLE push_tokens (
  device_id   uuid PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('apns', 'fcm')),
  token       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
