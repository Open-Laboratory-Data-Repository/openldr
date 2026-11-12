import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { SESSION_COOKIE, clearSessionCookie, readSessionCookie, setSessionCookie } from './session-cookie';

async function cookieFrom(handler: (reply: import('fastify').FastifyReply) => void): Promise<string> {
  const app = Fastify();
  app.get('/x', async (_req, reply) => { handler(reply); return reply.send({}); });
  const r = await app.inject({ method: 'GET', url: '/x' });
  await app.close();
  return String(r.headers['set-cookie']);
}

describe('session cookie', () => {
  it('is named openldr_session', () => {
    expect(SESSION_COOKIE).toBe('openldr_session');
  });

  it('reads the session cookie among others', () => {
    expect(readSessionCookie('a=1; openldr_session=sid.secret; b=2')).toBe('sid.secret');
    expect(readSessionCookie('openldr_session=sid.secret')).toBe('sid.secret');
  });

  it('reads null for a missing header, a missing cookie or an empty value', () => {
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie('')).toBeNull();
    expect(readSessionCookie('other=1')).toBeNull();
    expect(readSessionCookie('openldr_session=')).toBeNull();
    expect(readSessionCookie('xopenldr_session=abc')).toBeNull();
  });

  it('sets HttpOnly, SameSite=Strict, Path=/api/auth and Max-Age in whole seconds', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', new Date(now.getTime() + 90_500), false, now));
    expect(c).toBe('openldr_session=sid.secret; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=90');
  });

  it('adds Secure only when asked', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', new Date(now.getTime() + 60_000), true, now));
    expect(c).toBe('openldr_session=sid.secret; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=60; Secure');
  });

  it('never sets a negative Max-Age for a past expiry', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', new Date(now.getTime() - 5_000), false, now));
    expect(c).toContain('Max-Age=0');
  });

  it('refuses a value that could break out of the cookie', async () => {
    const app = Fastify();
    app.get('/x', async (_req, reply) => { setSessionCookie(reply, 'a; Path=/', new Date(Date.now() + 1000), false); return reply.send({}); });
    const r = await app.inject({ method: 'GET', url: '/x' });
    await app.close();
    expect(r.statusCode).toBe(500);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('clears with an empty value and Max-Age=0', async () => {
    expect(await cookieFrom((reply) => clearSessionCookie(reply, false)))
      .toBe('openldr_session=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0');
    expect(await cookieFrom((reply) => clearSessionCookie(reply, true)))
      .toBe('openldr_session=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0; Secure');
  });
});
