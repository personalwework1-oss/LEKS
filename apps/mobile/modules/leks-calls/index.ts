import { requireOptionalNativeModule } from "expo";

/** Android only: the ringing full-screen call notification. Null on iPhone and in tests. */
export interface LeksCallsNative {
  showIncomingCall(title: string, text: string): void;
  cancelIncomingCall(): void;
  takePendingAction(): "answer" | "decline" | null;
  setShowOverLockScreen(on: boolean): void;
  canCoverLockScreen(): boolean;
  openFullScreenSettings(): void;
}

export const LeksCalls = requireOptionalNativeModule<LeksCallsNative>("LeksCalls");
