import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool);

const calls =
  config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
    ? { url: config.LIVEKIT_URL, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET }
    : null;
const app = await buildApp({ pool, logger: { level: config.LOG_LEVEL }, blobDir: config.BLOB_DIR, calls });
await app.listen({ host: config.HOST, port: config.PORT });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
