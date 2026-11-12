// The local sign-in session cookie, set and read by hand (no cookie dependency). It holds
// `<sessionId>.<secret>` and is scoped to /api/auth, so the browser sends it only to the
// sign-in routes and never alongside ordinary API calls.
import type { FastifyReply } from 'fastify';

export const SESSION_COOKIE = 'openldr_session';

const ATTRIBUTES = 'Path=/api/auth; HttpOnly; SameSite=Strict';
// What the sign-in service puts in a cookie value. Anything else could add cookie attributes.
const SAFE_VALUE = /^[A-Za-z0-9._-]+$/;

/** The session cookie's value from a `Cookie` header, or null when it is absent or empty. */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

function write(reply: FastifyReply, value: string, extra: string, secure: boolean): void {
  reply.header('set-cookie', `${SESSION_COOKIE}=${value}; ${ATTRIBUTES}${extra}${secure ? '; Secure' : ''}`);
}

/**
 * Sets the cookie with no Max-Age and no Expires, so it ends when the browser closes. On a shared
 * lab PC the next person must not open studio signed in as the last one. The server still ends
 * the session after 12 hours idle or 7 days in total. `secure` should be true only when the
 * request arrived over HTTPS.
 */
export function setSessionCookie(reply: FastifyReply, value: string, secure: boolean): void {
  if (!SAFE_VALUE.test(value)) throw new Error('session cookie value has unexpected characters');
  write(reply, value, '', secure);
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  write(reply, '', '; Max-Age=0', secure);
}
