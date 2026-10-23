import websocket from "@fastify/websocket";
import { MAX_FRAME_BYTES, MESSAGE_RETENTION_DAYS, PROTOCOL_VERSION } from "@leks/protocol";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type pg from "pg";
import { Hub, noPush, type PushNotifier } from "./hub.js";
import { accountRoutes } from "./routes/accounts.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { Store } from "./store.js";

export interface AppOptions {
  pool: pg.Pool;
  logger?: FastifyServerOptions["logger"];
  push?: PushNotifier;
  /** How often expired messages are deleted; 0 turns the job off (tests). */
  purgeIntervalMs?: number;
}

export interface App extends FastifyInstance {
  hub: Hub;
  store: Store;
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

  if (purgeIntervalMs > 0) {
    const timer = setInterval(() => {
      store
        .purgeExpired(MESSAGE_RETENTION_DAYS)
        .then((count) => count > 0 && app.log.info({ count }, "expired messages deleted"))
        .catch((err: unknown) => app.log.error({ err }, "purge failed"));
    }, purgeIntervalMs);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  return app as unknown as App;
}
