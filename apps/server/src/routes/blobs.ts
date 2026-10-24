import { createHash, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import { type HttpErrorCode, Id, MAX_BLOB_BYTES } from "@leks/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type BlobStorage, SizeMismatchError } from "../blobs.js";
import type { Store } from "../store.js";

export const hashUploadToken = (token: string) => createHash("sha256").update(token, "utf8").digest();

function fail(reply: FastifyReply, status: number, error: HttpErrorCode) {
  return reply.code(status).send({ error });
}

/**
 * Upload and download of encrypted files.
 *
 * Upload needs the one-time token from `request_upload` (over the signed-in
 * WebSocket). Download needs only the blob id: it is a random UUID that only
 * the people in the chat learn, and the content is encrypted anyway.
 */
export function blobRoutes(app: FastifyInstance, store: Store, storage: BlobStorage) {
  // The body is streamed to disk, never buffered in memory.
  app.addContentTypeParser("application/octet-stream", { bodyLimit: MAX_BLOB_BYTES }, (_request, payload, done) => done(null, payload));

  app.put<{ Params: { blobId: string } }>("/v1/blobs/:blobId", { bodyLimit: MAX_BLOB_BYTES }, async (request, reply) => {
    const id = Id.safeParse(request.params.blobId);
    const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(request.headers.authorization ?? "")?.[1];
    if (!id.success || !token) return fail(reply, 400, "invalid_request");

    const blob = await store.blob(id.data);
    const expected = blob?.tokenHash;
    const valid =
      !!blob &&
      !!expected &&
      !blob.uploadedAt &&
      !!blob.tokenExpiresAt &&
      blob.tokenExpiresAt > new Date() &&
      timingSafeEqual(expected, hashUploadToken(token));
    if (!valid) return fail(reply, 403, "upload_failed");
    if (Number(request.headers["content-length"]) !== blob.size) return fail(reply, 400, "invalid_request");

    try {
      await storage.write(blob.id, request.body as Readable, blob.size);
    } catch (error) {
      if (error instanceof SizeMismatchError) return fail(reply, 400, "upload_failed");
      throw error;
    }
    if (!(await store.completeBlob(blob.id))) return fail(reply, 403, "upload_failed");
    return reply.code(204).send();
  });

  app.get<{ Params: { blobId: string } }>("/v1/blobs/:blobId", async (request, reply) => {
    const id = Id.safeParse(request.params.blobId);
    if (!id.success) return fail(reply, 404, "not_found");
    const blob = await store.blob(id.data);
    if (!blob?.uploadedAt || !(await storage.exists(blob.id))) return fail(reply, 404, "not_found");
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-length", String(blob.size))
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(storage.read(blob.id));
  });
}
