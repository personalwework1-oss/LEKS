import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveredMessage, PublicUser } from "@leks/protocol";
import { toBase64url } from "@leks/protocol";
import { type Engine, type Received, utf8Decode, utf8Encode } from "../src/crypto/engine";
import { type FileIO, safeName } from "../src/messaging/files";
import { MemoryStore } from "../src/messaging/memoryStore";
import {
  decodePayload,
  identityOf,
  type Me,
  Messenger,
  MessengerError,
  type OutgoingFile,
  parseIdentity,
  type Transport,
} from "../src/messaging/messenger";

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
  async removeMembers(groupId: string, identities: string[]) {
    const members = (this.groups.get(groupId) ?? []).filter((m) => !identities.includes(m));
    this.groups.set(groupId, members);
    return this.enc({ commit: groupId, members });
  }
  async groupState(groupId: string) {
    const members = this.groups.get(groupId) ?? [];
    return { active: members.includes(this.identity), members };
  }
  async forgetGroup(groupId: string) {
    this.groups.delete(groupId);
  }
  private fileCounter = 0;
  /** Not real encryption: scrambles the bytes and prefixes the key, enough to test the flow. */
  async encryptFile(input: string, output: string) {
    const key = `key-${this.identity}-${++this.fileCounter}`;
    const data = readFileSync(input).map((b) => b ^ 0x5a);
    writeFileSync(output, Buffer.concat([Buffer.from(`${key}\n`), data]));
    return { key, size: statSync(output).size };
  }
  async decryptFile(input: string, output: string, key: string) {
    const data = readFileSync(input);
    const header = Buffer.from(`${key}\n`);
    if (!data.subarray(0, header.length).equals(header)) throw new Error("wrong key");
    writeFileSync(output, data.subarray(header.length).map((b) => b ^ 0x5a));
  }
}

/** Files in a temporary folder; the "server" keeps uploaded blobs in its own folder. */
class TempFiles implements FileIO {
  private counter = 0;
  constructor(
    readonly dir: string,
    private readonly server: FakeServer,
  ) {
    mkdirSync(join(dir, "media"), { recursive: true });
  }
  tempUri() {
    return join(this.dir, `tmp-${++this.counter}.enc`);
  }
  mediaUri(messageId: string, name: string) {
    return join(this.dir, "media", `${messageId}-${safeName(name)}`);
  }
  async copy(from: string, to: string) {
    copyFileSync(from, to);
  }
  async upload(blobId: string, token: string, uri: string) {
    if (this.server.failUploads) throw new Error("network");
    const expected = this.server.tickets.get(blobId);
    if (expected !== token) throw new Error("403");
    this.server.tickets.delete(blobId);
    this.server.blobs.set(blobId, readFileSync(uri));
  }
  async download(blobId: string, uri: string) {
    const blob = this.server.blobs.get(blobId);
    if (!blob) throw new Error("404");
    writeFileSync(uri, blob);
  }
  async remove(uri: string) {
    rmSync(uri, { force: true });
  }
  async clear() {
    rmSync(join(this.dir, "media"), { recursive: true, force: true });
    mkdirSync(join(this.dir, "media"), { recursive: true });
  }
}

/** A tiny in-memory server: key packages, per-device queues, delivery to connected phones. */
class FakeServer {
  keyPackages = new Map<string, { deviceId: string; keyPackage: string }[]>();
  phones = new Map<string, Phone>();
  nextId = 1;
  sends: string[] = [];
  tickets = new Map<string, string>();
  blobs = new Map<string, Buffer>();
  failUploads = false;
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
  readonly files: TempFiles;
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
        if (frame.type === "request_upload") {
          const blobId = `blob-${server.nextId++}`;
          server.tickets.set(blobId, `token-${blobId}`);
          return { type: "upload_ready", requestId: "r", blobId, token: `token-${blobId}` };
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
    this.files = new TempFiles(mkdtempSync(join(tmpdir(), `leks-${me.deviceId}-`)), server);
    this.messenger = new Messenger(this.engine, transport, this.store, me, () => `${me.deviceId}-${++this.uuidCounter}`, server.tick, this.files);
  }

  /** Hands over what the server holds for this phone, as a `deliver` frame would. */
  async deliver() {
    await settle();
    const batch = this.inbox.splice(0);
    if (batch.length) await this.messenger.onMessages(batch);
  }
}

/** Lets every pending send and receipt finish (everything here is in memory). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    // Bob's phone confirmed it arrived.
    expect(aliceView[0]!.status).toBe("delivered");

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
    await settle();
    expect(b.inbox).toHaveLength(1);
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

/** Alice and Bob with a chat between them, everything delivered. */
async function chatting() {
  const phones = await twoPhones();
  const chatId = await phones.a.messenger.startChat(asUser(bob));
  await phones.a.messenger.flush();
  await phones.b.deliver();
  return { ...phones, chatId };
}

describe("message features", () => {
  it("shows sent → delivered → read on the sender's side", async () => {
    const { a, b, chatId } = await chatting();
    const sent = await a.messenger.send(chatId, "Ты тут?");
    await settle();
    expect((await a.messenger.messages(chatId))[0]!.status).toBe("sent");

    await b.deliver();
    await a.deliver();
    expect((await a.messenger.messages(chatId))[0]!.status).toBe("delivered");

    await b.messenger.markRead(chatId);
    expect((await b.messenger.messages(chatId))[0]!.status).toBe("read");
    await a.deliver();
    expect((await a.messenger.messages(chatId))[0]).toMatchObject({ id: sent.id, status: "read" });

    // Reading again sends nothing new.
    await settle();
    const before = b.server.sends.length;
    await b.messenger.markRead(chatId);
    expect(b.server.sends.length).toBe(before);
  });

  it("answers a message with a quote", async () => {
    const { a, b, chatId } = await chatting();
    const question = await a.messenger.send(chatId, "Встречаемся в 7?");
    await b.deliver();
    await b.messenger.send(chatId, "Да", question.id);
    await a.deliver();
    const answer = (await a.messenger.messages(chatId)).find((m) => m.text === "Да");
    expect(answer?.replyTo).toBe(question.id);
  });

  it("edits and deletes my own messages on both phones", async () => {
    const { a, b, chatId } = await chatting();
    const first = await a.messenger.send(chatId, "Привет, Боп");
    const second = await a.messenger.send(chatId, "лишнее");
    await b.deliver();

    await a.messenger.edit(first.id, "Привет, Боб");
    await a.messenger.deleteForEveryone(second.id);
    await b.deliver();

    const view = await b.messenger.messages(chatId);
    expect(view.map((m) => [m.text, m.editedAt !== null, m.deleted])).toEqual([
      ["Привет, Боб", true, false],
      ["", false, true],
    ]);
    // The list preview follows the newest message, and the deleted one no longer counts as unread.
    expect(await b.messenger.conversation(chatId)).toMatchObject({ lastText: "Сообщение удалено", unread: 1 });
  });

  it("does not let anyone edit or delete someone else's message", async () => {
    const { a, b, chatId } = await chatting();
    const mine = await a.messenger.send(chatId, "моё");
    await b.deliver();
    await expect(b.messenger.edit(mine.id, "чужое")).rejects.toEqual(new MessengerError("not_allowed"));
    await expect(b.messenger.deleteForEveryone(mine.id)).rejects.toEqual(new MessengerError("not_allowed"));
  });

  it("deletes for me only on this phone", async () => {
    const { a, b, chatId } = await chatting();
    const message = await a.messenger.send(chatId, "секрет");
    await b.deliver();
    await b.messenger.deleteForMe(message.id);
    expect(await b.messenger.messages(chatId)).toEqual([]);
    expect(await b.messenger.conversation(chatId)).toMatchObject({ unread: 0, lastText: null });
    expect(await a.messenger.messages(chatId)).toHaveLength(1);
  });

  it("sets, changes and removes reactions", async () => {
    const { a, b, chatId } = await chatting();
    const message = await a.messenger.send(chatId, "Сдал экзамен!");
    await b.deliver();

    await b.messenger.react(message.id, "👍");
    await a.deliver();
    expect((await a.messenger.messages(chatId))[0]!.reactions).toEqual({ "acc-bob": "👍" });

    await b.messenger.react(message.id, "❤️");
    await a.messenger.react(message.id, "😂");
    await a.deliver();
    await b.deliver();
    const expected = { "acc-bob": "❤️", "acc-alice": "😂" };
    expect((await a.messenger.messages(chatId))[0]!.reactions).toEqual(expected);
    expect((await b.messenger.messages(chatId))[0]!.reactions).toEqual(expected);

    // The same emoji again takes it back.
    await b.messenger.react(message.id, "❤️");
    await a.deliver();
    expect((await a.messenger.messages(chatId))[0]!.reactions).toEqual({ "acc-alice": "😂" });

    await expect(b.messenger.react(message.id, "💩")).rejects.toEqual(new MessengerError("not_allowed"));
  });

  it("shows typing… until the message arrives, and never queues it", async () => {
    const { a, b, chatId } = await chatting();
    await b.deliver();
    await a.deliver();
    await a.messenger.typing(chatId);
    await a.messenger.typing(chatId); // throttled
    expect(b.inbox).toHaveLength(1);
    expect(await a.store.outbox()).toEqual([]);

    await b.deliver();
    expect(b.messenger.isTyping(chatId)).toBe(true);
    await a.messenger.send(chatId, "готово");
    await b.deliver();
    expect(b.messenger.isTyping(chatId)).toBe(false);
    await b.messenger.wipe();
  });

  it("does not send typing while messages are still waiting to go out", async () => {
    const { a, b, chatId } = await chatting();
    a.online = false;
    await a.messenger.send(chatId, "в очереди");
    await settle();
    a.online = true;
    // The send is queued but not flushed yet in this tick.
    const inboxBefore = b.inbox.length;
    await a.messenger.typing(chatId);
    await a.messenger.flush();
    expect(b.inbox.slice(inboxBefore)).toHaveLength(1);
  });

  it("rejects malformed payloads", () => {
    expect(decodePayload(utf8Encode(JSON.stringify({ v: 1, type: "reaction", id: "m", emoji: "<script>" })))).toBeNull();
    expect(decodePayload(utf8Encode(JSON.stringify({ v: 1, type: "reaction", id: "m", emoji: "👍" })))).not.toBeNull();
    expect(decodePayload(utf8Encode(JSON.stringify({ v: 1, type: "receipt", state: "read", ids: [1] })))).toBeNull();
    expect(decodePayload(utf8Encode(JSON.stringify({ v: 2, type: "text", id: "x", text: "y", sentAt: 1 })))).toBeNull();
  });

  it("ignores someone else who got into the chat's group", async () => {
    const { a, b, chatId } = await chatting();
    const message = await a.messenger.send(chatId, "раз");
    await b.deliver();
    const carol = new Phone(a.server, { accountId: "acc-carol", deviceId: "dev-carol", displayName: "Кэрол", username: "carol" });
    carol.engine.groups.set(chatId, [identityOf(alice), identityOf(bob), identityOf(carol.me)]);
    for (const payload of [
      { v: 1, type: "text", id: "c1", text: "я тоже тут", sentAt: 1 },
      { v: 1, type: "reaction", id: message.id, emoji: "😢" },
      { v: 1, type: "edit", id: message.id, text: "взлом", editedAt: 2 },
    ]) {
      b.inbox.push({
        id: a.server.nextId++,
        from: { accountId: "acc-carol", deviceId: "dev-carol" },
        kind: "message",
        payload: await carol.engine.encrypt(chatId, utf8Encode(JSON.stringify(payload))),
        sentAt: 1,
      });
    }
    await b.deliver();
    expect((await b.messenger.messages(chatId)).map((m) => [m.text, m.reactions])).toEqual([["раз", {}]]);
  });
});

describe("photos and files", () => {
  function picked(phone: Phone, name: string, content: string, kind: OutgoingFile["kind"] = "image"): OutgoingFile {
    const uri = join(phone.files.dir, `picked-${name}`);
    writeFileSync(uri, content);
    return { uri, name, mime: kind === "image" ? "image/jpeg" : "application/pdf", size: Buffer.byteLength(content), kind, width: 800, height: 600, thumb: "dGh1bWI" };
  }

  it("sends a photo that arrives and downloads by itself, never readable on the server", async () => {
    const { a, b, server, chatId } = await chatting();
    const photo = await a.messenger.sendFile(chatId, picked(a, "cat.jpg", "мяу-мяу photo bytes"), "Смотри");
    expect(photo.attachment?.state).toBe("uploading");
    await b.deliver();
    await settle();

    const mine = (await a.messenger.messages(chatId))[0]!;
    expect(mine.attachment).toMatchObject({ state: "sent", blobId: expect.any(String), key: expect.any(String) });
    const [blob] = [...server.blobs.values()];
    expect(blob!.toString()).not.toContain("мяу");

    const theirs = (await b.messenger.messages(chatId))[0]!;
    expect(theirs).toMatchObject({ text: "Смотри", outgoing: false });
    expect(theirs.attachment).toMatchObject({ kind: "image", state: "ready", name: "cat.jpg", width: 800, thumb: "dGh1bWI" });
    expect(readFileSync(theirs.attachment!.localUri!, "utf8")).toBe("мяу-мяу photo bytes");
    expect((await b.messenger.conversation(chatId))?.lastText).toBe("Смотри");
  });

  it("downloads other files only when asked", async () => {
    const { a, b, chatId } = await chatting();
    await a.messenger.sendFile(chatId, picked(a, "договор.pdf", "%PDF секрет", "file"));
    await b.deliver();
    await settle();
    const [file] = await b.messenger.messages(chatId);
    expect(file!.attachment).toMatchObject({ state: "remote", localUri: null });
    expect((await b.messenger.conversation(chatId))?.lastText).toBe("📎 договор.pdf");

    await b.messenger.download(file!.id);
    const [ready] = await b.messenger.messages(chatId);
    expect(ready!.attachment?.state).toBe("ready");
    expect(readFileSync(ready!.attachment!.localUri!, "utf8")).toBe("%PDF секрет");
  });

  it("resumes an upload cut off by the network, and only then sends the message", async () => {
    const { a, b, server, chatId } = await chatting();
    a.online = false;
    await a.messenger.sendFile(chatId, picked(a, "late.jpg", "later"));
    await settle();
    expect((await a.messenger.messages(chatId))[0]!.attachment?.state).toBe("uploading");
    expect(server.blobs.size).toBe(0);

    a.online = true;
    await a.messenger.onAuthenticated(50);
    await settle();
    await b.deliver();
    await settle();
    expect((await b.messenger.messages(chatId))[0]!.attachment?.state).toBe("ready");
  });

  it("marks a failed upload and retries it on request", async () => {
    const { a, b, server, chatId } = await chatting();
    server.failUploads = true;
    const sent = await a.messenger.sendFile(chatId, picked(a, "x.jpg", "x"));
    await settle();
    expect((await a.messenger.message(sent.id))?.attachment?.state).toBe("failed");
    expect((await a.messenger.message(sent.id))?.status).toBe("failed");

    server.failUploads = false;
    await a.messenger.retryUpload(sent.id);
    await settle();
    expect((await a.messenger.message(sent.id))?.attachment?.state).toBe("sent");
    await b.deliver();
    expect(await b.messenger.messages(chatId)).toHaveLength(1);
  });

  it("refuses a tampered key and lets the person try again", async () => {
    const { a, b, server, chatId } = await chatting();
    await a.messenger.sendFile(chatId, picked(a, "doc.pdf", "data", "file"));
    await b.deliver();
    await settle();
    const [file] = await b.messenger.messages(chatId);
    server.blobs.set(file!.attachment!.blobId!, Buffer.from("garbage"));
    await b.messenger.download(file!.id);
    expect((await b.messenger.message(file!.id))?.attachment).toMatchObject({ state: "failed", localUri: null });
  });

  it("removes the file from the phone when the message is deleted", async () => {
    const { a, b, chatId } = await chatting();
    const sent = await a.messenger.sendFile(chatId, picked(a, "gone.jpg", "bye"));
    await b.deliver();
    await settle();
    const theirs = (await b.messenger.message(sent.id))!;
    expect(existsSync(theirs.attachment!.localUri!)).toBe(true);

    await a.messenger.deleteForEveryone(sent.id);
    await b.deliver();
    expect(existsSync(theirs.attachment!.localUri!)).toBe(false);
    expect(existsSync(sent.attachment!.localUri!)).toBe(false);
    expect((await b.messenger.message(sent.id))).toMatchObject({ deleted: true, attachment: null });
  });

  it("rejects files that are too big before doing any work", async () => {
    const { a, chatId } = await chatting();
    const file = { ...picked(a, "huge.bin", "x", "file"), size: 200 * 1024 * 1024 };
    await expect(a.messenger.sendFile(chatId, file)).rejects.toEqual(new MessengerError("too_large"));
  });
});

describe("groups", () => {
  const carolMe: Me = { accountId: "acc-carol", deviceId: "dev-carol", displayName: "Кэрол", username: "carol" };

  async function threePhones() {
    const server = new FakeServer();
    const a = new Phone(server, alice);
    const b = new Phone(server, bob);
    const c = new Phone(server, carolMe);
    for (const p of [a, b, c]) await p.messenger.onAuthenticated(0);
    const deliverAll = async () => {
      for (let i = 0; i < 3; i++) for (const p of [a, b, c]) await p.deliver();
    };
    return { server, a, b, c, deliverAll };
  }

  it("creates a group everyone sees with the same name and members", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id, skipped } = await a.messenger.createGroup("Команда 🚀", [asUser(bob), asUser(carolMe), asUser(bob)]);
    expect(skipped).toEqual([]);
    await deliverAll();

    for (const phone of [a, b, c]) {
      const chat = await phone.messenger.conversation(id);
      expect(chat).toMatchObject({ kind: "group", title: "Команда 🚀", version: 1, left: false });
      expect(chat!.members.map((m) => [m.username, m.role])).toEqual([
        ["alice", "admin"],
        ["bob", "member"],
        ["carol", "member"],
      ]);
    }

    await b.messenger.send(id, "Всем привет");
    await deliverAll();
    for (const phone of [a, c]) expect((await phone.messenger.messages(id)).map((m) => m.text)).toEqual(["Всем привет"]);
    // Opening a direct chat with Bob is a separate conversation, not the group.
    expect(await a.messenger.startChat(asUser(bob))).not.toBe(id);
  });

  it("only admins change the group, and their changes reach everyone", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Проект", [asUser(bob), asUser(carolMe)]);
    await deliverAll();

    await expect(b.messenger.renameGroup(id, "Мой проект")).rejects.toEqual(new MessengerError("not_allowed"));
    await expect(b.messenger.removeMember(id, "acc-carol")).rejects.toEqual(new MessengerError("not_allowed"));

    await a.messenger.renameGroup(id, "Проект Х");
    await a.messenger.setRole(id, "acc-bob", "admin");
    await deliverAll();
    expect(await c.messenger.conversation(id)).toMatchObject({ title: "Проект Х", version: 3 });

    // Bob is an admin now.
    await b.messenger.renameGroup(id, "Проект Y");
    await deliverAll();
    expect((await a.messenger.conversation(id))?.title).toBe("Проект Y");

    // The last admin cannot be demoted.
    await a.messenger.setRole(id, "acc-bob", "member");
    await deliverAll();
    await expect(a.messenger.setRole(id, "acc-alice", "member")).rejects.toEqual(new MessengerError("not_allowed"));
  });

  it("a removed member is told and cannot read what follows", async () => {
    const { a, b, c, server, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Тайна", [asUser(bob), asUser(carolMe)]);
    await deliverAll();

    await a.messenger.removeMember(id, "acc-carol");
    await deliverAll();
    expect(await c.messenger.conversation(id)).toMatchObject({ left: true });
    expect((await b.messenger.conversation(id))!.members.map((m) => m.username)).toEqual(["alice", "bob"]);

    const sendsBefore = server.sends.length;
    await a.messenger.send(id, "без Кэрол");
    await deliverAll();
    expect(server.sends.length).toBeGreaterThan(sendsBefore);
    expect((await b.messenger.messages(id)).map((m) => m.text)).toEqual(["без Кэрол"]);
    expect(await c.messenger.messages(id)).toEqual([]);
    await expect(c.messenger.send(id, "я тут?")).rejects.toEqual(new MessengerError("not_allowed"));
  });

  it("someone who leaves is removed by an admin's phone", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Чат", [asUser(bob), asUser(carolMe)]);
    await deliverAll();

    await c.messenger.leaveGroup(id);
    await deliverAll();
    expect(await c.messenger.conversation(id)).toMatchObject({ left: true });
    for (const phone of [a, b]) expect((await phone.messenger.conversation(id))!.members.map((m) => m.username)).toEqual(["alice", "bob"]);
    expect(a.engine.groups.get(id)).not.toContain(identityOf(carolMe));
  });

  it("the only admin leaving hands the group to someone else", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Чат", [asUser(bob), asUser(carolMe)]);
    await deliverAll();
    await a.messenger.leaveGroup(id);
    await deliverAll();
    const chat = await c.messenger.conversation(id);
    expect(chat!.members.filter((m) => m.role === "admin").map((m) => m.username)).toHaveLength(1);
    expect(chat!.members.map((m) => m.username)).not.toContain("alice");
  });

  it("adds people later; they see the group but not older messages", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Двое", [asUser(bob)]);
    await a.messenger.send(id, "до Кэрол");
    await deliverAll();

    await a.messenger.addMembers(id, [asUser(carolMe)]);
    await a.messenger.send(id, "привет, Кэрол");
    await deliverAll();
    expect(await c.messenger.conversation(id)).toMatchObject({ kind: "group", title: "Двое" });
    expect((await c.messenger.messages(id)).map((m) => m.text)).toEqual(["привет, Кэрол"]);
    expect((await b.messenger.conversation(id))!.members).toHaveLength(3);
  });

  it("ignores group changes from someone who is not an admin, and strangers' messages", async () => {
    const { a, b, c, deliverAll } = await threePhones();
    const { id } = await a.messenger.createGroup("Чат", [asUser(bob), asUser(carolMe)]);
    await deliverAll();
    // Bob's phone is tampered with and sends a group update anyway.
    const forged = { v: 1, type: "group_info", title: "Взломано", version: 99, members: [{ accountId: "acc-bob", displayName: "Боб", username: "bob", role: "admin" }] };
    c.inbox.push({
      id: c.server.nextId++,
      from: { accountId: "acc-bob", deviceId: "dev-bob" },
      kind: "message",
      payload: await b.engine.encrypt(id, utf8Encode(JSON.stringify(forged))),
      sentAt: 1,
    });
    await c.deliver();
    expect(await c.messenger.conversation(id)).toMatchObject({ title: "Чат", version: 1 });
  });

  it("people without a connected phone are skipped, not silently added", async () => {
    const server = new FakeServer();
    const a = new Phone(server, alice);
    const b = new Phone(server, bob);
    await b.messenger.onAuthenticated(0);
    const { id, skipped } = await a.messenger.createGroup("Чат", [asUser(bob), asUser(carolMe)]);
    expect(skipped.map((p) => p.username)).toEqual(["carol"]);
    expect((await a.messenger.conversation(id))!.members.map((m) => m.username)).toEqual(["alice", "bob"]);
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
