import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAILY_UPLOAD_BYTES } from "@leks/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { databaseUrl, freshDatabase, register, TestClient } from "./helpers.js";

describe.skipIf(!databaseUrl)("encrypted files", () => {
  let pool: Awaited<ReturnType<typeof freshDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "leks-blobs-test-"));
    pool = await freshDatabase();
    app = await buildApp({ pool, purgeIntervalMs: 0, blobDir: dir });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(dir, { recursive: true, force: true });
  });

  async function ticket(client: TestClient, size: number) {
    client.send({ type: "request_upload", requestId: "u", size });
    return client.next("upload_ready");
  }

  const put = (blobId: string, token: string, body: Buffer, length = body.length) =>
    app.inject({
      method: "PUT",
      url: `/v1/blobs/${blobId}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "content-length": String(length) },
      payload: body,
    });

  it("uploads once with the token and downloads by id", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    const body = randomBytes(300_000);
    const { blobId, token } = await ticket(client, body.length);

    // Not downloadable before the upload finishes.
    expect((await app.inject({ method: "GET", url: `/v1/blobs/${blobId}` })).statusCode).toBe(404);

    expect((await put(blobId, token, body)).statusCode).toBe(204);
    const download = await app.inject({ method: "GET", url: `/v1/blobs/${blobId}` });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(body)).toBe(true);
    expect(download.headers["content-type"]).toBe("application/octet-stream");

    // The token works once.
    expect((await put(blobId, token, body)).statusCode).toBe(403);
    client.close();
  });

  it("refuses wrong tokens, other blobs and sizes that do not match", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    const body = randomBytes(1000);
    const first = await ticket(client, body.length);
    const second = await ticket(client, body.length);

    expect((await put(first.blobId, "x".repeat(43), body)).statusCode).toBe(403);
    expect((await put(first.blobId, second.token, body)).statusCode).toBe(403);
    expect((await put(randomUUID(), first.token, body)).statusCode).toBe(403);
    expect((await put(first.blobId, first.token, body.subarray(0, 999))).statusCode).toBe(400);
    expect((await put("not-a-uuid", first.token, body)).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "PUT", url: `/v1/blobs/${first.blobId}`, headers: { "content-type": "application/octet-stream" }, payload: body })).statusCode,
    ).toBe(400);

    // A failed attempt does not burn the token.
    expect((await put(first.blobId, first.token, body)).statusCode).toBe(204);
    client.close();
  });

  it("keeps each device within its daily allowance", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    const big = 100 * 1024 * 1024;
    const allowed = Math.floor(DAILY_UPLOAD_BYTES / big);
    for (let i = 0; i < allowed; i++) await ticket(client, big);
    client.send({ type: "request_upload", requestId: "over", size: big });
    expect(await client.next("error")).toEqual({ type: "error", code: "upload_quota_exceeded", requestId: "over" });
    client.send({ type: "request_upload", requestId: "huge", size: big + 1 });
    expect(await client.next("error")).toMatchObject({ code: "bad_frame" });
    client.close();
  });

  it("deletes old files and abandoned uploads", async () => {
    const { session, key } = await register(app);
    const client = await TestClient.signedIn(app, session, key);
    const body = randomBytes(10);
    const done = await ticket(client, body.length);
    await put(done.blobId, done.token, body);
    const abandoned = await ticket(client, 10);
    await pool.query("UPDATE blobs SET created_at = now() - interval '31 days' WHERE id = $1", [done.blobId]);
    await pool.query("UPDATE blobs SET token_expires_at = now() - interval '2 hours' WHERE id = $1", [abandoned.blobId]);

    const purged = await app.store.purgeBlobs(30);
    expect(purged.sort()).toEqual([done.blobId, abandoned.blobId].sort());
    for (const id of purged) await app.blobs.remove(id);
    expect((await app.inject({ method: "GET", url: `/v1/blobs/${done.blobId}` })).statusCode).toBe(404);
    expect(await app.blobs.exists(done.blobId)).toBe(false);
    client.close();
  });

  it("needs sign-in to ask for an upload", async () => {
    const client = await TestClient.open(app);
    await client.hello();
    client.send({ type: "request_upload", requestId: "r", size: 10 });
    expect(await client.next("error")).toEqual({ type: "error", code: "auth_required", requestId: "r" });
    client.close();
  });
});
