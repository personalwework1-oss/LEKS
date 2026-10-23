/**
 * Wire protocol between the apps and the server.
 *
 * Every frame on the WebSocket is a JSON object with a `type` field. The
 * schemas below are the single source of truth: the server validates every
 * incoming frame against them, and the apps use the same types, so the two
 * sides cannot drift apart.
 *
 * Chat content never appears here in readable form: it travels as encrypted
 * MLS bytes produced on the device.
 */
import { z } from "zod";

/** Bumped whenever a change would break older apps. */
export const PROTOCOL_VERSION = 1;

/** Largest WebSocket frame the server accepts, in bytes. */
export const MAX_FRAME_BYTES = 256 * 1024;

const Nonce = z.string().min(1).max(64);

export const ClientPlatform = z.enum(["ios", "android", "test"]);
export type ClientPlatform = z.infer<typeof ClientPlatform>;

/** Frames the apps send to the server. */
export const ClientFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.number().int().positive(),
    client: z.object({
      platform: ClientPlatform,
      version: z.string().min(1).max(32),
    }),
  }),
  z.object({
    type: z.literal("ping"),
    nonce: Nonce,
  }),
]);
export type ClientFrame = z.infer<typeof ClientFrame>;

export const ErrorCode = z.enum(["bad_json", "bad_frame", "unsupported_protocol", "hello_required"]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Frames the server sends to the apps. */
export const ServerFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocol: z.number().int().positive(),
    serverTime: z.number().int(),
  }),
  z.object({
    type: z.literal("pong"),
    nonce: Nonce,
  }),
  z.object({
    type: z.literal("error"),
    code: ErrorCode,
  }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** WebSocket close codes used by the server (4000–4999 is the app range). */
export const CloseCode = {
  UnsupportedProtocol: 4000,
} as const;
