import { fromBase64url, toBase64url } from "@leks/protocol";

/** An error from the encryption core, with its code (see crates/leks-crypto/src/ffi.rs). */
export class EngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export type Received =
  | { kind: "message"; groupId: string; sender: string; plaintext: Uint8Array }
  | { kind: "group_updated" | "ignored"; groupId: string };

/** What the messenger needs from the encryption core. Group ids and MLS messages are base64url. */
export interface Engine {
  open(identity: string): Promise<{ groups: string[] }>;
  reset(): Promise<void>;
  keyPackages(count: number): Promise<string[]>;
  createGroup(): Promise<string>;
  addMember(groupId: string, keyPackage: string): Promise<{ commit: string; welcome: string }>;
  join(welcome: string): Promise<string>;
  encrypt(groupId: string, plaintext: Uint8Array): Promise<string>;
  receive(message: string): Promise<Received>;
  members(groupId: string): Promise<string[]>;
  /** Removes devices ("accountId:deviceId") from the group; returns the commit for everyone who was in it. */
  removeMembers(groupId: string, identities: string[]): Promise<string>;
  /** Whether this device is still in the group, and who is. */
  groupState(groupId: string): Promise<{ active: boolean; members: string[] }>;
  /** Deletes the group's keys from this device. */
  forgetGroup(groupId: string): Promise<void>;
  /** Encrypts a file with a new key (base64url); returns the key and the encrypted size. */
  encryptFile(inputUri: string, outputUri: string): Promise<{ key: string; size: number }>;
  decryptFile(inputUri: string, outputUri: string, key: string): Promise<void>;
}

/** The core works with plain paths; the app with file:// URIs. */
export function uriToPath(uri: string): string {
  return uri.startsWith("file://") ? decodeURIComponent(uri.slice("file://".length)) : uri;
}

/** The Rust core through its JSON interface; `call` is the native module's entry point. */
export class NativeEngine implements Engine {
  constructor(
    private readonly call: (request: string) => Promise<string>,
    private readonly statePath: string,
  ) {}

  private async run<T>(request: Record<string, unknown>): Promise<T> {
    const response = JSON.parse(await this.call(JSON.stringify(request))) as
      | { ok: T }
      | { error: { code: string; message: string } };
    if ("error" in response) throw new EngineError(response.error.code, response.error.message);
    return response.ok;
  }

  open(identity: string) {
    return this.run<{ groups: string[] }>({ op: "open", path: this.statePath, identity });
  }
  async reset() {
    await this.run({ op: "reset", path: this.statePath });
  }
  async keyPackages(count: number) {
    return (await this.run<{ keyPackages: string[] }>({ op: "key_packages", count })).keyPackages;
  }
  async createGroup() {
    return (await this.run<{ groupId: string }>({ op: "create_group" })).groupId;
  }
  addMember(groupId: string, keyPackage: string) {
    return this.run<{ commit: string; welcome: string }>({ op: "add_member", groupId, keyPackage });
  }
  async join(welcome: string) {
    return (await this.run<{ groupId: string }>({ op: "join", welcome })).groupId;
  }
  async encrypt(groupId: string, plaintext: Uint8Array) {
    return (await this.run<{ ciphertext: string }>({ op: "encrypt", groupId, plaintext: toBase64url(plaintext) })).ciphertext;
  }
  async receive(message: string): Promise<Received> {
    const result = await this.run<{ kind: string; groupId: string; sender?: string; plaintext?: string }>({ op: "receive", message });
    if (result.kind === "message") {
      return { kind: "message", groupId: result.groupId, sender: result.sender ?? "", plaintext: fromBase64url(result.plaintext ?? "") };
    }
    return { kind: result.kind === "group_updated" ? "group_updated" : "ignored", groupId: result.groupId };
  }
  async members(groupId: string) {
    return (await this.run<{ members: string[] }>({ op: "members", groupId })).members;
  }
  async removeMembers(groupId: string, identities: string[]) {
    return (await this.run<{ commit: string }>({ op: "remove_members", groupId, identities })).commit;
  }
  groupState(groupId: string) {
    return this.run<{ active: boolean; members: string[] }>({ op: "group_state", groupId });
  }
  async forgetGroup(groupId: string) {
    await this.run({ op: "forget_group", groupId });
  }
  encryptFile(inputUri: string, outputUri: string) {
    return this.run<{ key: string; size: number }>({ op: "encrypt_file", input: uriToPath(inputUri), output: uriToPath(outputUri) });
  }
  async decryptFile(inputUri: string, outputUri: string, key: string) {
    await this.run({ op: "decrypt_file", input: uriToPath(inputUri), output: uriToPath(outputUri), key });
  }
}

// UTF-8 helpers that do not depend on TextEncoder/TextDecoder being present.
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let code: number;
    let extra: number;
    if (b < 0x80) [code, extra] = [b, 0];
    else if (b >> 5 === 6) [code, extra] = [b & 31, 1];
    else if (b >> 4 === 14) [code, extra] = [b & 15, 2];
    else if (b >> 3 === 30) [code, extra] = [b & 7, 3];
    else [code, extra] = [0xfffd, 0];
    i += 1;
    for (let k = 0; k < extra; k++, i++) {
      const next = bytes[i];
      if (next === undefined || next >> 6 !== 2) {
        code = 0xfffd;
        break;
      }
      code = (code << 6) | (next & 63);
    }
    out += String.fromCodePoint(code);
  }
  return out;
}
