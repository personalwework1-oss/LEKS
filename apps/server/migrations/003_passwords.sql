-- Signing in on a new device uses a password (Argon2id hash). The backup
-- code becomes optional, and failed sign-ins are counted per account.
ALTER TABLE accounts
  ADD COLUMN password_hash text,
  ADD COLUMN login_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN login_locked_until timestamptz,
  ALTER COLUMN recovery_hash DROP NOT NULL;

-- No account exists without a password from now on.
UPDATE accounts SET password_hash = '!' WHERE password_hash IS NULL;
ALTER TABLE accounts ALTER COLUMN password_hash SET NOT NULL;
