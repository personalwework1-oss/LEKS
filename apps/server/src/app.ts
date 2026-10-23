import websocket from "@fastify/websocket";
import {
  ClientFrame,
  CloseCode,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  type ServerFrame,
} from "@leks/protocol";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type pg from "pg";
import type { RawData } from "ws";

export interface AppOptions {
  pool: pg.Pool;
  logger?: FastifyServerOptions["logger"];
}

/**
 * Builds the HTTP and WebSocket server without starting it, so tests can
 * drive it in-process.
 *
 * Privacy: request logs carry only the method and path. IP addresses,
 * headers and bodies are never logged.
 */
export async function buildApp({ pool, logger = false }: AppOptions): Promise<FastifyInstance> {
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
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  await app.register(websocket, { options: { maxPayload: MAX_FRAME_BYTES } });

  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", database: "ok", protocol: PROTOCOL_VERSION };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "unavailable", protocol: PROTOCOL_VERSION });
    }
  });

  app.get("/v1/ws", { websocket: true }, (socket) => {
    let greeted = false;
    const send = (frame: ServerFrame) => socket.send(JSON.stringify(frame));

    socket.on("message", (raw: RawData) => {
      let data: unknown;
      try {
        const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        data = JSON.parse(bytes.toString("utf8"));
      } catch {
        send({ type: "error", code: "bad_json" });
        return;
      }
      const parsed = ClientFrame.safeParse(data);
      if (!parsed.success) {
        send({ type: "error", code: "bad_frame" });
        return;
      }
      const frame = parsed.data;

      if (frame.type === "hello") {
        if (frame.protocol !== PROTOCOL_VERSION) {
          send({ type: "error", code: "unsupported_protocol" });
          socket.close(CloseCode.UnsupportedProtocol, "unsupported protocol");
          return;
        }
        greeted = true;
        send({ type: "welcome", protocol: PROTOCOL_VERSION, serverTime: Date.now() });
        return;
      }

      if (!greeted) {
        send({ type: "error", code: "hello_required" });
        return;
      }

      switch (frame.type) {
        case "ping":
          send({ type: "pong", nonce: frame.nonce });
          return;
      }
    });
  });

  return app;
}
