import type { DeliveredMessage, PublicUser } from "@leks/protocol";
import { toBase64url } from "@leks/protocol";
import { type Engine, type Received, utf8Decode, utf8Encode } from "../src/crypto/engine";
import { MemoryStore } from "../src/messaging/memoryStore";
import { identityOf, type Me, Messenger, MessengerError, parseIdentity, type Transport } from "../src/messaging/messenger";

/**
 * A stand-in for the Rust core: keeps the same shape of results so the
 * messenger's logic (invites, recipients, outbox, intro) is tested here;
 * the real encryption is tested in crates/leks-crypto.
 */
class FakeEngine implements Engine {
  groups = new Map<string, string[]>();
  private counter = 0;
  constructor(private readonly identity: string) {}
  private enc(value: unknown) {
    return toBase64url(utf8Encode(JSON.stringify(value)));
  }
  private dec<T>(text: string): T {
    const bytes = Uint8Array.from(Buffer.from(text, "base64url"));
    return JSON.parse(utf8Decode(bytes)) as T;
  }
  async open() {
    return { groups: [...this.groups.keys()] };
  }
  async reset() {
    this.groups.clear();
  }
  async keyPackages(count: number) {
    return Array.from({ length: count }, () => this.enc({ kp: this.identity }));
  }
  async createGroup() {
    const id = `g-${this.identity}-${++this.counter}`;
    this.groups.set(id, [this.identity]);
    return id;
  }
  async addMember(groupId: string, keyPackage: string) {
    const member = this.dec<{ kp: string }>(keyPackage).kp;
    const members = [...this.groups.get(groupId)!, member];
    this.groups.set(groupId, members);
    return { commit: this.enc({ commit: groupId, members }), welcome: this.enc({ welcome: groupId, members }) };
  }
  async join(welcome: string) {
    const { welcome: groupId, members } = this.dec<{ welcome: string; members: string[] }>(welcome);
    this.groups.set(groupId, members);
    return groupId;
  }
  async encrypt(groupId: string, plaintext: Uint8Array) {
    if (!this.groups.has(groupId)) throw new Error("unknown group");
    return this.enc({ g: groupId, s: this.identity, p: toBase64url(plaintext) });
  }
  async receive(message: string): Promise<Received> {
    const value = this.dec<{ g?: string; s?: string; p?: string; commit?: string; members?: string[] }>(message);
    if (value.commit) {
      this.groups.set(value.commit, value.members!);
      return { kind: "group_updated", groupId: value.commit };
    }
    if (!this.groups.has(value.g!)) throw new Error("unknown group");
    return { kind: "message", groupId: value.g!, sender: value.s!, plaintext: Uint8Array.from(Buffer.from(value.p!, "base64url")) };
  }
  async members(groupId: string) {
    return this.groups.get(groupId) ?? [];
  }
}

/** A tiny in-memory server: key packages, per-device queues, delivery to connected phones. */
class FakeServer {
  keyPackages = new Map<string, { deviceId: string; keyPackage: string }[]>();
  phones = new Map<string, Phone>();
  nextId = 1;
  sends: string[] = [];
  /** One clock for everyone, so message order is the order things happened. */
  clock = 1_000;
  tick = () => (this.clock += 1000);
}

class Phone {
  online = true;
  inbox: DeliveredMessage[] = [];
  acked: number[] = [];
  readonly store = new MemoryStore();
  readonly engine: FakeEngine;
  readonly messenger: Messenger;
  private uuidCounter = 0;

  constructor(readonly server: FakeServer, readonly me: Me) {
    this.engine = new FakeEngine(identityOf(me));
    server.phones.set(me.deviceId, this);
    const phone = this;
    const transport: Transport = {
      get connectionState() {
        return phone.online ? "online" : "offline";
      },
      request: (async (frame: { type: string; accountId?: string; keyPackages?: string[] }) => {
        if (frame.type === "publish_key_packages") {
          const list = server.keyPackages.get(me.accountId) ?? [];
          list.push(...frame.keyPackages!.map((keyPackage) => ({ deviceId: me.deviceId, keyPackage })));
          server.keyPackages.set(me.accountId, list);
          return { type: "key_packages_published", requestId: "r", available: list.length };
        }
        if (frame.type === "claim_key_packages") {
          const list = server.keyPackages.get(frame.accountId!) ?? [];
          const byDevice = new Map<string, { deviceId: string; keyPackage: string }>();
          for (const item of list) if (!byDevice.has(item.deviceId)) byDevice.set(item.deviceId, item);
          const items = [...byDevice.values()];
          server.keyPackages.set(frame.accountId!, list.filter((item) => !items.includes(item)));
          return { type: "key_packages", requestId: "r", accountId: frame.accountId, items };
        }
        throw new Error(`unexpected ${frame.type}`);
      }) as Transport["request"],
      sendMessage: async (frame) => {
        if (!phone.online) throw new Error("offline");
        server.sends.push(frame.id);
        for (const deviceId of frame.recipients) {
          server.phones.get(deviceId)?.inbox.push({
            id: server.nextId++,
            from: { accountId: me.accountId, deviceId: me.deviceId },
            kind: frame.kind,
            payload: frame.payload,
            sentAt: server.clock,
          });
        }
        return { type: "sent", id: frame.id, accepted: frame.recipients, unknown: [] };
      },
      ack: (ids) => phone.acked.push(...ids),
    };
    this.messenger = new Messenger(this.engine, transport, this.store, me, () => `${me.deviceId}-${++this.uuidCounter}`, server.tick);
  }

  /** Hands over what the server holds for this phone, as a `deliver` frame would. */
  async deliver() {
    const batch = this.inbox.splice(0);
    if (batch.length) await this.messenger.onMessages(batch);
  }
}

const alice: Me = { accountId: "acc-alice", deviceId: "dev-alice", displayName: "Алиса", username: "alice" };
const bob: Me = { accountId: "acc-bob", deviceId: "dev-bob", displayName: "Боб", username: "bob" };
const asUser = (me: Me): PublicUser => ({ accountId: me.accountId, username: me.username, displayName: me.displayName });

async function twoPhones() {
  const server = new FakeServer();
  const a = new Phone(server, alice);
  const b = new Phone(server, bob);
  await a.messenger.onAuthenticated(0);
  await b.messenger.onAuthenticated(0);
  return { server, a, b };
}

describe("Messenger", () => {
  it("publishes key packages when the server runs low", async () => {
    const { server } = await twoPhones();
    expect(server.keyPackages.get("acc-bob")).toHaveLength(50);
  });

  it("starts a chat, introduces itself and exchanges messages", async () => {
    const { a, b } = await twoPhones();
    const chatId = await a.messenger.startChat(asUser(bob));
    await a.messenger.flush();
    await b.deliver();

    const bobChats = await b.messenger.conversations();
    expect(bobChats).toHaveLength(1);
    expect(bobChats[0]).toMatchObject({ id: chatId, peerAccountId: "acc-alice", title: "Алиса", username: "alice" });

    await a.messenger.send(chatId, "Привет, Боб!");
    await b.deliver();
    const received = await b.messenger.messages(chatId);
    expect(received.map((m) => [m.text, m.outgoing, m.status])).toEqual([["Привет, Боб!", false, "received"]]);
    expect((await b.messenger.conversation(chatId))?.unread).toBe(1);
    expect(b.acked.length).toBeGreaterThan(0);

    await b.messenger.send(chatId, "Привет, Алиса");
    await a.deliver();
    const aliceView = await a.messenger.messages(chatId);
    expect(aliceView.map((m) => [m.text, m.outgoing])).toEqual([
      ["Привет, Боб!", true],
      ["Привет, Алиса", false],
    ]);
    expect(aliceView[0]!.status).toBe("sent");

    await b.messenger.markRead(chatId);
    expect((await b.messenger.conversation(chatId))?.unread).toBe(0);
  });

  it("reuses an existing chat with the same person", async () => {
    const { a } = await twoPhones();
    const first = await a.messenger.startChat(asUser(bob));
    expect(await a.messenger.startChat(asUser(bob))).toBe(first);
  });

  it("explains when the other person has no devices yet", async () => {
    const server = new FakeServer();
    const a = new Phone(server, alice);
    await expect(a.messenger.startChat(asUser(bob))).rejects.toEqual(new MessengerError("no_devices"));
  });

  it("keeps messages in the outbox while offline and sends them in order later", async () => {
    const { a, b, server } = await twoPhones();
    const chatId = await a.messenger.startChat(asUser(bob));
    await a.messenger.flush();
    await b.deliver();

    a.online = false;
    await a.messenger.send(chatId, "первое");
    await a.messenger.send(chatId, "второе");
    expect((await a.messenger.messages(chatId)).map((m) => m.status)).toEqual(["sending", "sending"]);
    const sentBefore = server.sends.length;

    a.online = true;
    await a.messenger.flush();
    expect(server.sends.length).toBe(sentBefore + 2);
    expect((await a.messenger.messages(chatId)).map((m) => m.status)).toEqual(["sent", "sent"]);
    await b.deliver();
    expect((await b.messenger.messages(chatId)).map((m) => m.text)).toEqual(["первое", "второе"]);
  });

  it("ignores a repeated delivery of the same message", async () => {
    const { a, b } = await twoPhones();
    const chatId = await a.messenger.startChat(asUser(bob));
    await a.messenger.flush();
    await b.deliver();
    await a.messenger.send(chatId, "один раз");
    const copy = [...b.inbox];
    await b.deliver();
    // The fake engine allows replays; the store must still keep one copy.
    await b.messenger.onMessages(copy);
    expect(await b.messenger.messages(chatId)).toHaveLength(1);
  });

  it("drops undecryptable messages instead of getting stuck, and still acknowledges them", async () => {
    const { b } = await twoPhones();
    await b.messenger.onMessages([
      { id: 99, from: { accountId: "x", deviceId: "y" }, kind: "message", payload: "AAAA", sentAt: 1 },
    ]);
    expect(b.acked).toContain(99);
  });

  it("wipes chats and keys on sign-out", async () => {
    const { a } = await twoPhones();
    await a.messenger.startChat(asUser(bob));
    await a.messenger.wipe();
    expect(await a.messenger.conversations()).toEqual([]);
    expect(a.engine.groups.size).toBe(0);
  });
});

describe("identity", () => {
  it("round-trips account and device ids", () => {
    expect(parseIdentity(identityOf({ accountId: "a", deviceId: "d" }))).toEqual({ accountId: "a", deviceId: "d" });
    expect(parseIdentity("broken")).toBeNull();
  });

  it("UTF-8 helpers handle Cyrillic and emoji", () => {
    for (const text of ["Привет", "hello", "€ 100", "👍🏽 ok", ""]) {
      expect(utf8Decode(utf8Encode(text))).toBe(text);
      expect(Buffer.from(utf8Encode(text)).toString("utf8")).toBe(text);
    }
  });
});
