import { CallManager, type EndedCall, RING_MS } from "../src/calls/CallManager";
import type { Payload } from "../src/messaging/types";

function setup(myAccountId = "me") {
  const sent: { conversationId: string; payload: Payload }[] = [];
  const ended: EndedCall[] = [];
  const timers: { fn: () => void; at: number; cleared: boolean }[] = [];
  let clock = 1_000_000;
  let failToken = false;
  const manager = new CallManager({
    myAccountId,
    send: async (conversationId, payload) => void sent.push({ conversationId, payload }),
    token: async (room) => {
      if (failToken) throw new Error("no calls");
      return { url: "wss://media", token: `pass-${room}` };
    },
    uuid: () => "call-1",
    newKey: () => "k".repeat(43),
    now: () => clock,
    setTimer: (fn, ms) => {
      const timer = { fn, at: clock + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => void ((timer as { cleared: boolean }).cleared = true),
    onEnded: (call) => void ended.push(call),
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) if (!t.cleared && t.at <= clock) {
      t.cleared = true;
      t.fn();
    }
  };
  return { manager, sent, ended, advance, fail: () => (failToken = true), now: () => clock };
}

describe("calls", () => {
  it("rings, connects when they pick up, and hangs up", async () => {
    const { manager, sent, now } = setup();
    await manager.start("chat", true);
    expect(manager.state).toMatchObject({ phase: "outgoing", video: true, url: "wss://media", token: "pass-call-1" });
    expect(sent[0]!.payload).toMatchObject({ type: "call_invite", callId: "call-1", video: true, key: "k".repeat(43) });

    manager.receive({ type: "accept", conversationId: "chat", from: "bob", callId: "call-1" });
    expect(manager.state).toMatchObject({ phase: "active", startedAt: now() });

    await manager.hangUp();
    expect(manager.state).toMatchObject({ phase: "idle", ended: "hung_up", key: null, token: null });
    expect(sent.at(-1)!.payload).toEqual({ v: 1, type: "call_end", callId: "call-1" });
  });

  it("gives up after ringing with no answer and tells the other side", async () => {
    const { manager, sent, advance } = setup();
    await manager.start("chat", false);
    advance(RING_MS + 1);
    expect(manager.state).toMatchObject({ phase: "idle", ended: "no_answer" });
    expect(sent.at(-1)!.payload).toMatchObject({ type: "call_end" });
  });

  it("answers an incoming call with a pass for the same room", async () => {
    const { manager, sent, now } = setup();
    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "room-9", video: false, key: "secret", sentAt: now() });
    expect(manager.state).toMatchObject({ phase: "incoming", from: "bob", key: "secret" });
    await manager.accept();
    expect(manager.state).toMatchObject({ phase: "active", token: "pass-room-9" });
    expect(sent[0]!.payload).toEqual({ v: 1, type: "call_accept", callId: "room-9" });

    manager.receive({ type: "end", conversationId: "chat", from: "bob", callId: "room-9" });
    expect(manager.state).toMatchObject({ phase: "idle", ended: "hung_up" });
  });

  it("declines, and counts unanswered or cancelled calls as missed", async () => {
    const { manager, sent, advance, now } = setup();
    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "a", video: false, key: "x", sentAt: now() });
    await manager.decline();
    expect(manager.state.ended).toBe("declined");
    expect(sent.at(-1)!.payload).toEqual({ v: 1, type: "call_decline", callId: "a" });

    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "b", video: false, key: "x", sentAt: now() });
    advance(RING_MS + 1);
    expect(manager.state.ended).toBe("missed");

    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "c", video: false, key: "x", sentAt: now() });
    manager.receive({ type: "end", conversationId: "chat", from: "bob", callId: "c" });
    expect(manager.state.ended).toBe("missed");
  });

  it("ignores stale invites, and is busy during another call", async () => {
    const { manager, sent, now } = setup();
    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "old", video: false, key: "x", sentAt: now() - RING_MS - 5 });
    expect(manager.state.phase).toBe("idle");

    await manager.start("chat", false);
    manager.receive({ type: "invite", conversationId: "other", from: "carol", callId: "second", video: false, key: "x", sentAt: now() });
    expect(manager.state.callId).toBe("call-1");
    expect(sent.at(-1)).toEqual({ conversationId: "other", payload: { v: 1, type: "call_decline", callId: "second" } });
  });

  it("stops ringing when I answer on another of my phones", () => {
    const { manager, now } = setup("me");
    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "z", video: false, key: "x", sentAt: now() });
    manager.receive({ type: "accept", conversationId: "chat", from: "me", callId: "z" });
    expect(manager.state).toMatchObject({ phase: "idle", ended: "answered_elsewhere" });
  });

  it("ignores signals about other calls, and the other side declining ends my call", async () => {
    const { manager } = setup();
    await manager.start("chat", false);
    manager.receive({ type: "accept", conversationId: "chat", from: "bob", callId: "not-this" });
    expect(manager.state.phase).toBe("outgoing");
    manager.receive({ type: "decline", conversationId: "chat", from: "bob", callId: "call-1" });
    expect(manager.state).toMatchObject({ phase: "idle", ended: "declined" });
  });

  it("reports how each call ended, for the note in the chat", async () => {
    const { manager, ended, advance, now } = setup();
    await manager.start("chat", false);
    manager.receive({ type: "accept", conversationId: "chat", from: "bob", callId: "call-1" });
    advance(65_000);
    await manager.hangUp();
    expect(ended.at(-1)).toEqual({ conversationId: "chat", outgoing: true, video: false, reason: "hung_up", duration: 65_000 });

    manager.receive({ type: "invite", conversationId: "chat", from: "bob", callId: "in", video: true, key: "x", sentAt: now() });
    advance(RING_MS + 1);
    expect(ended.at(-1)).toMatchObject({ outgoing: false, video: true, reason: "missed", duration: 0 });
  });

  it("fails cleanly when calls are not available on the server", async () => {
    const { manager, fail } = setup();
    fail();
    await manager.start("chat", false);
    expect(manager.state).toMatchObject({ phase: "idle", ended: "failed" });
  });
});
