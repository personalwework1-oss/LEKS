-- Blocking: the server stops delivering a blocked person's messages (and
-- pushes), and refuses them new chats. Only who blocked whom is stored.
CREATE TABLE blocks (
  blocker_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

-- Reports. Chats are end-to-end encrypted, so the only content here is what
-- the reporter chose to attach from their own phone.
CREATE TABLE reports (
  id           bigserial PRIMARY KEY,
  reporter_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  reported_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  reason       text NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);
CREATE INDEX reports_reported ON reports (reported_id, created_at);

-- Who has started talking to whom (one row per pair, smaller id first), so
-- new chats can be limited per day and restricted accounts kept to people
-- they already know.
CREATE TABLE contacts (
  a           uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  b           uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  started_by  uuid NOT NULL,
  first_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a, b)
);
CREATE INDEX contacts_started ON contacts (started_by, first_at);

-- Set after several people report an account: until then it cannot start new chats.
ALTER TABLE accounts ADD COLUMN restricted_until timestamptz;
