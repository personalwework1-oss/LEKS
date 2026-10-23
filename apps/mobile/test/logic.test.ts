import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { authMessage, fromBase64url } from "@leks/protocol";
import { ed25519 } from "@noble/curves/ed25519.js";
import { DeviceKey } from "../src/crypto/deviceKey";
import { checkPasscode, MAX_FAILURES, withPasscode } from "../src/lock/passcode";
import { passwordStrength } from "../src/passwordStrength";
import { avatarTint, initials } from "../src/theme";

const sha256 = async (text: string) => createHash("sha256").update(text).digest("hex");

describe("device key", () => {
  const vector = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/auth-vector.json"), "utf8")) as Record<string, string>;
  const hex = (name: string) => Uint8Array.from(Buffer.from(vector[name]!, "hex"));

  it("signs exactly like the Rust core and the server expect", () => {
    const key = DeviceKey.fromSecret(hex("seedHex"));
    expect(Buffer.from(fromBase64url(key.publicKey)).toString("hex")).toBe(vector.publicKeyHex);
    expect(Buffer.from(fromBase64url(key.signChallenge(hex("challengeHex")))).toString("hex")).toBe(vector.signatureHex);
  });

  it("generates working keys from random bytes", () => {
    const key = DeviceKey.generate((n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff));
    const challenge = new Uint8Array(32).fill(9);
    const signature = fromBase64url(key.signChallenge(challenge));
    expect(ed25519.verify(signature, authMessage(challenge), fromBase64url(key.publicKey))).toBe(true);
    expect(() => key.signChallenge(new Uint8Array(16))).toThrow();
  });
});

describe("passcode", () => {
  it("accepts the right code and resets failures", async () => {
    const lock = await withPasscode("passcode", "2580", "salt-1", sha256);
    const wrong = await checkPasscode("1111", lock, 0, sha256);
    expect(wrong.ok).toBe(false);
    expect(wrong.lock.failures).toBe(1);
    const right = await checkPasscode("2580", wrong.lock, 0, sha256);
    expect(right).toEqual({ ok: true, lock: { ...lock, failures: 0, blockedUntil: 0 } });
  });

  it("pauses after repeated wrong codes, longer each time", async () => {
    let lock = await withPasscode("biometric", "2580", "salt-2", sha256);
    let now = 1_000_000;
    const pauses: number[] = [];
    for (let series = 0; series < 3; series++) {
      for (let i = 0; i < MAX_FAILURES; i++) {
        const result = await checkPasscode("0000", lock, now, sha256);
        lock = result.lock;
        if (!result.ok && result.blockedForMs > 0) pauses.push(result.blockedForMs);
      }
      // While paused, even the right code is refused.
      expect((await checkPasscode("2580", lock, now + 1, sha256)).ok).toBe(false);
      now = lock.blockedUntil + 1;
    }
    expect(pauses).toEqual([30_000, 60_000, 120_000]);
    expect((await checkPasscode("2580", lock, now, sha256)).ok).toBe(true);
  });

  it("stores only a salted hash and rejects codes that are not 4 digits", async () => {
    const lock = await withPasscode("passcode", "1234", "salt-3", sha256);
    expect(JSON.stringify(lock)).not.toContain("1234");
    await expect(withPasscode("passcode", "12a4", "s", sha256)).rejects.toThrow();
    await expect(withPasscode("passcode", "12345", "s", sha256)).rejects.toThrow();
  });
});

describe("password strength", () => {
  it("matches the server's rule for what is allowed", () => {
    expect(passwordStrength("short").score).toBe(0);
    expect(passwordStrength("qwerty123").score).toBe(0);
    expect(passwordStrength("sanya_k1", "sanya_k1").score).toBe(0);
    expect(passwordStrength("kotik2024").score).toBe(1);
    expect(passwordStrength("Kotik-2024").score).toBe(2);
    expect(passwordStrength("Moscow-Rain-42").score).toBe(3);
  });
});

describe("avatars", () => {
  it("uses one or two initials and a stable color", () => {
    expect(initials("Александр")).toBe("А");
    expect(initials("christian wolf")).toBe("CW");
    expect(initials("  ")).toBe("?");
    expect(avatarTint("abc", "light")).toEqual(avatarTint("abc", "light"));
  });
});
