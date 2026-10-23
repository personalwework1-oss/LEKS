import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Folder with numbered SQL migrations, next to both src/ and dist/. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Arbitrary constant so only one server instance runs migrations at a time. */
const MIGRATION_LOCK_ID = 727_274;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
}

/**
 * Applies every migration in `dir` that has not run yet, in file-name order,
 * each in its own transaction. Safe to call from several servers at once.
 * Returns the names of the migrations it applied.
 */
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((row) => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = await readFile(join(dir, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
