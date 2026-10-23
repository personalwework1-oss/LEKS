-- Accounts are identified by a username; a phone number or email is optional
-- and stored only as a hash, for discovery by people the user allows.
CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  CONSTRAINT display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX accounts_username_key ON accounts (username);

-- Each phone or tablet is a device with its own signing key. The server
-- stores public keys only; private keys never leave the device.
CREATE TABLE devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  signature_public_key  bytea NOT NULL,
  platform              text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz
);
CREATE INDEX devices_account_id_idx ON devices (account_id);
CREATE UNIQUE INDEX devices_signature_public_key_key ON devices (signature_public_key);
