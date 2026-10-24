import { z } from "zod";

const Env = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Where encrypted files are kept. */
  BLOB_DIR: z.string().min(1).default("./data/blobs"),
  /** Calls: the media server's public wss:// address and its API key pair (all three or none). */
  LIVEKIT_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1).optional(),
  LIVEKIT_API_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env>;

/** Reads and validates settings from environment variables; fails fast on mistakes. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
