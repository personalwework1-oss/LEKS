import { Username } from "@leks/protocol";
import type { FastifyInstance } from "fastify";

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page a profile QR code or link opens (https, so any camera app can open
 * it): a button that opens the chat in the app. It shows only the @username
 * from the link, nothing from the account.
 */
export function inviteRoutes(app: FastifyInstance): void {
  app.get<{ Params: { username: string } }>("/u/:username", async (request, reply) => {
    const parsed = Username.safeParse(request.params.username);
    if (!parsed.success) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    const name = escape(parsed.data);
    const deepLink = `leks://u/${encodeURIComponent(parsed.data)}`;
    reply
      .header("Cache-Control", "public, max-age=300")
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
      .header("Referrer-Policy", "no-referrer")
      .type("text/html; charset=utf-8");
    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>@${name} в LEKS</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; background: #F5F6FA; color: #0E1525; }
  @media (prefers-color-scheme: dark) { body { background: #0B0F17; color: #E8ECF4; } .card { background: #151B27 !important; } .muted { color: #9AA2B4 !important; } }
  .card { background: #fff; border-radius: 24px; padding: 32px 24px; max-width: 360px; margin: 16px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .muted { color: #5B6478; font-size: 15px; line-height: 1.45; }
  a.button { display: block; margin-top: 24px; padding: 16px; border-radius: 16px; background: #2D4FE0; color: #fff; text-decoration: none; font-weight: 600; font-size: 17px; }
</style>
</head>
<body>
<div class="card">
  <h1>@${name}</h1>
  <p class="muted">приглашает вас в защищённый чат в LEKS. Без номера телефона, со сквозным шифрованием.</p>
  <a class="button" href="${deepLink}">Открыть в LEKS</a>
  <p class="muted" style="margin-top:20px;font-size:13px">Если ничего не происходит, установите LEKS и откройте ссылку снова.</p>
</div>
</body>
</html>`;
  });
}
