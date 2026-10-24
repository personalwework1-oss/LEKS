import { requireOptionalNativeModule } from "expo";

export interface LeksCryptoNative {
  stateDirectory(): string;
  call(request: string): Promise<string>;
}

/**
 * The Rust encryption core, reached through the native module of this folder.
 * null where the native code is not built in (tests, Expo Go).
 */
export const LeksCrypto = requireOptionalNativeModule<LeksCryptoNative>("LeksCrypto");
