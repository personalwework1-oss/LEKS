import { createSign } from "node:crypto";
import type { PushNotifier } from "../hub.js";
import type { Store } from "../store.js";

/** The parts of a Firebase service account key that are needed. */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** Reads the key from an env var holding the JSON itself or its base64. */
export function parseServiceAccount(value: string): ServiceAccount {
  const text = value.trim().startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  const parsed = JSON.parse(text) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("not a Firebase service account key");
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: parsed.private_key };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One signal per device at most this often; the app fetches everything when it opens anyway. */
export const PUSH_INTERVAL_MS = 20_000;

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/**
 * Android push through Firebase Cloud Messaging (HTTP v1). The notification
 * says only that something new arrived: no sender, no text. The server could
 * not include them anyway, since it cannot read messages.
 */
export class FcmNotifier implements PushNotifier {
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly account: ServiceAccount,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > this.now()) return this.accessToken.value;
    const issuedAt = Math.floor(this.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.account.private_key).toString("base64url");
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!response.ok) throw new Error(`FCM sign-in failed: ${response.status}`);
    const answer = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: answer.access_token, expiresAt: this.now() + answer.expires_in * 1000 };
    return answer.access_token;
  }

  /** Signs in to Firebase once, so a broken key shows up at startup rather than on the first message. */
  async check(): Promise<void> {
    await this.token();
  }

  async notify(deviceId: string): Promise<void> {
    const last = this.lastSent.get(deviceId) ?? 0;
    if (this.now() - last < PUSH_INTERVAL_MS) return;
    const target = await this.store.pushToken(deviceId);
    if (!target || target.provider !== "fcm") return;
    this.lastSent.set(deviceId, this.now());

    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token: target.token,
          notification: { title: "LEKS", body: "Новое сообщение" },
          android: { priority: "HIGH", collapse_key: "messages", notification: { channel_id: "messages", tag: "messages" } },
        },
      }),
    });
    if (response.status === 404 || response.status === 400) {
      // The app was removed or the token is old: forget it.
      const body = (await response.json().catch(() => ({}))) as { error?: { status?: string } };
      if (response.status === 404 || body.error?.status === "INVALID_ARGUMENT") await this.store.deletePushToken(deviceId);
      return;
    }
    if (!response.ok) throw new Error(`FCM send failed: ${response.status}`);
  }
}
