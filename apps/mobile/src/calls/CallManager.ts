import type { CallSignal } from "../messaging/messenger";
import type { Payload } from "../messaging/types";

/** How long a call rings before it counts as missed. */
export const RING_MS = 45_000;

export type CallPhase = "idle" | "outgoing" | "incoming" | "active";
export type EndReason = "hung_up" | "declined" | "no_answer" | "missed" | "busy" | "failed" | "answered_elsewhere";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  /** Who is calling me (incoming), by account id. */
  from: string | null;
  video: boolean;
  /** The media key (base64url), shared only inside the encrypted chat. */
  key: string | null;
  /** Media server address and pass, once fetched. */
  url: string | null;
  token: string | null;
  /** When the other side picked up. */
  startedAt: number | null;
  /** Why the last call ended, to show briefly. */
  ended: EndReason | null;
}

export interface CallDeps {
  myAccountId: string;
  send(conversationId: string, payload: Extract<Payload, { type: `call_${string}` }>): Promise<void>;
  /** A pass for the media server for this room. */
  token(room: string): Promise<{ url: string; token: string }>;
  uuid(): string;
  /** 32 random bytes, base64url. */
  newKey(): string;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  /** Told about every call that ends, for the note in the chat. */
  onEnded?(call: EndedCall): void;
}

export interface EndedCall {
  conversationId: string;
  outgoing: boolean;
  video: boolean;
  reason: EndReason;
  /** Talking time in ms; 0 if they never picked up. */
  duration: number;
}

const IDLE: CallState = {
  phase: "idle",
  callId: null,
  conversationId: null,
  from: null,
  video: false,
  key: null,
  url: null,
  token: null,
  startedAt: null,
  ended: null,
};

/** One call at a time: ringing, answering, hanging up, and what the other side does. */
export class CallManager {
  private current: CallState = IDLE;
  private readonly listeners = new Set<(state: CallState) => void>();
  private ringTimer: unknown = null;

  constructor(private readonly deps: CallDeps) {}

  get state(): CallState {
    return this.current;
  }

  subscribe(listener: (state: CallState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: Partial<CallState>) {
    this.current = { ...this.current, ...next };
    for (const listener of this.listeners) listener(this.current);
  }

  private ring(onTimeout: () => void) {
    this.stopRinging();
    this.ringTimer = this.deps.setTimer(onTimeout, RING_MS);
  }

  private stopRinging() {
    if (this.ringTimer !== null) this.deps.clearTimer(this.ringTimer);
    this.ringTimer = null;
  }

  private finish(reason: EndReason) {
    this.stopRinging();
    const { conversationId, from, video, startedAt } = this.current;
    if (conversationId && this.current.phase !== "idle") {
      this.deps.onEnded?.({
        conversationId,
        outgoing: from === null,
        video,
        reason,
        duration: startedAt ? this.deps.now() - startedAt : 0,
      });
    }
    this.current = { ...IDLE, ended: reason };
    for (const listener of this.listeners) listener(this.current);
  }

  /** Calls everyone in the chat. The caller joins the room right away so the line is ready when they pick up. */
  async start(conversationId: string, video: boolean): Promise<void> {
    if (this.current.phase !== "idle") return;
    const callId = this.deps.uuid();
    const key = this.deps.newKey();
    this.set({ ...IDLE, phase: "outgoing", callId, conversationId, video, key });
    try {
      await this.deps.send(conversationId, { v: 1, type: "call_invite", callId, video, key, sentAt: this.deps.now() });
      const pass = await this.deps.token(callId);
      if (this.current.callId === callId) this.set(pass);
    } catch {
      if (this.current.callId === callId) this.finish("failed");
      return;
    }
    this.ring(() => {
      if (this.current.callId === callId && this.current.phase === "outgoing") {
        void this.deps.send(conversationId, { v: 1, type: "call_end", callId }).catch(() => undefined);
        this.finish("no_answer");
      }
    });
  }

  async accept(): Promise<void> {
    const { phase, callId, conversationId } = this.current;
    if (phase !== "incoming" || !callId || !conversationId) return;
    this.stopRinging();
    this.set({ phase: "active", startedAt: this.deps.now() });
    try {
      await this.deps.send(conversationId, { v: 1, type: "call_accept", callId });
      const pass = await this.deps.token(callId);
      if (this.current.callId === callId) this.set(pass);
    } catch {
      if (this.current.callId === callId) this.finish("failed");
    }
  }

  async decline(): Promise<void> {
    const { phase, callId, conversationId } = this.current;
    if (phase !== "incoming" || !callId || !conversationId) return;
    this.finish("declined");
    await this.deps.send(conversationId, { v: 1, type: "call_decline", callId }).catch(() => undefined);
  }

  async hangUp(): Promise<void> {
    const { phase, callId, conversationId } = this.current;
    if ((phase !== "outgoing" && phase !== "active") || !callId || !conversationId) return;
    this.finish("hung_up");
    await this.deps.send(conversationId, { v: 1, type: "call_end", callId }).catch(() => undefined);
  }

  /** Forget why the last call ended (after showing it). */
  dismiss(): void {
    if (this.current.phase === "idle" && this.current.ended) this.set({ ended: null });
  }

  /** Signals from the chat (see Messenger.onCall). */
  receive(signal: CallSignal): void {
    const mine = signal.from === this.deps.myAccountId;
    switch (signal.type) {
      case "invite": {
        if (mine) return;
        // Delivered late (the phone was offline): too late to answer.
        if (this.deps.now() - signal.sentAt > RING_MS) return;
        if (this.current.phase !== "idle") {
          if (this.current.callId !== signal.callId) {
            void this.deps.send(signal.conversationId, { v: 1, type: "call_decline", callId: signal.callId }).catch(() => undefined);
          }
          return;
        }
        this.set({
          ...IDLE,
          phase: "incoming",
          callId: signal.callId,
          conversationId: signal.conversationId,
          from: signal.from,
          video: signal.video,
          key: signal.key,
        });
        this.ring(() => {
          if (this.current.callId === signal.callId && this.current.phase === "incoming") this.finish("missed");
        });
        return;
      }
      case "accept":
        if (signal.callId !== this.current.callId) return;
        if (this.current.phase === "outgoing" && !mine) {
          this.stopRinging();
          this.set({ phase: "active", startedAt: this.deps.now() });
        } else if (this.current.phase === "incoming" && mine) {
          this.finish("answered_elsewhere");
        }
        return;
      case "decline":
        if (signal.callId !== this.current.callId) return;
        if (this.current.phase === "outgoing" && !mine) this.finish("declined");
        else if (this.current.phase === "incoming" && mine) this.finish("answered_elsewhere");
        return;
      case "end":
        if (signal.callId !== this.current.callId || mine) return;
        this.finish(this.current.phase === "incoming" ? "missed" : "hung_up");
        return;
    }
  }
}
