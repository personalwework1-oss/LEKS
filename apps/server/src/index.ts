import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { FcmNotifier, parseServiceAccount } from "./push/fcm.js";
import type { Store } from "./store.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool);

// The notifier needs the store, which the app creates; it is attached right after.
const account = config.FCM_SERVICE_ACCOUNT ? parseServiceAccount(config.FCM_SERVICE_ACCOUNT) : null;
const made: { notifier: FcmNotifier | null } = { notifier: null };
const pushFor = account ? (store: Store) => (made.notifier = new FcmNotifier(store, account)) : undefined;
const calls =
  config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET
    ? { url: config.LIVEKIT_URL, apiKey: config.LIVEKIT_API_KEY, apiSecret: config.LIVEKIT_API_SECRET }
    : null;
const app = await buildApp({ pool, logger: { level: config.LOG_LEVEL }, blobDir: config.BLOB_DIR, calls, push: pushFor });
app.pushStatus = account ? "checking" : "off";
if (made.notifier) {
  made.notifier
    .check()
    .then(() => {
      app.pushStatus = "on";
      app.log.info({ project: account?.project_id }, "Android push is on");
    })
    .catch((err: unknown) => {
      app.pushStatus = "key_rejected";
      app.log.error({ err }, "Android push: Firebase rejected the key");
    });
}
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
