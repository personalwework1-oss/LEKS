import { MAX_KEY_PACKAGES, type MessageKind, type PushProvider } from "@leks/protocol";
import type pg from "pg";

export class ConflictError extends Error {
  constructor(readonly field: "username" | "device_key") {
    super(`${field} already in use`);
  }
}

export class LimitError extends Error {}

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

  // ---- push --------------------------------------------------------------

  async registerPush(deviceId: string, provider: PushProvider, token: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_tokens (device_id, provider, token) VALUES ($1, $2, $3)
       ON CONFLICT (device_id) DO UPDATE SET provider = EXCLUDED.provider, token = EXCLUDED.token, updated_at = now()`,
      [deviceId, provider, token],
    );
  }

  async pushToken(deviceId: string): Promise<{ provider: PushProvider; token: string } | null> {
    const { rows } = await this.pool.query<{ provider: PushProvider; token: string }>(
      "SELECT provider, token FROM push_tokens WHERE device_id = $1",
      [deviceId],
    );
    return rows[0] ?? null;
  }
}
