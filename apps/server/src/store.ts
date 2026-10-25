import { MAX_KEY_PACKAGES, type MessageKind, type PushProvider } from "@leks/protocol";
import type pg from "pg";

export class ConflictError extends Error {
  constructor(readonly field: "username" | "device_key") {
    super(`${field} already in use`);
  }
}

export class LimitError extends Error {}

export interface BlobRecord {
  id: string;
  size: number;
  tokenHash: Buffer | null;
  tokenExpiresAt: Date | null;
  uploadedAt: Date | null;
}

export interface NewDeviceRecord {
  platform: "ios" | "android";
  authPublicKey: Buffer;
}

export interface QueuedMessage {
  id: number;
  senderAccountId: string;
  senderDeviceId: string;
  kind: MessageKind;
  payload: Buffer;
  createdAt: Date;
}

const UNIQUE_VIOLATION = "23505";

function conflictFrom(error: unknown): ConflictError | undefined {
  const e = error as { code?: string; constraint?: string };
  if (e.code !== UNIQUE_VIOLATION) return undefined;
  if (e.constraint === "accounts_username_key") return new ConflictError("username");
  if (e.constraint === "devices_auth_public_key_key") return new ConflictError("device_key");
  return undefined;
}

/** All database access of the server. Every method is one short transaction or query. */
export class Store {
  constructor(private readonly pool: pg.Pool) {}

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw conflictFrom(error) ?? error;
    } finally {
      client.release();
    }
  }

  // ---- accounts --------------------------------------------------------

  async createAccount(input: {
    username: string;
    displayName: string;
    passwordHash: string;
    recoveryHash: string | null;
    device: NewDeviceRecord;
  }): Promise<{ accountId: string; deviceId: string }> {
    return this.transaction(async (client) => {
      const account = await client.query<{ id: string }>(
        `INSERT INTO accounts (username, display_name, password_hash, recovery_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [input.username, input.displayName, input.passwordHash, input.recoveryHash],
      );
      const accountId = account.rows[0]!.id;
      const deviceId = await this.insertDevice(client, accountId, input.device);
      return { accountId, deviceId };
    });
  }

  private async insertDevice(client: pg.PoolClient, accountId: string, device: NewDeviceRecord): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO devices (account_id, auth_public_key, platform) VALUES ($1, $2, $3) RETURNING id",
      [accountId, device.authPublicKey, device.platform],
    );
    return rows[0]!.id;
  }

  /** Adds a device to an account (sign-in on a new phone); other devices stay. */
  async addDevice(accountId: string, device: NewDeviceRecord): Promise<string> {
    return this.transaction((client) => this.insertDevice(client, accountId, device));
  }

  async usernameTaken(username: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("SELECT 1 FROM accounts WHERE username = $1", [username]);
    return (rowCount ?? 0) > 0;
  }

  async lookupUser(username: string): Promise<{ accountId: string; username: string; displayName: string } | null> {
    const { rows } = await this.pool.query<{ id: string; username: string; display_name: string }>(
      "SELECT id, username, display_name FROM accounts WHERE username = $1",
      [username],
    );
    const row = rows[0];
    return row ? { accountId: row.id, username: row.username, displayName: row.display_name } : null;
  }

  /** What sign-in and recovery need to know about an account. */
  async credentials(where: { username: string } | { accountId: string }): Promise<{
    id: string;
    username: string;
    displayName: string;
    passwordHash: string;
    recoveryHash: string | null;
    loginLockedUntil: Date | null;
    recoveryLockedUntil: Date | null;
  } | null> {
    const [column, value] = "username" in where ? ["username", where.username] : ["id", where.accountId];
    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      display_name: string;
      password_hash: string;
      recovery_hash: string | null;
      login_locked_until: Date | null;
      recovery_locked_until: Date | null;
    }>(
      `SELECT id, username, display_name, password_hash, recovery_hash, login_locked_until, recovery_locked_until
         FROM accounts WHERE ${column} = $1`,
      [value],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          recoveryHash: row.recovery_hash,
          loginLockedUntil: row.login_locked_until,
          recoveryLockedUntil: row.recovery_locked_until,
        }
      : null;
  }

  /**
   * Counts a failed attempt of `kind`; after `maxFailures` in a row, locks
   * that kind of attempt for `lockMinutes`.
   */
  async recordFailure(kind: "login" | "recovery", accountId: string, maxFailures: number, lockMinutes: number): Promise<void> {
    const failures = `${kind}_failures`;
    const lockedUntil = `${kind}_locked_until`;
    await this.pool.query(
      `UPDATE accounts
          SET ${failures} = CASE WHEN ${failures} + 1 >= $2 THEN 0 ELSE ${failures} + 1 END,
              ${lockedUntil} = CASE WHEN ${failures} + 1 >= $2
                                    THEN now() + make_interval(mins => $3) ELSE ${lockedUntil} END
        WHERE id = $1`,
      [accountId, maxFailures, lockMinutes],
    );
  }

  async clearLoginFailures(accountId: string): Promise<void> {
    await this.pool.query("UPDATE accounts SET login_failures = 0, login_locked_until = NULL WHERE id = $1", [accountId]);
  }

  async setPasswordHash(accountId: string, passwordHash: string): Promise<void> {
    await this.pool.query("UPDATE accounts SET password_hash = $2 WHERE id = $1", [accountId, passwordHash]);
  }

  /** Stores a new backup code hash, or removes the code with null. */
  async setRecoveryHash(accountId: string, recoveryHash: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE accounts SET recovery_hash = $2, recovery_failures = 0, recovery_locked_until = NULL WHERE id = $1",
      [accountId, recoveryHash],
    );
  }

  /**
   * Recovery with the backup code: removes every existing device (with its
   * queued messages and key packages), adds the new device, sets the new
   * password and uses up the code. Returns the new device id and the
   * removed ones.
   */
  async recoverAccount(
    accountId: string,
    device: NewDeviceRecord,
    passwordHash: string,
  ): Promise<{ deviceId: string; removed: string[] }> {
    return this.transaction(async (client) => {
      const removed = await client.query<{ id: string }>("DELETE FROM devices WHERE account_id = $1 RETURNING id", [
        accountId,
      ]);
      await client.query(
        `UPDATE accounts
            SET password_hash = $2, recovery_hash = NULL,
                recovery_failures = 0, recovery_locked_until = NULL,
                login_failures = 0, login_locked_until = NULL
          WHERE id = $1`,
        [accountId, passwordHash],
      );
      const deviceId = await this.insertDevice(client, accountId, device);
      return { deviceId, removed: removed.rows.map((row) => row.id) };
    });
  }

  // ---- devices ---------------------------------------------------------

  async device(deviceId: string): Promise<{ accountId: string; authPublicKey: Buffer } | null> {
    const { rows } = await this.pool.query<{ account_id: string; auth_public_key: Buffer }>(
      "SELECT account_id, auth_public_key FROM devices WHERE id = $1",
      [deviceId],
    );
    const row = rows[0];
    return row ? { accountId: row.account_id, authPublicKey: row.auth_public_key } : null;
  }

  async touchDevice(deviceId: string): Promise<void> {
    await this.pool.query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [deviceId]);
  }

  // ---- key packages ----------------------------------------------------

  async countKeyPackages(deviceId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM key_packages WHERE device_id = $1",
      [deviceId],
    );
    return Number(rows[0]!.count);
  }

  /** Stores key packages; the device may keep at most MAX_KEY_PACKAGES. Returns how many are available. */
  async publishKeyPackages(deviceId: string, packages: Buffer[]): Promise<number> {
    return this.transaction(async (client) => {
      // Serialize publishes of the same device so the limit holds.
      await client.query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE", [deviceId]);
      const { rows } = await client.query<{ count: string }>(
        "SELECT count(*) FROM key_packages WHERE device_id = $1",
        [deviceId],
      );
      const existing = Number(rows[0]!.count);
      if (existing + packages.length > MAX_KEY_PACKAGES) throw new LimitError("too many key packages");
      await client.query(
        "INSERT INTO key_packages (device_id, data) SELECT $1, unnest($2::bytea[])",
        [deviceId, packages],
      );
      return existing + packages.length;
    });
  }

  /** Takes, and deletes, the oldest key package of each device of the account. */
  async claimKeyPackages(accountId: string): Promise<{ deviceId: string; data: Buffer }[]> {
    const { rows } = await this.pool.query<{ device_id: string; data: Buffer }>(
      `DELETE FROM key_packages k
        USING (SELECT p.id
                 FROM devices d
                 CROSS JOIN LATERAL (SELECT id FROM key_packages
                                      WHERE device_id = d.id
                                      ORDER BY id LIMIT 1
                                      FOR UPDATE SKIP LOCKED) p
                WHERE d.account_id = $1) picked
        WHERE k.id = picked.id
        RETURNING k.device_id, k.data`,
      [accountId],
    );
    return rows.map((row) => ({ deviceId: row.device_id, data: row.data }));
  }

  // ---- message queue ---------------------------------------------------

  /**
   * Queues one copy of the message for each known recipient device.
   * Returns which recipients exist and the queue rows that were newly
   * created (a resend creates none).
   */
  async enqueue(input: {
    senderAccountId: string;
    senderDeviceId: string;
    clientMessageId: string;
    recipients: string[];
    kind: MessageKind;
    payload: Buffer;
  }): Promise<{ accepted: string[]; unknown: string[]; created: { id: number; recipientDeviceId: string }[] }> {
    const recipients = [...new Set(input.recipients)];
    const known = await this.pool.query<{ id: string }>("SELECT id FROM devices WHERE id = ANY($1::uuid[])", [
      recipients,
    ]);
    const accepted = known.rows.map((row) => row.id);
    const acceptedSet = new Set(accepted);
    const unknown = recipients.filter((id) => !acceptedSet.has(id));
    if (accepted.length === 0) return { accepted, unknown, created: [] };

    const { rows } = await this.pool.query<{ id: string; recipient_device_id: string }>(
      `INSERT INTO message_queue
              (recipient_device_id, sender_account_id, sender_device_id, client_message_id, kind, payload)
       SELECT r, $2, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS r
       ON CONFLICT (recipient_device_id, sender_device_id, client_message_id) DO NOTHING
       RETURNING id, recipient_device_id`,
      [accepted, input.senderAccountId, input.senderDeviceId, input.clientMessageId, input.kind, input.payload],
    );
    return {
      accepted,
      unknown,
      created: rows.map((row) => ({ id: Number(row.id), recipientDeviceId: row.recipient_device_id })),
    };
  }

  /** Messages waiting for the device with a queue id above `afterId`, oldest first. */
  async pending(deviceId: string, afterId: number, limit: number): Promise<QueuedMessage[]> {
    const { rows } = await this.pool.query<{
      id: string;
      sender_account_id: string;
      sender_device_id: string;
      kind: MessageKind;
      payload: Buffer;
      created_at: Date;
    }>(
      `SELECT id, sender_account_id, sender_device_id, kind, payload, created_at
         FROM message_queue
        WHERE recipient_device_id = $1 AND id > $2
        ORDER BY id
        LIMIT $3`,
      [deviceId, afterId, limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      senderAccountId: row.sender_account_id,
      senderDeviceId: row.sender_device_id,
      kind: row.kind,
      payload: row.payload,
      createdAt: row.created_at,
    }));
  }

  /** Deletes messages the device confirmed. Ids of other devices are ignored. */
  async ack(deviceId: string, ids: number[]): Promise<number> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM message_queue WHERE recipient_device_id = $1 AND id = ANY($2::bigint[])",
      [deviceId, ids],
    );
    return rowCount ?? 0;
  }

  async purgeExpired(retentionDays: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM message_queue WHERE created_at < now() - make_interval(days => $1)",
      [retentionDays],
    );
    return rowCount ?? 0;
  }

  // ---- encrypted files -----------------------------------------------------

  /** Reserves an upload; throws LimitError if the device's daily allowance would be exceeded. */
  async createBlob(input: { id: string; deviceId: string; size: number; tokenHash: Buffer; dailyLimit: number }): Promise<void> {
    await this.transaction(async (client) => {
      // One reservation at a time per device keeps the allowance check honest.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.deviceId]);
      const { rows } = await client.query<{ total: string }>(
        "SELECT COALESCE(SUM(size), 0) AS total FROM blobs WHERE uploader_device_id = $1 AND created_at > now() - interval '1 day'",
        [input.deviceId],
      );
      if (Number(rows[0]!.total) + input.size > input.dailyLimit) throw new LimitError("daily upload allowance");
      await client.query(
        `INSERT INTO blobs (id, uploader_device_id, size, token_hash, token_expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 hour')`,
        [input.id, input.deviceId, input.size, input.tokenHash],
      );
    });
  }

  async blob(id: string): Promise<BlobRecord | null> {
    const { rows } = await this.pool.query<{
      id: string;
      size: string;
      token_hash: Buffer | null;
      token_expires_at: Date | null;
      uploaded_at: Date | null;
    }>("SELECT id, size, token_hash, token_expires_at, uploaded_at FROM blobs WHERE id = $1", [id]);
    const row = rows[0];
    return row
      ? { id: row.id, size: Number(row.size), tokenHash: row.token_hash, tokenExpiresAt: row.token_expires_at, uploadedAt: row.uploaded_at }
      : null;
  }

  /** Marks the upload done and burns the token; false if it was already used. */
  async completeBlob(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "UPDATE blobs SET uploaded_at = now(), token_hash = NULL, token_expires_at = NULL WHERE id = $1 AND uploaded_at IS NULL",
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Forgets old files and unfinished uploads (never a current backup); returns their ids so the files can be removed. */
  async purgeBlobs(retentionDays: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `DELETE FROM blobs
       WHERE NOT kept AND (created_at < now() - make_interval(days => $1)
          OR (uploaded_at IS NULL AND token_expires_at < now() - interval '1 hour'))
       RETURNING id`,
      [retentionDays],
    );
    return rows.map((row) => row.id);
  }

  // ---- devices and backups ---------------------------------------------

  async listDevices(accountId: string): Promise<{ deviceId: string; platform: string; lastSeenAt: number | null }[]> {
    const { rows } = await this.pool.query<{ id: string; platform: string; last_seen_at: Date | null }>(
      "SELECT id, platform, last_seen_at FROM devices WHERE account_id = $1 ORDER BY created_at",
      [accountId],
    );
    return rows.map((r) => ({ deviceId: r.id, platform: r.platform, lastSeenAt: r.last_seen_at ? r.last_seen_at.getTime() : null }));
  }

  /** Deletes a device of the account (with its queue, keys and push address); false if it is not theirs. */
  async removeDevice(accountId: string, deviceId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM devices WHERE id = $1 AND account_id = $2", [deviceId, accountId]);
    return (rowCount ?? 0) > 0;
  }

  /** Deletes devices not seen for this many days; returns their ids. */
  async purgeDevices(retentionDays: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `DELETE FROM devices WHERE COALESCE(last_seen_at, created_at) < now() - make_interval(days => $1) RETURNING id`,
      [retentionDays],
    );
    return rows.map((r) => r.id);
  }

  /** Makes an uploaded blob the account's backup; the previous one is released for deletion. False if the blob is not usable. */
  async setBackup(accountId: string, deviceId: string, blobId: string, wrappedKey: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const blob = await client.query<{ size: string }>(
        "SELECT size FROM blobs WHERE id = $1 AND uploader_device_id = $2 AND uploaded_at IS NOT NULL",
        [blobId, deviceId],
      );
      if (blob.rows.length === 0) return false;
      const previous = await client.query<{ blob_id: string }>("SELECT blob_id FROM backups WHERE account_id = $1", [accountId]);
      const old = previous.rows[0]?.blob_id;
      if (old && old !== blobId) {
        // Released: deleted by the next clean-up.
        await client.query("UPDATE blobs SET kept = false, created_at = now() - interval '365 days' WHERE id = $1", [old]);
      }
      await client.query("UPDATE blobs SET kept = true WHERE id = $1", [blobId]);
      await client.query(
        `INSERT INTO backups (account_id, blob_id, wrapped_key, size) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id) DO UPDATE SET blob_id = EXCLUDED.blob_id, wrapped_key = EXCLUDED.wrapped_key, size = EXCLUDED.size, updated_at = now()`,
        [accountId, blobId, wrappedKey, Number(blob.rows[0]!.size)],
      );
      return true;
    });
  }

  async getBackup(accountId: string): Promise<{ blobId: string; wrappedKey: string; size: number; updatedAt: number } | null> {
    const { rows } = await this.pool.query<{ blob_id: string; wrapped_key: string; size: string; updated_at: Date }>(
      "SELECT blob_id, wrapped_key, size, updated_at FROM backups WHERE account_id = $1",
      [accountId],
    );
    const row = rows[0];
    return row ? { blobId: row.blob_id, wrappedKey: row.wrapped_key, size: Number(row.size), updatedAt: row.updated_at.getTime() } : null;
  }

  // ---- push --------------------------------------------------------------

  async registerPush(deviceId: string, provider: PushProvider, token: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_tokens (device_id, provider, token) VALUES ($1, $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET provider = EXCLUDED.provider, token = EXCLUDED.token, updated_at = now()`,
      [deviceId, provider, token],
    );
  }

  async deletePushToken(deviceId: string): Promise<void> {
    await this.pool.query("DELETE FROM push_tokens WHERE device_id = $1", [deviceId]);
  }

  async pushToken(deviceId: string): Promise<{ provider: PushProvider; token: string } | null> {
    const { rows } = await this.pool.query<{ provider: PushProvider; token: string }>(
      "SELECT provider, token FROM push_tokens WHERE device_id = $1",
      [deviceId],
    );
    return rows[0] ?? null;
  }
}
