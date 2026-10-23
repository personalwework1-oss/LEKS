import { ed25519 } from "@noble/curves/ed25519.js";
import { authMessage, toBase64url } from "@leks/protocol";

/**
 * The key this phone signs in to the server with. The private half never
 * leaves the phone: it is kept in the iOS Keychain / Android Keystore
 * (see storage/secure.ts). Signatures match the Rust core and the server
 * byte for byte; the shared test vector in fixtures/auth-vector.json checks it.
 */
export class DeviceKey {
  private constructor(private readonly secret: Uint8Array) {}

  /** `randomBytes` must be a cryptographically secure source (expo-crypto in the app). */
  static generate(randomBytes: (length: number) => Uint8Array): DeviceKey {
    const secret = randomBytes(32);
    if (secret.length !== 32) throw new Error("expected 32 random bytes");
    return new DeviceKey(secret);
  }

  static fromSecret(secret: Uint8Array): DeviceKey {
    if (secret.length !== 32) throw new Error("device key must be 32 bytes");
    return new DeviceKey(Uint8Array.from(secret));
  }

  get secretBytes(): Uint8Array {
    return Uint8Array.from(this.secret);
  }

  /** Public key, base64url, as sent at registration. */
  get publicKey(): string {
    return toBase64url(ed25519.getPublicKey(this.secret));
  }

  /** Signs the server's sign-in challenge; returns the signature, base64url. */
  signChallenge(challenge: Uint8Array): string {
    if (challenge.length !== 32) throw new Error("challenge must be 32 bytes");
    return toBase64url(ed25519.sign(authMessage(challenge), this.secret));
  }
}
