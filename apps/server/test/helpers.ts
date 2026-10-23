import type pg from "pg";
import { createPool, migrate } from "../src/db.js";

/** Tests that need PostgreSQL run only when DATABASE_URL is set (always in CI). */
export const databaseUrl = process.env.DATABASE_URL;

export async function freshDatabase(): Promise<pg.Pool> {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const pool = createPool(databaseUrl);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  return pool;
}
