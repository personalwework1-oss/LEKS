import {
  AccountSession,
  type DevicePlatform,
  HttpError,
  type HttpErrorCode,
  UsernameAvailability,
} from "@leks/protocol";
import type { z } from "zod";

/** A failed request, with the server's error code when it sent one. */
export class ApiError extends Error {
  constructor(readonly code: HttpErrorCode | "network" | "unexpected", readonly status = 0) {
    super(code);
  }
}

export interface NewDeviceInput {
  platform: DevicePlatform;
  authPublicKey: string;
}

type Fetch = typeof fetch;

/** HTTPS calls: registration, sign-in on a new device and recovery. */
export class HttpApi {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: Fetch = fetch) {}

  private async request<T extends z.ZodType>(method: string, path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network");
    }
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = HttpError.safeParse(data);
      throw new ApiError(parsed.success ? parsed.data.error : "unexpected", response.status);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ApiError("unexpected", response.status);
    return parsed.data;
  }

  usernameAvailable(username: string) {
    return this.request("GET", `/v1/usernames/${encodeURIComponent(username)}`, UsernameAvailability);
  }

  register(input: {
    username: string;
    displayName: string;
    password: string;
    createRecoveryCode: boolean;
    device: NewDeviceInput;
  }) {
    return this.request("POST", "/v1/accounts", AccountSession, input);
  }

  login(input: { username: string; password: string; device: NewDeviceInput }) {
    return this.request("POST", "/v1/sessions", AccountSession, input);
  }

  recover(input: { username: string; recoveryCode: string; newPassword: string; device: NewDeviceInput }) {
    return this.request("POST", "/v1/accounts/recover", AccountSession, input);
  }
}

/** Human-readable text for an API error, for the screens. */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unexpected";
  switch (code) {
    case "network":
      return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
    case "username_taken":
      return "Это имя уже занято.";
    case "weak_password":
      return "Пароль слишком простой. Придумайте другой.";
    case "login_failed":
      return "Неверное имя пользователя или пароль.";
    case "login_locked":
      return "Слишком много попыток. Попробуйте через 15 минут.";
    case "recovery_failed":
      return "Неверное имя пользователя или запасной код.";
    case "recovery_locked":
      return "Слишком много попыток. Попробуйте через час.";
    case "invalid_request":
      return "Проверьте, что всё заполнено правильно.";
    default:
      return "Что-то пошло не так. Попробуйте ещё раз.";
  }
}
