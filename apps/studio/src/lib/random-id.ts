/**
 * One way to make a random id in the studio.
 *
 * Browsers expose `crypto.randomUUID` only in a secure context (HTTPS or localhost).
 * The studio is also used over plain HTTP on a LAN or Tailscale, where it is undefined.
 * `crypto.getRandomValues` exists in both, so it is the first fallback.
 *
 * Last resort: when no `crypto` exists at all, return UUID-shaped text from `Math.random`.
 * That is not secure. An id is better than a crashed page, and these ids are not secrets.
 * Never use this for a secret that needs `crypto`.
 */
export function randomId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
