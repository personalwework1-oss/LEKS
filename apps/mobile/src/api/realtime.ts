import {
  type ClientFrame,
  CloseCode,
  type DeliveredMessage,
  fromBase64url,
  PROTOCOL_VERSION,
  ServerFrame,
} from "@leks/protocol";

export type ConnectionState = "offline" | "connecting" | "online" | "signed_out";

type RequestFrame = Extract<ClientFrame, { requestId: string }>;
type ResponseFrame = Extract<ServerFrame, { requestId: string }>;

export interface RealtimeOptions {
  url: string;
  deviceId: string;
  /** Signs the server's 32-byte challenge with this phone's device key. */
  sign: (challenge: Uint8Array) => string;
  platform: "ios" | "android" | "test";
  appVersion: string;
  /** Injected in tests; the global WebSocket in the app. */
  WebSocketImpl?: typeof WebSocket;
  onState?: (state: ConnectionState) => void;
  onMessages?: (messages: DeliveredMessage[]) => void;
}

/** Thrown when a request gets an `error` frame back. */
export class RealtimeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One WebSocket per phone: greets the server, signs in with the device key,
 * reconnects with backoff, and matches requests to their answers.
 */
export class Realtime {
  private ws: WebSocket | undefined;
  private state: ConnectionState = "offline";
  private stopped = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;
  private readonly pending = new Map<
    string,
    { resolve: (frame: ResponseFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly waitingForOnline: (() => void)[] = [];

  constructor(private readonly options: RealtimeOptions) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = undefined;
    this.setState("offline");
    this.failPending(new RealtimeError("offline"));
  }

  /** Sends a request and resolves with the matching answer once online. */
  async request<T extends ResponseFrame["type"]>(
    frame: Omit<RequestFrame, "requestId">,
    expect: T,
  ): Promise<Extract<ResponseFrame, { type: T }>> {
    await this.online();
    const requestId = `r${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new RealtimeError("timeout"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (answer) => {
          if (answer.type === expect) resolve(answer as Extract<ResponseFrame, { type: T }>);
          else reject(new RealtimeError(`unexpected ${answer.type}`));
        },
        reject,
        timer,
      });
      this.send({ ...frame, requestId } as ClientFrame);
    });
  }

  /** Confirms delivered messages were stored, so the server can delete them. */
  ack(ids: number[]): void {
    if (ids.length > 0 && this.state === "online") this.send({ type: "ack", ids });
  }

  private online(): Promise<void> {
    if (this.state === "online") return Promise.resolve();
    if (this.state === "signed_out") return Promise.reject(new RealtimeError("signed_out"));
    return new Promise((resolve) => this.waitingForOnline.push(resolve));
  }

  private send(frame: ClientFrame): void {
    this.ws?.send(JSON.stringify(frame));
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
    if (state === "online") {
      for (const wake of this.waitingForOnline.splice(0)) wake();
    }
  }

  private open(): void {
    const Impl = this.options.WebSocketImpl ?? WebSocket;
    this.setState("connecting");
    const ws = new Impl(this.options.url);
    this.ws = ws;

    ws.onopen = () => {
      this.send({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        client: { platform: this.options.platform, version: this.options.appVersion },
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      let frame: ServerFrame;
      try {
        frame = ServerFrame.parse(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      this.handle(frame);
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.failPending(new RealtimeError("offline"));
      if (event.code === CloseCode.AuthFailed || event.code === CloseCode.DeviceRemoved) {
        // This phone is no longer part of the account (for example, after recovery elsewhere).
        this.stopped = true;
        this.setState("signed_out");
        return;
      }
      this.setState("offline");
      if (!this.stopped) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows and handles reconnecting.
    };
  }

  private handle(frame: ServerFrame): void {
    switch (frame.type) {
      case "welcome":
        this.send({
          type: "auth",
          deviceId: this.options.deviceId,
          signature: this.options.sign(fromBase64url(frame.challenge)),
        });
        return;
      case "authenticated":
        this.attempt = 0;
        this.setState("online");
        return;
      case "deliver":
        this.options.onMessages?.(frame.messages);
        return;
      case "error":
        if (frame.requestId) this.settle(frame.requestId, undefined, new RealtimeError(frame.code));
        return;
      default:
        if ("requestId" in frame) this.settle(frame.requestId, frame as ResponseFrame);
    }
  }

  private settle(requestId: string, answer?: ResponseFrame, error?: Error): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(answer!);
  }

  private failPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(): void {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.retryTimer = setTimeout(() => {
      if (!this.stopped) this.open();
    }, delay);
  }
}
