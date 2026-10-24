import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { AccountSession } from "@leks/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { databaseUrl, type DeviceKey, freshDatabase, register, TestClient } from "./helpers.js";

/** Path to the built `leks-crypto-cli` (the phone's encryption core); set in CI. */
const cli = process.env.LEKS_CRYPTO_CLI;

const text = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const untext = (value: string) => Buffer.from(value, "base64url").toString("utf8");

/** One phone's encryption core, in its own process, talking JSON lines. */
class Core {
  private readonly lines: Interface;
  private readonly waiting: ((line: string) => void)[] = [];

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.waiting.shift()?.(line));
  }

  static async start(dir: string, session: AccountSession): Promise<Core> {
    const core = new Core(spawn(cli!, [], { stdio: ["pipe", "pipe", "pipe"] }));
    await core.call({ op: "open", path: join(dir, `${session.deviceId}.mls`), identity: `${session.accountId}:${session.deviceId}` });
    return core;
  }

  async call<T = Record<string, unknown>>(request: Record<string, unknown>): Promise<T> {
    const line = new Promise<string>((resolve) => this.waiting.push(resolve));
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
    const response = JSON.parse(await line) as { ok?: T; error?: { code: string; message: string } };
    if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response.ok as T;
  }

  stop() {
    this.lines.close();
    this.child.kill();
  }
}

interface Phone {
  session: AccountSession;
  key: DeviceKey;
  core: Core;
  ws: TestClient;
}

describe.skipIf(!databaseUrl || !cli)("end to end: real encryption through the real server", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let dir: string;
  const phones: Phone[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "leks-e2e-"));
    pool = await freshDatabase();
    app = await buildApp({ pool, purgeIntervalMs: 0 });
    await app.ready();
  });

  afterAll(async () => {
    for (const phone of phones) {
      phone.core.stop();
      phone.ws.close();
    }
    await app?.close();
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  async function phone(username: string): Promise<Phone> {
    const { session, key } = await register(app, username);
    const core = await Core.start(dir, session);
    const ws = await TestClient.signedIn(app, session, key);
    const { keyPackages } = await core.call<{ keyPackages: string[] }>({ op: "key_packages", count: 5 });
    ws.send({ type: "publish_key_packages", requestId: "kp", keyPackages });
    await ws.next("key_packages_published");
    const created = { session, key, core, ws };
    phones.push(created);
    return created;
  }

  async function send(from: Phone, to: Phone[], kind: "welcome" | "commit" | "message", payload: string) {
    const id = randomUUID();
    from.ws.send({ type: "send", id, recipients: to.map((p) => p.session.deviceId), kind, payload });
    const sent = await from.ws.next("sent");
    expect(sent.accepted).toHaveLength(to.length);
  }

  async function receive(phone: Phone) {
    const { messages } = await phone.ws.next("deliver");
    phone.ws.send({ type: "ack", ids: messages.map((m) => m.id) });
    return messages;
  }

  it("two people start a chat and talk; the server only ever sees ciphertext", async () => {
    const alice = await phone("e2e_alice");
    const bob = await phone("e2e_bob");

    // Alice invites Bob using one of his published key packages.
    alice.ws.send({ type: "claim_key_packages", requestId: "c", accountId: bob.session.accountId });
    const claimed = await alice.ws.next("key_packages");
    expect(claimed.items).toHaveLength(1);
    const { groupId } = await alice.core.call<{ groupId: string }>({ op: "create_group" });
    const invite = await alice.core.call<{ welcome: string }>({ op: "add_member", groupId, keyPackage: claimed.items[0]!.keyPackage });
    await send(alice, [bob], "welcome", invite.welcome);

    const [welcome] = await receive(bob);
    expect(welcome!.kind).toBe("welcome");
    const joined = await bob.core.call<{ groupId: string }>({ op: "join", welcome: welcome!.payload });
    expect(joined.groupId).toBe(groupId);
    const members = await bob.core.call<{ members: string[] }>({ op: "members", groupId });
    expect(members.members.sort()).toEqual(
      [`${alice.session.accountId}:${alice.session.deviceId}`, `${bob.session.accountId}:${bob.session.deviceId}`].sort(),
    );

    // A conversation in both directions, with Cyrillic and emoji.
    const lines: [Phone, Phone, string][] = [
      [alice, bob, "Привет, Боб! 👋"],
      [bob, alice, "Привет! Всё зашифровано?"],
      [alice, bob, "Да, сервер видит только шифротекст."],
    ];
    for (const [from, to, line] of lines) {
      const { ciphertext } = await from.core.call<{ ciphertext: string }>({ op: "encrypt", groupId, plaintext: text(line) });
      expect(untext(ciphertext)).not.toContain(line);
      await send(from, [to], "message", ciphertext);

      const [delivered] = await receive(to);
      expect(delivered!.payload).toBe(ciphertext);
      const opened = await to.core.call<{ kind: string; sender: string; plaintext: string }>({ op: "receive", message: delivered!.payload });
      expect(opened.kind).toBe("message");
      expect(opened.sender).toBe(`${from.session.accountId}:${from.session.deviceId}`);
      expect(untext(opened.plaintext)).toBe(line);
    }

    // Nothing readable was ever stored on the server.
    const { rows } = await pool.query<{ payload: Buffer | string }>("SELECT payload FROM message_queue");
    for (const row of rows) {
      const stored = Buffer.isBuffer(row.payload) ? row.payload.toString("utf8") : String(row.payload);
      for (const [, , line] of lines) expect(stored).not.toContain(line);
    }
  });

  it("an eavesdropper on the server cannot read the chat", async () => {
    const alice = await phone("e2e_carol");
    const bob = await phone("e2e_dave");
    const eve = await phone("e2e_eve");

    alice.ws.send({ type: "claim_key_packages", requestId: "c", accountId: bob.session.accountId });
    const claimed = await alice.ws.next("key_packages");
    const { groupId } = await alice.core.call<{ groupId: string }>({ op: "create_group" });
    const invite = await alice.core.call<{ welcome: string }>({ op: "add_member", groupId, keyPackage: claimed.items[0]!.keyPackage });
    await send(alice, [bob], "welcome", invite.welcome);
    await bob.core.call({ op: "join", welcome: (await receive(bob))[0]!.payload });

    const { ciphertext } = await alice.core.call<{ ciphertext: string }>({ op: "encrypt", groupId, plaintext: text("секрет") });
    // Eve gets a copy of the bytes (as a compromised server could) but is not in the group.
    await send(alice, [eve], "message", ciphertext);
    const [copy] = await receive(eve);
    await expect(eve.core.call({ op: "receive", message: copy!.payload })).rejects.toThrow();
    await expect(eve.core.call({ op: "join", welcome: invite.welcome })).rejects.toThrow();
  });
});
