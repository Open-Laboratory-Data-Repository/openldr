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

  it('sets HttpOnly, SameSite=Strict and Path=/api/auth', async () => {
    const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', false));
    expect(c).toBe('openldr_session=sid.secret; Path=/api/auth; HttpOnly; SameSite=Strict');
  });

  it('adds Secure only when asked', async () => {
    const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', true));
    expect(c).toBe('openldr_session=sid.secret; Path=/api/auth; HttpOnly; SameSite=Strict; Secure');
  });

  it('ends with the browser: no Max-Age and no Expires', async () => {
    for (const secure of [false, true]) {
      const c = await cookieFrom((reply) => setSessionCookie(reply, 'sid.secret', secure));
      expect(c).toContain('openldr_session=sid.secret;');
      expect(c).not.toContain('Max-Age');
      expect(c).not.toContain('Expires');
    }
  });

  it('refuses a value that could break out of the cookie', async () => {
    const app = Fastify();
    app.get('/x', async (_req, reply) => { setSessionCookie(reply, 'a; Path=/', false); return reply.send({}); });
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
