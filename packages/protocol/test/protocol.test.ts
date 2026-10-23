import { describe, expect, it } from "vitest";
import {
  AUTH_CONTEXT,
  authMessage,
  ClientFrame,
  fromBase64url,
  PROTOCOL_VERSION,
  RecoveryCode,
  RegisterRequest,
  ServerFrame,
  toBase64url,
  Username,
} from "../src/index.js";

describe("base64url", () => {
  it("round-trips every length and matches Node's encoder", () => {
    for (let length = 0; length < 70; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 0xff);
      const text = toBase64url(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64url"));
      expect(fromBase64url(text)).toEqual(bytes);
    }
  });

  it("rejects invalid input", () => {
    expect(() => fromBase64url("a+b/")).toThrow();
    expect(() => fromBase64url("abcde")).toThrow();
  });
});

describe("authMessage", () => {
  it("prefixes the challenge with the auth context", () => {
    const message = authMessage(new Uint8Array([1, 2, 3]));
    expect(Buffer.from(message).toString("latin1")).toBe(`${AUTH_CONTEXT}\x01\x02\x03`);
  });
});

describe("registration", () => {
  const device = { platform: "ios", authPublicKey: "A".repeat(43) };

  it("lowercases and trims usernames", () => {
    expect(Username.parse("  Alice_1 ")).toBe("alice_1");
  });

  it("rejects bad usernames", () => {
    for (const username of ["ab", "with space", "кириллица", "x".repeat(33), "dash-name"]) {
      expect(RegisterRequest.safeParse({ username, displayName: "A", device }).success).toBe(false);
    }
  });

  it("accepts a valid request", () => {
    expect(RegisterRequest.safeParse({ username: "alice", displayName: "Алиса", device }).success).toBe(true);
  });

  it("normalizes recovery codes", () => {
    expect(RecoveryCode.parse(" abcd-efgh-ijkl-mnop-qrst ")).toBe("ABCD-EFGH-IJKL-MNOP-QRST");
    expect(RecoveryCode.safeParse("ABCD-EFGH").success).toBe(false);
    expect(RecoveryCode.safeParse("ABC1-EFGH-IJKL-MNOP-QRST").success).toBe(false);
  });
});

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

  it("rejects payloads that are not base64url", () => {
    const result = ClientFrame.safeParse({
      type: "send",
      id: "6f1c1b7e-2f7a-4d3b-9a51-0c3c1a3b9d10",
      recipients: ["6f1c1b7e-2f7a-4d3b-9a51-0c3c1a3b9d11"],
      kind: "message",
      payload: "not base64!",
    });
    expect(result.success).toBe(false);
  });

  it("limits how many key packages are published at once", () => {
    const frame = { type: "publish_key_packages", requestId: "r", keyPackages: Array(101).fill("AAAA") };
    expect(ClientFrame.safeParse(frame).success).toBe(false);
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
