import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { type AccountSession, toBase64url } from "@leks/protocol";
import { ApiError, HttpApi } from "../api/http";
import { backupIfDue, rememberBackupKey } from "../backup";
import { signInSecret } from "../crypto/passwordKeys";
import { type ConnectionState, Realtime } from "../api/realtime";
import { API_URL, APP_VERSION, WS_URL } from "../config";
import { LeksCrypto } from "../../modules/leks-crypto";
import { DeviceKey } from "../crypto/deviceKey";
import { NativeEngine } from "../crypto/engine";
import { identityOf, Messenger } from "../messaging/messenger";
import { CallManager, RING_MS } from "../calls/CallManager";
import { LeksCalls } from "../../modules/leks-calls";
import { ExpoFiles } from "../messaging/expoFiles";
import { SqliteStore } from "../messaging/sqliteStore";
import { isMuted } from "../messaging/types";
import { checkPasscode, withPasscode } from "../lock/passcode";
import { askForNotifications, notifyLocally, registerForPush } from "../push";
import { type LockSettings, NO_LOCK, secure, type StoredSession } from "../storage/secure";

/**
 * - loading: reading the Keychain at start-up
 * - signedOut: no account on this phone
 * - onboarding: just registered or signed in, finishing the setup steps
 * - locked: the app lock screen is showing
 * - ready: the main app
 */
export type Status = "loading" | "signedOut" | "onboarding" | "locked" | "ready";

const sha256 = (text: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
const randomBytes = (length: number) => Crypto.getRandomBytes(length);
const platform = Platform.OS === "ios" ? "ios" : "android";

export const http = new HttpApi(API_URL);

interface SessionContext {
  status: Status;
  /** How the current setup steps started: a new account starts with the backup code step. */
  onboarding: "register" | "login" | null;
  session: StoredSession | null;
  connection: ConnectionState;
  realtime: Realtime | null;
  /** Chats on this phone; null until the encryption core has opened (or where it is not built in). */
  messenger: Messenger | null;
  calls: CallManager | null;
  lock: LockSettings;
  biometricLabel: string | null;
  register(input: { username: string; displayName: string; password: string }): Promise<void>;
  login(input: { username: string; password: string }): Promise<void>;
  recover(input: { username: string; recoveryCode: string; newPassword: string }): Promise<void>;
  finishOnboarding(): void;
  setLock(method: "none" | "biometric" | "passcode", passcode?: string): Promise<void>;
  unlockWithPasscode(code: string): Promise<{ ok: boolean; blockedForMs: number }>;
  unlockWithBiometrics(): Promise<boolean>;
  signOut(): Promise<void>;
}

const Context = createContext<SessionContext | null>(null);

export function useSession(): SessionContext {
  const value = useContext(Context);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [onboarding, setOnboarding] = useState<"register" | "login" | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [lock, setLockState] = useState<LockSettings>(NO_LOCK);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [realtime, setRealtime] = useState<Realtime | null>(null);
  const [messenger, setMessenger] = useState<Messenger | null>(null);
  const [calls, setCalls] = useState<CallManager | null>(null);
  const [biometricLabel, setBiometricLabel] = useState<string | null>(null);
  const lockRef = useRef(lock);
  /** Accounts made before the password stayed on the phone: switched over after the first sign-in. */
  const legacyPassword = useRef<{ current: string; next: string } | null>(null);
  useEffect(() => {
    lockRef.current = lock;
  }, [lock]);

  // Open the encryption core and the chat database for this device, then connect them to the server.
  useEffect(() => {
    if (!session || !realtime || !LeksCrypto) return;
    const native = LeksCrypto;
    let cancelled = false;
    let appStateSubscription: { remove(): void } | null = null;
    let purgeTimer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const engine = new NativeEngine((request) => native.call(request), `${native.stateDirectory()}/${session.deviceId}.mls`);
      await engine.open(identityOf(session));
      const store = await SqliteStore.open(`leks-${session.deviceId}.db`);
      if (cancelled) return;
      const created = new Messenger(engine, realtime, store, session, () => Crypto.randomUUID(), Date.now, new ExpoFiles(API_URL, session.deviceId));
      realtime.setHandlers({
        onMessages: (messages) => void created.onMessages(messages),
        onNudge: (accountId) => void created.onNudge(accountId).catch((e) => console.warn("device sync", e)),
        onAuthenticated: (available) => {
          void created.onAuthenticated(available).catch((e) => console.warn("key packages", e));
          void registerForPush(realtime);
          const legacy = legacyPassword.current;
          if (legacy) {
            void realtime
              .request({ type: "change_password", currentPassword: legacy.current, newPassword: legacy.next }, "password_changed")
              .then(() => {
                legacyPassword.current = null;
              })
              .catch((e) => console.warn("password upgrade", e));
          }
          // The daily encrypted copy, once things have settled after connecting.
          setTimeout(() => void backupIfDue(created).catch((e) => console.warn("backup", e)), 20_000);
        },
      });
      const callManager = new CallManager({
        myAccountId: session.accountId,
        send: (conversationId, payload) => created.sendCallSignal(conversationId, payload),
        token: async (room) => {
          const pass = await realtime.request({ type: "call_token", room }, "call_token");
          return { url: pass.url, token: pass.token };
        },
        uuid: () => Crypto.randomUUID(),
        newKey: () => toBase64url(Crypto.getRandomBytes(32)),
        now: Date.now,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        onEnded: (call) => {
          if (call.reason === "answered_elsewhere") return;
          const outcome =
            call.duration > 0
              ? "ended"
              : call.reason === "no_answer"
                ? "no_answer"
                : call.reason === "declined" || call.reason === "busy"
                  ? "declined"
                  : call.reason === "failed"
                    ? "failed"
                    : call.outgoing
                      ? "cancelled"
                      : "missed";
          void created.logCall(call.conversationId, call.outgoing, call.video, outcome, call.duration).catch(() => undefined);
        },
      });
      created.onCall((signal) => {
        // Ringing while the app is in the background: the phone-style call screen when available.
        // Only for fresh invites, and only when the app is not on screen (then the call screen shows).
        if (signal.type === "invite" && AppState.currentState !== "active" && Date.now() - signal.sentAt < RING_MS) {
          if (LeksCalls) {
            void created
              .conversation(signal.conversationId)
              .then(async (chat) => {
                const person = await created.person(signal.from).catch(() => null);
                const name =
                  person?.nickname ||
                  person?.displayName ||
                  (chat?.kind === "group" ? chat.members.find((m) => m.accountId === signal.from)?.displayName : chat?.title);
                LeksCalls?.showIncomingCall(name ?? "LEKS", name ? "Входящий звонок · LEKS" : "Входящий звонок");
              })
              .catch(() => LeksCalls?.showIncomingCall("LEKS", "Входящий звонок"));
          } else void notifyLocally("call").catch(() => undefined);
        }
        callManager.receive(signal);
      });
      created.onArrival((conversationId) => {
        void created
          .conversation(conversationId)
          .then((chat) => (isMuted(chat) ? undefined : notifyLocally("message")))
          .catch(() => undefined);
      });
      // Disappearing messages: checked every minute while the app is open, and on opening.
      void created.purgeExpired().catch(() => undefined);
      purgeTimer = setInterval(() => void created.purgeExpired().catch(() => undefined), 60_000);
      // Opened from the call notification's Answer / Decline buttons.
      const takeAction = () => {
        const action = LeksCalls?.takePendingAction();
        if (action) callManager.expect(action);
      };
      takeAction();
      appStateSubscription = AppState.addEventListener("change", (next) => {
        if (next !== "active") return;
        takeAction();
        void created.purgeExpired().catch(() => undefined);
      });
      setMessenger(created);
      setCalls(callManager);
    })().catch((error) => console.warn("encryption core failed to open", error));
    return () => {
      cancelled = true;
      appStateSubscription?.remove();
      clearInterval(purgeTimer);
      setMessenger(null);
      setCalls(null);
    };
  }, [session, realtime]);

  // Ask for notifications right after signing in, so pushes work from the first message.
  useEffect(() => {
    if (status === "ready") void askForNotifications().catch(() => undefined);
  }, [status]);

  // Retry the outbox whenever the connection comes back.
  useEffect(() => {
    if (connection === "online") void messenger?.flush();
  }, [connection, messenger]);

  const startRealtime = useCallback((stored: StoredSession, key: DeviceKey) => {
    const client = new Realtime({
      url: WS_URL,
      deviceId: stored.deviceId,
      sign: (challenge) => key.signChallenge(challenge),
      platform,
      appVersion: APP_VERSION,
      onState: setConnection,
    });
    client.start();
    setRealtime((previous) => {
      previous?.stop();
      return client;
    });
  }, []);

  // Start-up: restore the account from the Keychain.
  useEffect(() => {
    (async () => {
      const [stored, secret, savedLock, types] = await Promise.all([
        secure.loadSession(),
        secure.loadDeviceSecret(),
        secure.loadLock(),
        LocalAuthentication.supportedAuthenticationTypesAsync().catch((): LocalAuthentication.AuthenticationType[] => []),
      ]);
      setBiometricLabel(
        types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? "Face ID"
          : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
            ? Platform.OS === "ios"
              ? "Touch ID"
              : "Отпечаток пальца"
            : null,
      );
      setLockState(savedLock);
      if (!stored || !secret) {
        setStatus("signedOut");
        return;
      }
      setSession(stored);
      startRealtime(stored, DeviceKey.fromSecret(secret));
      setStatus(savedLock.method === "none" ? "ready" : "locked");
    })().catch(() => setStatus("signedOut"));
  }, [startRealtime]);

  // In the background the app lets go of the server, so new messages come as pushes
  // (Android may keep a backgrounded app connected for a while, and then nothing would show).
  // A running call keeps the connection; it needs it to hang up properly.
  useEffect(() => {
    if (!realtime) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      clearTimeout(timer);
      if (next === "active") {
        realtime.start();
      } else if (next === "background") {
        timer = setTimeout(() => {
          if ((calls?.state.phase ?? "idle") === "idle") realtime.stop();
        }, 3000);
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [realtime, calls]);

  // Lock again whenever the app goes to the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" && lockRef.current.method !== "none") {
        setStatus((current) => (current === "ready" ? "locked" : current));
      }
    });
    return () => subscription.remove();
  }, []);

  // The server removed this phone (for example, the account was recovered on another phone).
  useEffect(() => {
    if (connection === "signed_out") void signOutLocal();
  }, [connection]);

  const adopt = useCallback(
    async (account: AccountSession, key: DeviceKey, kind: "register" | "login") => {
      const stored: StoredSession = {
        accountId: account.accountId,
        deviceId: account.deviceId,
        username: account.username,
        displayName: account.displayName,
      };
      await secure.saveDeviceSecret(key.secretBytes);
      await secure.saveSession(stored);
      setSession(stored);
      startRealtime(stored, key);
      setOnboarding(kind);
      setStatus("onboarding");
    },
    [startRealtime],
  );

  async function signOutLocal() {
    await messenger?.wipe().catch(() => undefined);
    setRealtime((previous) => {
      previous?.stop();
      return null;
    });
    await secure.clearAll();
    setSession(null);
    setLockState(NO_LOCK);
    setStatus("signedOut");
  }

  const value = useMemo<SessionContext>(
    () => ({
      status,
      onboarding,
      session,
      connection,
      realtime,
      messenger,
      calls,
      lock,
      biometricLabel,
      async register(input) {
        const key = DeviceKey.generate(randomBytes);
        const account = await http.register({
          ...input,
          password: await signInSecret(input.username, input.password),
          createRecoveryCode: false,
          device: { platform, authPublicKey: key.publicKey },
        });
        await rememberBackupKey(account.accountId, input.password).catch(() => undefined);
        await adopt(account, key, "register");
      },
      async login(input) {
        const key = DeviceKey.generate(randomBytes);
        const device = { platform, authPublicKey: key.publicKey } as const;
        const secret = await signInSecret(input.username, input.password);
        let account: AccountSession;
        try {
          account = await http.login({ username: input.username, password: secret, device });
        } catch (error) {
          // An account from before this version still has the plain password on the server.
          if (!(error instanceof ApiError && error.code === "login_failed") || secret === input.password) throw error;
          account = await http.login({ username: input.username, password: input.password, device });
          legacyPassword.current = { current: input.password, next: secret };
        }
        await rememberBackupKey(account.accountId, input.password).catch(() => undefined);
        await adopt(account, key, "login");
      },
      async recover(input) {
        const key = DeviceKey.generate(randomBytes);
        const account = await http.recover({
          ...input,
          newPassword: await signInSecret(input.username, input.newPassword),
          device: { platform, authPublicKey: key.publicKey },
        });
        await rememberBackupKey(account.accountId, input.newPassword).catch(() => undefined);
        await adopt(account, key, "login");
      },
      finishOnboarding() {
        setOnboarding(null);
        setStatus("ready");
      },
      async setLock(method, passcode) {
        const next =
          method === "none"
            ? NO_LOCK
            : await withPasscode(method, passcode ?? "", Crypto.randomUUID(), sha256);
        await secure.saveLock(next);
        setLockState(next);
      },
      async unlockWithPasscode(code) {
        const result = await checkPasscode(code, lockRef.current, Date.now(), sha256);
        await secure.saveLock(result.lock);
        setLockState(result.lock);
        if (result.ok) setStatus("ready");
        return { ok: result.ok, blockedForMs: result.ok ? 0 : result.blockedForMs };
      },
      async unlockWithBiometrics() {
        if (lockRef.current.method !== "biometric") return false;
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Вход в LEKS",
          cancelLabel: "Ввести код-пароль",
          disableDeviceFallback: true,
        });
        if (result.success) setStatus("ready");
        return result.success;
      },
      signOut: signOutLocal,
    }),
    [status, onboarding, session, connection, realtime, messenger, calls, lock, biometricLabel, adopt],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
