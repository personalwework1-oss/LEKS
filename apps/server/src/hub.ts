import { CloseCode, type DeliveredMessage, type ServerFrame, type WakeReason } from "@leks/protocol";
import type { FastifyBaseLogger } from "fastify";
import type { Store } from "./store.js";

/** How many queued messages are sent in one `deliver` frame. */
const DELIVERY_BATCH = 100;

/** A connected, authenticated device. */
export interface DeviceConnection {
  readonly accountId: string;
  readonly deviceId: string;
  send(frame: ServerFrame): void;
  close(code: number, reason: string): void;
  /** Highest queue id already sent on this connection; resets on reconnect. */
  lastSentId: number;
  /** Serializes deliveries so frames go out in queue order. */
  delivering: Promise<void>;
}

/**
 * Sends the "you have new messages" signal to a device that is offline.
 * The signal carries no content. Real APNs and FCM senders are plugged in
 * when the app credentials exist; until then nothing is sent.
 */
export type PushTestResult = "sent" | "no_token" | "not_configured" | "rejected" | "failed";

export interface PushNotifier {
  /** `from` is the sender's account, used only to derive the caller hint (see callerHint). */
  notify(deviceId: string, reason: WakeReason, from?: string): Promise<void>;
  /** Sends a visible test notification now (no throttling) and says what happened. */
  test?(deviceId: string): Promise<PushTestResult>;
}

export const noPush: PushNotifier = { notify: async () => undefined };

/** Tracks connected devices and delivers queued messages to them. */
export class Hub {
  private readonly connections = new Map<string, Set<DeviceConnection>>();

  constructor(
    private readonly store: Store,
    private readonly push: PushNotifier,
    private readonly log: FastifyBaseLogger,
  ) {}

  add(connection: DeviceConnection): void {
    let set = this.connections.get(connection.deviceId);
    if (!set) {
      set = new Set();
      this.connections.set(connection.deviceId, set);
    }
    set.add(connection);
  }

  remove(connection: DeviceConnection): void {
    const set = this.connections.get(connection.deviceId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) this.connections.delete(connection.deviceId);
  }

  isOnline(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  /** Closes every connection of devices that no longer exist. */
  disconnectDevices(deviceIds: string[]): void {
    for (const deviceId of deviceIds) {
      for (const connection of this.connections.get(deviceId) ?? []) {
        connection.close(CloseCode.DeviceRemoved, "device removed");
      }
      this.connections.delete(deviceId);
    }
  }

  /** New messages were queued for these devices: deliver now, or send a push signal. */
  /** Passes a "check your chats with this account" signal to whichever of these devices are online. */
  nudge(deviceIds: string[], fromAccountId: string): void {
    for (const deviceId of new Set(deviceIds)) {
      for (const connection of this.connections.get(deviceId) ?? []) connection.send({ type: "nudge", accountId: fromAccountId });
    }
  }

  /** Delivers to connected devices; offline ones get a push only when the sender asked to wake them. */
  notifyQueued(deviceIds: string[], wake?: WakeReason, from?: string): void {
    for (const deviceId of new Set(deviceIds)) {
      const connections = this.connections.get(deviceId);
      if (connections && connections.size > 0) {
        for (const connection of connections) this.deliver(connection);
      } else if (wake) {
        this.push
          .notify(deviceId, wake, from)
          .then(() => this.log.info({ reason: wake }, "push signal handed over"))
          .catch((error: unknown) => this.log.warn({ err: error }, "push signal failed"));
      }
    }
  }

  /** Sends everything queued for the connection's device that it has not been sent yet. */
  deliver(connection: DeviceConnection): Promise<void> {
    connection.delivering = connection.delivering
      .then(async () => {
        for (;;) {
          const batch = await this.store.pending(connection.deviceId, connection.lastSentId, DELIVERY_BATCH);
          if (batch.length === 0) return;
          const messages: DeliveredMessage[] = batch.map((message) => ({
            id: message.id,
            from: { accountId: message.senderAccountId, deviceId: message.senderDeviceId },
            kind: message.kind,
            payload: message.payload.toString("base64url"),
            sentAt: message.createdAt.getTime(),
          }));
          connection.send({ type: "deliver", messages });
          connection.lastSentId = batch[batch.length - 1]!.id;
          if (batch.length < DELIVERY_BATCH) return;
        }
      })
      .catch((error: unknown) => this.log.error({ err: error }, "delivery failed"));
    return connection.delivering;
  }
}
