import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DeviceKey, databaseUrl, freshDatabase, PASSWORD, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("devices and backups", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "leks-devices-"));
    pool = await freshDatabase();
    app = await buildApp({ pool, purgeIntervalMs: 0, blobDir: dir });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  async function secondDevice(username: string) {
    const key = new DeviceKey();
    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { username, password: PASSWORD, device: { platform: "android", authPublicKey: key.publicKey } },
    });
    expect(response.statusCode).toBe(201);
    return { session: response.json(), key };
  }

  it("lists an account's devices; details only for my own", async () => {
    const alice = await register(app, "dev_alice");
    const second = await secondDevice("dev_alice");
    const bob = await register(app, "dev_bob");
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);

    aliceClient.send({ type: "list_devices", requestId: "l", accountId: alice.session.accountId });
    const own = await aliceClient.next("devices");
    expect(own.devices.map((d) => d.deviceId).sort()).toEqual([alice.session.deviceId, second.session.deviceId].sort());
    expect(own.devices.find((d) => d.deviceId === alice.session.deviceId)?.lastSeenAt).toEqual(expect.any(Number));

    bobClient.send({ type: "list_devices", requestId: "l", accountId: alice.session.accountId });
    const theirs = await bobClient.next("devices");
    expect(theirs.devices).toHaveLength(2);
    expect(theirs.devices.every((d) => d.lastSeenAt === null && d.platform === "")).toBe(true);
    aliceClient.close();
    bobClient.close();
  });

  it("changes the name others find me by", async () => {
    const alice = await register(app, "name_alice");
    const bob = await register(app, "name_bob");
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    aliceClient.send({ type: "update_profile", requestId: "p", displayName: "Алиса Новая" });
    await aliceClient.next("profile_updated");
    bobClient.send({ type: "lookup_user", requestId: "u", username: "name_alice" });
    expect((await bobClient.next("user")).user?.displayName).toBe("Алиса Новая");
    aliceClient.close();
    bobClient.close();
  });

  it("removes my own other device and signs it out, but nobody else's", async () => {
    const alice = await register(app, "rm_alice");
    const second = await secondDevice("rm_alice");
    const bob = await register(app, "rm_bob");
    const secondClient = await TestClient.signedIn(app, second.session, second.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    bobClient.send({ type: "remove_device", requestId: "x", deviceId: second.session.deviceId });
    expect(await bobClient.next("error")).toMatchObject({ code: "not_found" });

    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    aliceClient.send({ type: "remove_device", requestId: "self", deviceId: alice.session.deviceId });
    expect(await aliceClient.next("error")).toMatchObject({ code: "not_found" });
    aliceClient.send({ type: "remove_device", requestId: "r", deviceId: second.session.deviceId });
    await aliceClient.next("device_removed");
    expect(await secondClient.closed).toBe(4002);
    aliceClient.close();
    bobClient.close();
  });

  it("passes a nudge to online devices, saying only which account it is from", async () => {
    const alice = await register(app, "ndg_alice");
    const bob = await register(app, "ndg_bob");
    const aliceClient = await TestClient.signedIn(app, alice.session, alice.key);
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    aliceClient.send({ type: "nudge", deviceIds: [bob.session.deviceId] });
    expect(await bobClient.next("nudge")).toEqual({ type: "nudge", accountId: alice.session.accountId });
    aliceClient.close();
    bobClient.close();
  });

  it("deletes devices not seen for 30 days, keeping the rest", async () => {
    const old = await register(app, "old_phone");
    const fresh = await register(app, "new_phone");
    await pool.query("UPDATE devices SET last_seen_at = now() - interval '31 days' WHERE id = $1", [old.session.deviceId]);
    await pool.query("UPDATE devices SET last_seen_at = now() WHERE id = $1", [fresh.session.deviceId]);
    const purged = await app.store.purgeDevices(30);
    expect(purged).toContain(old.session.deviceId);
    expect(purged).not.toContain(fresh.session.deviceId);
  });

  it("keeps one backup per account, replacing the old one, never purged while current", async () => {
    const { session, key } = await register(app, "bk_alice");
    const client = await TestClient.signedIn(app, session, key);
    const upload = async () => {
      const body = randomBytes(500);
      client.send({ type: "request_upload", requestId: "u", size: body.length });
      const { blobId, token } = await client.next("upload_ready");
      await app.inject({
        method: "PUT",
        url: `/v1/blobs/${blobId}`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "content-length": String(body.length) },
        payload: body,
      });
      return blobId;
    };

    client.send({ type: "get_backup", requestId: "g" });
    expect((await client.next("backup")).backup).toBeNull();

    const first = await upload();
    client.send({ type: "set_backup", requestId: "s", blobId: first, wrappedKey: "sealed-1" });
    await client.next("backup_saved");
    await pool.query("UPDATE blobs SET created_at = now() - interval '90 days' WHERE id = $1", [first]);
    expect(await app.store.purgeBlobs(30)).not.toContain(first);

    const second = await upload();
    client.send({ type: "set_backup", requestId: "s2", blobId: second, wrappedKey: "sealed-2" });
    await client.next("backup_saved");
    client.send({ type: "get_backup", requestId: "g2" });
    expect((await client.next("backup")).backup).toMatchObject({ blobId: second, wrappedKey: "sealed-2", size: 500 });
    expect(await app.store.purgeBlobs(30)).toContain(first);

    // Someone else's upload cannot become my backup.
    const bob = await register(app, "bk_bob");
    const bobClient = await TestClient.signedIn(app, bob.session, bob.key);
    bobClient.send({ type: "set_backup", requestId: "s", blobId: second, wrappedKey: "x" });
    expect(await bobClient.next("error")).toMatchObject({ code: "not_found" });
    client.close();
    bobClient.close();
  });
});
