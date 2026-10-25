import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FcmNotifier, PUSH_INTERVAL_MS, parseServiceAccount } from "../src/push/fcm.js";
import type { Store } from "../src/store.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = {
  project_id: "leks-test",
  client_email: "push@leks-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

function setup(tokens: Record<string, { provider: "fcm" | "apns"; token: string }>, sendStatus = 200) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const deleted: string[] = [];
  let clock = 1_700_000_000_000;
  const store = {
    pushToken: async (id: string) => tokens[id] ?? null,
    deletePushToken: async (id: string) => void deleted.push(id),
  } as unknown as Store;
  const fetchImpl = async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: init.body, headers: init.headers });
    if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "access-1", expires_in: 3600 }) };
    return { ok: sendStatus < 300, status: sendStatus, json: async () => ({ error: { status: sendStatus === 400 ? "INVALID_ARGUMENT" : "NOT_FOUND" } }) };
  };
  const notifier = new FcmNotifier(store, account, fetchImpl as never, () => clock);
  return { notifier, calls, deleted, advance: (ms: number) => (clock += ms) };
}

describe("Android push", () => {
  it("signs in with the service account and sends a notification without any content", async () => {
    const { notifier, calls } = setup({ d1: { provider: "fcm", token: "fcm-token-1" } });
    await notifier.notify("d1");

    const signIn = new URLSearchParams(calls[0]!.body);
    const [header, claims, signature] = signIn.get("assertion")!.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging" });

    expect(calls[1]!.url).toBe("https://fcm.googleapis.com/v1/projects/leks-test/messages:send");
    expect(calls[1]!.headers.authorization).toBe("Bearer access-1");
    const message = JSON.parse(calls[1]!.body).message;
    expect(message).toMatchObject({ token: "fcm-token-1", notification: { title: "LEKS", body: "Новое сообщение" }, android: { priority: "HIGH" } });
    expect(Object.keys(message).sort()).toEqual(["android", "notification", "token"]);
  });

  it("wakes the app silently for calls, separately from messages", async () => {
    const { notifier, calls } = setup({ d1: { provider: "fcm", token: "t" } });
    await notifier.notify("d1", "message");
    await notifier.notify("d1", "call");
    const sent = calls.filter((c) => c.url.includes("messages:send")).map((c) => JSON.parse(c.body).message);
    expect(sent).toHaveLength(2);
    // Calls are a silent wake-up (the app rings); no text at all.
    expect(sent[1]).toEqual({ token: "t", data: { leks: "call" }, android: { priority: "HIGH", ttl: "45s" } });
    expect(sent[0].android.notification.channel_id).toBe("messages");
  });

  it("sends a test notification and reports the outcome", async () => {
    const ok = setup({ d1: { provider: "fcm", token: "t" } });
    expect(await ok.notifier.test("d1")).toBe("sent");
    expect(await ok.notifier.test("nobody")).toBe("no_token");
    const gone = setup({ d1: { provider: "fcm", token: "old" } }, 404);
    expect(await gone.notifier.test("d1")).toBe("rejected");
    expect(gone.deleted).toEqual(["d1"]);
    const down = setup({ d1: { provider: "fcm", token: "t" } }, 503);
    expect(await down.notifier.test("d1")).toBe("failed");
  });

  it("reuses the access token and sends at most one signal per device in a short time", async () => {
    const { notifier, calls, advance } = setup({ d1: { provider: "fcm", token: "t" } });
    await notifier.notify("d1");
    await notifier.notify("d1");
    expect(calls.filter((c) => c.url.includes("messages:send"))).toHaveLength(1);
    advance(PUSH_INTERVAL_MS + 1);
    await notifier.notify("d1");
    expect(calls.filter((c) => c.url.includes("messages:send"))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
  });

  it("skips devices without an Android token and forgets tokens Firebase no longer knows", async () => {
    const { notifier, calls } = setup({ ios: { provider: "apns", token: "x" } });
    await notifier.notify("ios");
    await notifier.notify("nobody");
    expect(calls).toHaveLength(0);

    const gone = setup({ d1: { provider: "fcm", token: "old" } }, 404);
    await gone.notifier.notify("d1");
    expect(gone.deleted).toEqual(["d1"]);
  });

  it("reads the key as JSON or base64, and rejects anything else", () => {
    const json = JSON.stringify(account);
    expect(parseServiceAccount(json).project_id).toBe("leks-test");
    expect(parseServiceAccount(Buffer.from(json).toString("base64")).client_email).toBe(account.client_email);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: "x" }))).toThrow();
  });
});
