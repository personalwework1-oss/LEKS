import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import {
  type AccountSession,
  authMessage,
  type ClientFrame,
  fromBase64url,
  PROTOCOL_VERSION,
  type ServerFrame,
} from "@leks/protocol";
import type pg from "pg";
import type WebSocket from "ws";
import type { App } from "../src/app.js";
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

/** A device's Ed25519 sign-in key, as the app would keep it. */
export class DeviceKey {
  private readonly privateKey: KeyObject;
  readonly publicKey: string;

  constructor() {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    // The last 32 bytes of the SPKI encoding are the raw public key.
    this.publicKey = pair.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  }

  sign(message: Uint8Array): string {
    return sign(null, message, this.privateKey).toString("base64url");
  }
}

let counter = 0;

export async function register(
  app: App,
  username = `user_${++counter}_${Date.now() % 100000}`,
): Promise<{ session: AccountSession; key: DeviceKey }> {
  const key = new DeviceKey();
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { username, displayName: username, device: { platform: "ios", authPublicKey: key.publicKey } },
  });
  if (response.statusCode !== 201) throw new Error(`registration failed: ${response.body}`);
  return { session: response.json() as AccountSession, key };
}

/** A WebSocket client that buffers frames so none are missed between awaits. */
export class TestClient {
  private readonly frames: ServerFrame[] = [];
  private waiters: (() => void)[] = [];
  closeCode: number | undefined;
  readonly closed: Promise<number>;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      this.frames.push(JSON.parse(raw.toString()) as ServerFrame);
      this.wake();
    });
    this.closed = new Promise((resolve) =>
      ws.once("close", (code) => {
        this.closeCode = code;
        this.wake();
        resolve(code);
      }),
    );
  }

  static async open(app: App): Promise<TestClient> {
    return new TestClient(await app.injectWS("/v1/ws"));
  }

  /** Opens a connection and signs in as the device. */
  static async signedIn(app: App, session: AccountSession, key: DeviceKey): Promise<TestClient> {
    const client = await TestClient.open(app);
    const challenge = await client.hello();
    client.send({ type: "auth", deviceId: session.deviceId, signature: key.sign(authMessage(challenge)) });
    await client.next("authenticated");
    return client;
  }

  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  send(frame: ClientFrame | Record<string, unknown>) {
    this.ws.send(JSON.stringify(frame));
  }

  sendRaw(text: string) {
    this.ws.send(text);
  }

  async hello(): Promise<Uint8Array> {
    this.send({ type: "hello", protocol: PROTOCOL_VERSION, client: { platform: "test", version: "0.0.0" } });
    const welcome = await this.next("welcome");
    return fromBase64url(welcome.challenge);
  }

  /** Waits for the next frame of `type`, skipping none: earlier frames of other types stay buffered. */
  async next<T extends ServerFrame["type"]>(type: T, timeoutMs = 3000): Promise<Extract<ServerFrame, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.frames.findIndex((frame) => frame.type === type);
      if (index >= 0) return this.frames.splice(index, 1)[0] as Extract<ServerFrame, { type: T }>;
      if (this.closeCode !== undefined) throw new Error(`connection closed (${this.closeCode}) while waiting for ${type}`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${type}; buffered: ${JSON.stringify(this.frames)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** True if a frame of `type` arrives within `ms`. */
  async receives(type: ServerFrame["type"], ms = 300): Promise<boolean> {
    try {
      await this.next(type, ms);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.ws.terminate();
  }
}

export function randomPayload(bytes = 64): string {
  return Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 31 + bytes) & 0xff)).toString("base64url");
}
