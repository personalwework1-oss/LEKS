import { describe, expect, it } from "vitest";
import { ClientFrame, PROTOCOL_VERSION, ServerFrame } from "../src/index.js";

describe("ClientFrame", () => {
  it("accepts a valid hello", () => {
    const frame = ClientFrame.parse({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      client: { platform: "ios", version: "0.1.0" },
    });
    expect(frame.type).toBe("hello");
  });

  it("rejects unknown frame types", () => {
    expect(ClientFrame.safeParse({ type: "delete_everything" }).success).toBe(false);
  });

  it("rejects an unknown platform", () => {
    const result = ClientFrame.safeParse({
      type: "hello",
      protocol: 1,
      client: { platform: "windows-phone", version: "1" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized nonces", () => {
    expect(ClientFrame.safeParse({ type: "ping", nonce: "x".repeat(65) }).success).toBe(false);
  });
});

describe("ServerFrame", () => {
  it("accepts a pong", () => {
    expect(ServerFrame.parse({ type: "pong", nonce: "abc" })).toEqual({ type: "pong", nonce: "abc" });
  });

  it("only allows known error codes", () => {
    expect(ServerFrame.safeParse({ type: "error", code: "something_else" }).success).toBe(false);
  });
});
