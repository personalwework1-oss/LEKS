import websocket from "@fastify/websocket";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOB_RETENTION_DAYS, MAX_FRAME_BYTES, MESSAGE_RETENTION_DAYS, PROTOCOL_VERSION } from "@leks/protocol";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type pg from "pg";
import { BlobStorage } from "./blobs.js";
import { Hub, noPush, type PushNotifier } from "./hub.js";
import { accountRoutes } from "./routes/accounts.js";
import { blobRoutes } from "./routes/blobs.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { Store } from "./store.js";

export interface AppOptions {
  pool: pg.Pool;
  logger?: FastifyServerOptions["logger"];
  push?: PushNotifier;
  /** How often expired messages are deleted; 0 turns the job off (tests). */
  purgeIntervalMs?: number;
  /** Folder for encrypted files. */
  blobDir?: string;
}

export interface App extends FastifyInstance {
  hub: Hub;
  store: Store;
  blobs: BlobStorage;
}

/**
 * Builds the HTTP and WebSocket server without starting it, so tests can
 * drive it in-process.
 *
 * Privacy: request logs carry only the method and path. IP addresses,
 * headers and bodies are never logged.
 */
export async function buildApp({
  pool,
  logger = false,
  push = noPush,
  purgeIntervalMs = 60 * 60 * 1000,
  blobDir = join(tmpdir(), "leks-blobs"),
}: AppOptions): Promise<App> {
  const app = Fastify({
    logger:
      logger === false
        ? false
        : {
            ...(typeof logger === "object" ? logger : {}),
            serializers: {
              req: (req) => ({ method: req.method, url: req.url }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
    bodyLimit: 64 * 1024,
    trustProxy: false,
  });

  const store = new Store(pool);
  const hub = new Hub(store, push, app.log);
  app.decorate("store", store);
  app.decorate("hub", hub);
  const blobs = new BlobStorage(blobDir);
  app.decorate("blobs", blobs);

  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", database: "ok", protocol: PROTOCOL_VERSION };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "unavailable", protocol: PROTOCOL_VERSION });
    }
  });

  accountRoutes(app, store, hub);
  realtimeRoutes(app, store, hub);
  blobRoutes(app, store, blobs);

  if (purgeIntervalMs > 0) {
    const timer = setInterval(() => {
      store
        .purgeExpired(MESSAGE_RETENTION_DAYS)
        .then((count) => count > 0 && app.log.info({ count }, "expired messages deleted"))
        .catch((err: unknown) => app.log.error({ err }, "purge failed"));
      store
        .purgeBlobs(BLOB_RETENTION_DAYS)
        .then(async (ids) => {
          for (const id of ids) await blobs.remove(id);
          if (ids.length > 0) app.log.info({ count: ids.length }, "expired files deleted");
        })
        .catch((err: unknown) => app.log.error({ err }, "file purge failed"));
    }, purgeIntervalMs);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  return app as unknown as App;
}
