import { CloseCode, PROTOCOL_VERSION, toBase64url } from "@leks/protocol";
import { ApiError, errorText, HttpApi } from "../src/api/http";
import { type ConnectionState, Realtime, RealtimeError } from "../src/api/realtime";

const ACCOUNT = {
  accountId: "6f1c1b7e-2f7a-4d3b-9a51-0c3c1a3b9d10",
  deviceId: "6f1c1b7e-2f7a-4d3b-9a51-0c3c1a3b9d11",
  username: "alice",
  displayName: "Алиса",
  recoveryCode: null,
};

function fakeFetch(status: number, body: unknown) {
  return jest.fn(async () => ({ ok: status < 400, status, json: async () => body }) as unknown as Response);
}

describe("HttpApi", () => {
  it("parses a successful registration", async () => {
    const fetch = fakeFetch(201, ACCOUNT);
    const api = new HttpApi("https://example.test", fetch);
    const device = { platform: "ios" as const, authPublicKey: "A".repeat(43) };
    const session = await api.register({ username: "alice", displayName: "Алиса", password: "Moscow-Rain-42", createRecoveryCode: false, device });
    expect(session).toEqual(ACCOUNT);
    expect(fetch).toHaveBeenCalledWith("https://example.test/v1/accounts", expect.objectContaining({ method: "POST" }));
  });

  it("turns server errors into readable text", async () => {
    const api = new HttpApi("https://example.test", fakeFetch(401, { error: "login_failed" }));
    const error = await api.login({ username: "a_b", password: "x", device: { platform: "ios", authPublicKey: "A".repeat(43) } }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("login_failed");
    expect(errorText(error)).toBe("Неверное имя пользователя или пароль.");
  });

  it("reports a missing connection", async () => {
    const api = new HttpApi("https://example.test", jest.fn(async () => Promise.reject(new TypeError("Network request failed"))));
    const error = await api.usernameAvailable("alice").catch((e) => e);
    expect(error.code).toBe("network");
  });
});

/** A WebSocket stand-in that plays the server's side. */
class FakeSocket {
  static last: FakeSocket;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;

  constructor(readonly url: string) {
    FakeSocket.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Realtime", () => {
  function connect() {
    const states: ConnectionState[] = [];
    const client = new Realtime({
      url: "wss://example.test/v1/ws",
      deviceId: ACCOUNT.deviceId,
      sign: () => "signed",
      platform: "test",
      appVersion: "0.1.0",
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      onState: (state) => states.push(state),
    });
    client.start();
    return { client, states };
  }

  it("greets, signs the challenge and goes online", async () => {
    const { client, states } = connect();
    await tick();
    const socket = FakeSocket.last;
    expect(socket.sent[0]).toMatchObject({ type: "hello", protocol: PROTOCOL_VERSION });
    socket.receive({ type: "welcome", protocol: PROTOCOL_VERSION, serverTime: 0, challenge: toBase64url(new Uint8Array(32)) });
    expect(socket.sent[1]).toEqual({ type: "auth", deviceId: ACCOUNT.deviceId, signature: "signed" });
    socket.receive({ type: "authenticated", accountId: ACCOUNT.accountId, deviceId: ACCOUNT.deviceId, keyPackagesAvailable: 0 });
    expect(states).toEqual(["connecting", "online"]);
    client.stop();
  });

  it("matches answers to requests, including errors", async () => {
    const { client } = connect();
    await tick();
    const socket = FakeSocket.last;
    socket.receive({ type: "welcome", protocol: 1, serverTime: 0, challenge: toBase64url(new Uint8Array(32)) });
    socket.receive({ type: "authenticated", accountId: ACCOUNT.accountId, deviceId: ACCOUNT.deviceId, keyPackagesAvailable: 0 });

    const lookup = client.request({ type: "lookup_user", username: "bob" }, "user");
    await tick();
    const sent = socket.sent.at(-1)!;
    socket.receive({ type: "user", requestId: sent.requestId, user: null });
    await expect(lookup).resolves.toMatchObject({ type: "user", user: null });

    const change = client.request({ type: "change_password", currentPassword: "a", newPassword: "Moscow-Rain-42" }, "password_changed");
    await tick();
    socket.receive({ type: "error", code: "wrong_password", requestId: socket.sent.at(-1)!.requestId });
    await expect(change).rejects.toEqual(new RealtimeError("wrong_password"));
    client.stop();
  });

  it("signs out when the server removes this device", async () => {
    const { states } = connect();
    await tick();
    FakeSocket.last.onclose?.({ code: CloseCode.DeviceRemoved });
    expect(states.at(-1)).toBe("signed_out");
  });
});
