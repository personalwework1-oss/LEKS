import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { databaseUrl, freshDatabase, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("blocking and reports", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "leks-safety-"));
    pool = await freshDatabase();
    app = await buildApp({ pool, purgeIntervalMs: 0, blobDir: dir });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  async function pair(prefix: string) {
    const a = await register(app, `${prefix}_a`);
    const b = await register(app, `${prefix}_b`);
    return {
      a,
      b,
      ac: await TestClient.signedIn(app, a.session, a.key),
      bc: await TestClient.signedIn(app, b.session, b.key),
    };
  }

  it("a blocked person's messages and new chats do not reach me; commits still do", async () => {
    const { a, b, ac, bc } = await pair("blk");
    bc.send({ type: "block", requestId: "b", accountId: a.session.accountId });
    await bc.next("blocked");
    bc.send({ type: "list_blocks", requestId: "l" });
    expect((await bc.next("blocks")).accountIds).toEqual([a.session.accountId]);

    ac.send({ type: "send", id: "00000000-0000-4000-8000-000000000001", recipients: [b.session.deviceId], kind: "message", payload: "aGk" });
    expect((await ac.next("sent")).accepted).toEqual([b.session.deviceId]);
    ac.send({ type: "send", id: "00000000-0000-4000-8000-000000000002", recipients: [b.session.deviceId], kind: "commit", payload: "Y29t" });
    await ac.next("sent");
    const delivered = await bc.next("deliver");
    expect(delivered.messages.map((m) => m.kind)).toEqual(["commit"]);

    ac.send({ type: "claim_key_packages", requestId: "k", accountId: b.session.accountId });
    expect((await ac.next("key_packages")).items).toEqual([]);

    bc.send({ type: "unblock", requestId: "u", accountId: a.session.accountId });
    await bc.next("unblocked");
    bc.send({ type: "list_blocks", requestId: "l2" });
    expect((await bc.next("blocks")).accountIds).toEqual([]);
    ac.close();
    bc.close();
  });

  it("several people reporting an account stop it from starting new chats", async () => {
    const spammer = await register(app, "spam_x");
    const sc = await TestClient.signedIn(app, spammer.session, spammer.key);
    for (const n of [1, 2, 3]) {
      const victim = await register(app, `victim_${n}`);
      const vc = await TestClient.signedIn(app, victim.session, victim.key);
      vc.send({ type: "report", requestId: "r", accountId: spammer.session.accountId, reason: "spam", messages: [{ text: "купи крипту", sentAt: 1 }] });
      await vc.next("reported");
      vc.close();
    }
    const { rows } = await pool.query("SELECT evidence FROM reports WHERE reported_id = $1", [spammer.session.accountId]);
    expect(rows).toHaveLength(3);
    const fresh = await register(app, "victim_4");
    sc.send({ type: "claim_key_packages", requestId: "k", accountId: fresh.session.accountId });
    expect((await sc.next("error")).code).toBe("new_chats_limited");
    sc.close();
  });
});
