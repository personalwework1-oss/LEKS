import { createHmac } from "node:crypto";

export interface CallConfig {
  /** Public address of the media server, e.g. wss://example.org */
  url: string;
  apiKey: string;
  apiSecret: string;
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** How long a pass to a call room is valid (joining only; a call can then last longer). */
export const CALL_TOKEN_SECONDS = 10 * 60;

/**
 * A LiveKit access token (a JWT signed with HMAC-SHA256) that lets one
 * device join one room. The identity is the device, so the media server
 * learns nothing else about the person.
 */
export function callToken(config: CallConfig, room: string, identity: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    iss: config.apiKey,
    sub: identity,
    nbf: issuedAt - 10,
    iat: issuedAt,
    exp: issuedAt + CALL_TOKEN_SECONDS,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createHmac("sha256", config.apiSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}
