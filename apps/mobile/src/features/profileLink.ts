import { API_URL } from "@/config";

/** The link in a profile QR code: an https page (any camera app opens it) that opens the chat in LEKS. */
export const profileLink = (username: string) => `${API_URL}/u/${username}`;

/** The @username from a scanned code or a pasted link: ours (https or leks://) or a bare @name. */
export function usernameFromLink(text: string): string | null {
  const trimmed = text.trim();
  const match = /(?:^leks:\/\/u\/|\/u\/)([a-z0-9_]{3,32})\/?(?:[?#].*)?$/i.exec(trimmed) ?? /^@?([a-z0-9_]{3,32})$/i.exec(trimmed);
  return match ? match[1]!.toLowerCase() : null;
}
