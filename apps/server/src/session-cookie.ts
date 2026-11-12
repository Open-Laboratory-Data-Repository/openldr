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

function write(reply: FastifyReply, value: string, maxAgeSeconds: number, secure: boolean): void {
  reply.header('set-cookie', `${SESSION_COOKIE}=${value}; ${ATTRIBUTES}; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
}

/** `secure` should be true only when the request arrived over HTTPS. */
export function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date, secure: boolean, now: Date = new Date()): void {
  if (!SAFE_VALUE.test(value)) throw new Error('session cookie value has unexpected characters');
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  write(reply, value, maxAge, secure);
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  write(reply, '', 0, secure);
}
