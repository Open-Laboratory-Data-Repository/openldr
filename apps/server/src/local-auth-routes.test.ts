import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerAuth } from './auth-plugin';
import { createAttemptLimiter, networkKey, registerLocalAuthRoutes } from './local-auth-routes';

type LocalSignIn = NonNullable<AppContext['localSignIn']>;
type LoginResult = Awaited<ReturnType<LocalSignIn['login']>>;
type SetupResult = Awaited<ReturnType<LocalSignIn['setup']>>;
type ChangeResult = Awaited<ReturnType<LocalSignIn['changePassword']>>;
type Grant = Awaited<ReturnType<LocalSignIn['refresh']>>;

const GOOD = 'correct horse battery';
const BEARER = { authorization: 'Bearer tok' };
const LATER = () => new Date(Date.now() + 7 * 86_400_000);

function okLogin(): LoginResult {
  return { ok: true, accessToken: 'tok', expiresIn: 600, mustChangePassword: false, cookieValue: 'sid1.secret', cookieExpiresAt: LATER(), userId: 'u1' };
}

function fakeSignIn() {
  const calls = { login: [] as unknown[], refresh: [] as string[], logout: [] as string[], changePassword: [] as unknown[], setup: [] as unknown[] };
  const state = {
    loginResult: okLogin(),
    refreshResult: { accessToken: 'tok2', expiresIn: 600, mustChangePassword: false } as Grant,
    logoutResult: { userId: 'u1' } as { userId: string } | null,
    changeResult: 'ok' as ChangeResult,
    setupResult: { ...okLogin(), accessToken: 'tok-admin' } as SetupResult,
    setupRequired: true,
  };
  const signIn: LocalSignIn = {
    setupRequired: async () => state.setupRequired,
    login: async (input) => { calls.login.push(input); return state.loginResult; },
    refresh: async (v) => { calls.refresh.push(v); return state.refreshResult; },
    logout: async (v) => { calls.logout.push(v); return state.logoutResult; },
    changePassword: async (input) => { calls.changePassword.push(input); return state.changeResult; },
    createSetupCode: async () => 'ABCD-EFGH-JKMN',
    setup: async (input) => { calls.setup.push(input); return state.setupResult; },
    sessionIsLive: async () => true,
  };
  return { signIn, state, calls };
}

function fakeCtx(opts: { localSignIn?: LocalSignIn; claims?: () => Record<string, unknown> } = {}) {
  const events: Array<Record<string, unknown>> = [];
  const ctx = {
    cfg: { AUTH_ADAPTER: 'local', AUTH_DEV_BYPASS: false },
    logger: { warn() {}, error() {}, info() {} },
    auth: { verifyToken: vi.fn(async () => (opts.claims ? opts.claims() : { sub: 'u1', sid: 's1' })) },
    audit: { record: vi.fn(async (e: Record<string, unknown>) => { events.push(e); return { ...e, id: 'x', occurredAt: 't' }; }) },
    roles: { resolveCapabilities: async () => [], backfillUserFromRoleNames: async () => {} },
    users: {
      isSubjectBlocked: async () => false,
      syncFromClaims: async () => ({ id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active', subject: 'u1', rbacInitialized: true }),
      get: async (id: string) => (id === 'u1' ? { id: 'u1', username: 'ada' } : undefined),
      markRbacInitialized: async () => {},
    },
    localSignIn: opts.localSignIn,
  } as unknown as AppContext;
  return { ctx, events };
}

function appFor(ctx: AppContext, fastifyOpts: FastifyServerOptions = {}) {
  const app = Fastify(fastifyOpts);
  registerAuth(app, ctx);
  registerLocalAuthRoutes(app, ctx);
  app.get('/api/users', async () => ({ users: [] }));
  return app;
}

const login = (app: ReturnType<typeof appFor>, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: payload as object, headers });

describe('local sign-in routes', () => {
  let fake: ReturnType<typeof fakeSignIn>;
  let ctx: AppContext;
  let events: Array<Record<string, unknown>>;
  let app: ReturnType<typeof appFor>;
  let claims: Record<string, unknown>;

  beforeEach(() => {
    fake = fakeSignIn();
    claims = { sub: 'u1', sid: 's1' };
    ({ ctx, events } = fakeCtx({ localSignIn: fake.signIn, claims: () => claims }));
    app = appFor(ctx);
  });

  describe('POST /api/auth/login', () => {
    it('signs in and sets an HttpOnly strict cookie scoped to /api/auth', async () => {
      const r = await login(app, { username: 'ada', password: GOOD });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ accessToken: 'tok', expiresIn: 600, mustChangePassword: false });
      const c = String(r.headers['set-cookie']);
      expect(c).toContain('openldr_session=sid1.secret;');
      expect(c).toContain('HttpOnly');
      expect(c).toContain('SameSite=Strict');
      expect(c).toContain('Path=/api/auth');
      // A browser-session cookie: closing the browser ends it.
      expect(c).not.toContain('Max-Age');
      expect(c).not.toContain('Expires');
      expect(c).not.toContain('Secure');
    });

    it('passes the identifier, password, address and user agent to the service', async () => {
      await login(app, { username: 'ada', password: GOOD }, { 'user-agent': 'probe/1' });
      expect(fake.calls.login).toEqual([{ identifier: 'ada', password: GOOD, ip: '127.0.0.1', userAgent: 'probe/1' }]);
    });

    it('marks the cookie Secure over https', async () => {
      const secureApp = appFor(ctx, { trustProxy: true });
      const r = await login(secureApp, { username: 'ada', password: GOOD }, { 'x-forwarded-proto': 'https' });
      expect(r.statusCode).toBe(200);
      expect(String(r.headers['set-cookie'])).toContain('; Secure');
    });

    it('does not trust x-forwarded-proto without TRUST_PROXY', async () => {
      const r = await login(app, { username: 'ada', password: GOOD }, { 'x-forwarded-proto': 'https' });
      expect(String(r.headers['set-cookie'])).not.toContain('Secure');
    });

    it('writes an auth.login row without the typed identifier', async () => {
      await login(app, { username: 'ada@example.org', password: GOOD });
      const row = events.find((e) => e.action === 'auth.login');
      expect(row).toMatchObject({ actorType: 'user', actorId: 'u1', actorName: 'ada', entityType: 'user', entityId: 'u1', metadata: { ip: '127.0.0.1', userId: 'u1' } });
      expect(JSON.stringify(events)).not.toContain('ada@example.org');
    });

    it('answers the same 401 for invalid, locked and disabled', async () => {
      const bodies = [];
      for (const reason of ['invalid', 'locked', 'disabled'] as const) {
        fake.state.loginResult = { ok: false, reason, userId: 'u1' };
        const r = await login(app, { username: 'ada', password: GOOD });
        expect(r.statusCode).toBe(401);
        expect(r.headers['set-cookie']).toBeUndefined();
        bodies.push(r.body);
      }
      expect(new Set(bodies)).toEqual(new Set([JSON.stringify({ error: 'invalid_credentials' })]));
    });

    it('never puts userId or lockStarted in the response', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid', userId: 'u1', lockStarted: true };
      const r = await login(app, { username: 'ada', password: GOOD });
      expect(r.json()).toEqual({ error: 'invalid_credentials' });
    });

    it('audits each failure reason with its own entity ID', async () => {
      const expected = { invalid: 'bad-credentials', locked: 'locked', disabled: 'account-disabled' } as const;
      for (const [reason, entityId] of Object.entries(expected)) {
        fake.state.loginResult = { ok: false, reason: reason as 'invalid' | 'locked' | 'disabled', userId: 'u1' };
        await login(app, { username: 'ada', password: GOOD });
        expect(events.at(-1)).toMatchObject({ action: 'auth.failed', entityType: 'auth', entityId, metadata: { ip: '127.0.0.1', userId: 'u1' } });
      }
    });

    it('omits userId from the metadata when no user matched', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid' };
      await login(app, { username: 'nobody', password: GOOD });
      const row = events.find((e) => e.action === 'auth.failed');
      expect(row).toMatchObject({ actorType: 'system', actorId: null, entityId: 'bad-credentials' });
      expect(row?.metadata).toEqual({ reason: 'bad-credentials', ip: '127.0.0.1' });
    });

    it('never audits the typed identifier', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid' };
      await login(app, { username: 'my-real-password', password: GOOD });
      fake.state.loginResult = { ok: false, reason: 'invalid', userId: 'u1', lockStarted: true };
      await login(app, { username: 'my-real-password', password: GOOD });
      expect(events.length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).not.toContain('my-real-password');
    });

    it('throttles repeated auth.failed rows from one address but not auth.locked', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid', userId: 'u1', lockStarted: true };
      await login(app, { username: 'ada', password: 'x' });
      await login(app, { username: 'ada', password: 'x' });
      expect(events.filter((e) => e.action === 'auth.failed')).toHaveLength(1);
      const locked = events.filter((e) => e.action === 'auth.locked');
      expect(locked).toHaveLength(2);
      expect(locked[0]).toMatchObject({ entityType: 'user', entityId: 'u1', metadata: { ip: '127.0.0.1', userId: 'u1' } });
    });

    it('writes no auth.locked row when the try did not start a lock', async () => {
      fake.state.loginResult = { ok: false, reason: 'locked', userId: 'u1' };
      await login(app, { username: 'ada', password: 'x' });
      expect(events.filter((e) => e.action === 'auth.locked')).toHaveLength(0);
    });

    it('refuses the 31st attempt from one address in a minute', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid' };
      for (let i = 0; i < 30; i++) expect((await login(app, { username: 'ada', password: 'x' })).statusCode).toBe(401);
      const r = await login(app, { username: 'ada', password: 'x' });
      expect(r.statusCode).toBe(429);
      expect(r.json()).toEqual({ error: 'too_many_attempts' });
      expect(fake.calls.login).toHaveLength(30);
    });

    it('refuses an oversized password before calling the service', async () => {
      const r = await login(app, { username: 'ada', password: 'x'.repeat(2000) });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'invalid_body' });
      expect(fake.calls.login).toHaveLength(0);
    });

    it('refuses an oversized username, a missing field and a control character', async () => {
      for (const payload of [
        { username: 'a'.repeat(321), password: GOOD },
        { password: GOOD },
        { username: 'ada', password: 42 },
        { username: 'ad\u0000a', password: GOOD },
        { username: 'ad\u001fa', password: GOOD },
        { username: 'ad\u007fa', password: GOOD },
      ]) {
        const r = await login(app, payload);
        expect(r.statusCode).toBe(400);
        expect(r.json()).toEqual({ error: 'invalid_body' });
      }
      expect(fake.calls.login).toHaveLength(0);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('returns a token from the cookie', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: 'openldr_session=sid1.secret' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ accessToken: 'tok2', expiresIn: 600, mustChangePassword: false });
      expect(fake.calls.refresh).toEqual(['sid1.secret']);
      expect(r.headers['set-cookie']).toBeUndefined();
    });

    it('answers 401 and clears the cookie with no cookie', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'session_ended' });
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
      expect(fake.calls.refresh).toHaveLength(0);
    });

    it('fails for a user disabled after sign-in', async () => {
      fake.state.refreshResult = null;
      const r = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: 'openldr_session=sid1.secret' } });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'session_ended' });
      expect(String(r.headers['set-cookie'])).toContain('openldr_session=;');
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('answers 204, clears the cookie and audits the sign-out', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: 'openldr_session=sid1.secret' } });
      expect(r.statusCode).toBe(204);
      expect(r.body).toBe('');
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
      expect(fake.calls.logout).toEqual(['sid1.secret']);
      expect(events.find((e) => e.action === 'auth.logout')).toMatchObject({ actorId: 'u1', entityType: 'user', entityId: 'u1', metadata: { ip: '127.0.0.1', userId: 'u1' } });
    });

    it('answers 204 and clears the cookie with no cookie, writing no row', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(r.statusCode).toBe(204);
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
      expect(fake.calls.logout).toHaveLength(0);
      expect(events.filter((e) => e.action === 'auth.logout')).toHaveLength(0);
    });

    it('answers 204 and clears the cookie for a bad cookie, writing no row', async () => {
      fake.state.logoutResult = null;
      const r = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: 'openldr_session=junk' } });
      expect(r.statusCode).toBe(204);
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
      expect(events.filter((e) => e.action === 'auth.logout')).toHaveLength(0);
    });
  });

  describe('POST /api/auth/change-password', () => {
    const change = (payload: unknown, headers: Record<string, string> = BEARER) =>
      app.inject({ method: 'POST', url: '/api/auth/change-password', payload: payload as object, headers });

    it('needs a bearer token', async () => {
      const r = await change({ currentPassword: 'a', newPassword: GOOD }, {});
      expect(r.statusCode).toBe(401);
      expect(fake.calls.changePassword).toHaveLength(0);
    });

    it('changes the password for the signed-in user and session', async () => {
      const r = await change({ currentPassword: 'old one', newPassword: GOOD });
      expect(r.statusCode).toBe(204);
      expect(r.body).toBe('');
      expect(fake.calls.changePassword).toEqual([{ userId: 'u1', sessionId: 's1', currentPassword: 'old one', newPassword: GOOD }]);
      const row = events.find((e) => e.action === 'user.change_password');
      expect(row).toMatchObject({ actorType: 'user', actorId: 'u1', actorName: 'ada', entityType: 'user', entityId: 'u1' });
      expect(JSON.stringify(events)).not.toContain(GOOD);
      expect(JSON.stringify(events)).not.toContain('old one');
    });

    it('maps each failure to a 400', async () => {
      for (const error of ['wrong_current', 'too_short', 'too_long', 'same_as_username'] as const) {
        fake.state.changeResult = error;
        const r = await change({ currentPassword: 'a', newPassword: GOOD });
        expect(r.statusCode).toBe(400);
        expect(r.json()).toEqual({ error });
      }
      expect(events.filter((e) => e.action === 'user.change_password')).toHaveLength(0);
    });

    it('answers 401 session_ended when the token has no session', async () => {
      claims = { sub: 'u1' };
      const r = await change({ currentPassword: 'a', newPassword: GOOD });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'session_ended' });
      expect(fake.calls.changePassword).toHaveLength(0);
    });

    it('refuses a bad body before calling the service', async () => {
      for (const payload of [{ currentPassword: 'a' }, { currentPassword: 'a', newPassword: 'x'.repeat(1025) }, { currentPassword: 'x'.repeat(1025), newPassword: GOOD }]) {
        const r = await change(payload);
        expect(r.statusCode).toBe(400);
        expect(r.json()).toEqual({ error: 'invalid_body' });
      }
      expect(fake.calls.changePassword).toHaveLength(0);
    });
  });

  describe('POST /api/auth/setup', () => {
    const body = { setupCode: 'ABCD-EFGH-JKMN', username: 'admin', displayName: 'Admin', password: GOOD };
    const setup = (payload: unknown) => app.inject({ method: 'POST', url: '/api/auth/setup', payload: payload as object });

    it('answers 201 with the login body and the cookie', async () => {
      const r = await setup(body);
      expect(r.statusCode).toBe(201);
      expect(r.json()).toEqual({ accessToken: 'tok-admin', expiresIn: 600, mustChangePassword: false });
      expect(String(r.headers['set-cookie'])).toContain('openldr_session=sid1.secret;');
      expect(fake.calls.setup).toEqual([{ ...body, ip: '127.0.0.1', userAgent: 'lightMyRequest' }]);
      const row = events.find((e) => e.action === 'auth.setup');
      expect(row).toMatchObject({ actorId: 'u1', entityType: 'user', entityId: 'u1', metadata: { ip: '127.0.0.1', userId: 'u1' } });
      expect(JSON.stringify(events)).not.toContain('ABCD-EFGH-JKMN');
      expect(JSON.stringify(events)).not.toContain(GOOD);
    });

    it('answers 409, 401 and 400 by reason', async () => {
      const cases = [
        ['already_set_up', 409],
        ['bad_code', 401],
        ['bad_username', 400],
        ['username_taken', 400],
        ['too_short', 400],
        ['too_long', 400],
        ['same_as_username', 400],
      ] as const;
      for (const [reason, status] of cases) {
        fake.state.setupResult = { ok: false, reason };
        const r = await setup(body);
        expect(r.statusCode).toBe(status);
        expect(r.json()).toEqual({ error: reason });
        expect(r.headers['set-cookie']).toBeUndefined();
      }
    });

    it('refuses a control character in the code, username or display name before calling the service', async () => {
      for (const payload of [
        { ...body, setupCode: 'ABCD\u0000' },
        { ...body, username: 'ad\u0000min' },
        { ...body, displayName: 'Ad\u007fmin' },
        { ...body, password: 'x'.repeat(1025) },
        { setupCode: 'ABCD', password: GOOD },
      ]) {
        const r = await setup(payload);
        expect(r.statusCode).toBe(400);
        expect(r.json()).toEqual({ error: 'invalid_body' });
      }
      expect(fake.calls.setup).toHaveLength(0);
    });

    it('shares the per-address limit with login', async () => {
      fake.state.loginResult = { ok: false, reason: 'invalid' };
      for (let i = 0; i < 30; i++) await login(app, { username: 'ada', password: 'x' });
      const r = await setup(body);
      expect(r.statusCode).toBe(429);
      expect(r.json()).toEqual({ error: 'too_many_attempts' });
      expect(fake.calls.setup).toHaveLength(0);
    });
  });

  it('a must-change token reaches change-password and nothing else', async () => {
    claims = { sub: 'u1', sid: 's1', pwd_change: true };
    const blocked = await app.inject({ method: 'GET', url: '/api/users', headers: BEARER });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: 'password_change_required' });
    const r = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: BEARER, payload: { currentPassword: 'a', newPassword: GOOD } });
    expect(r.statusCode).toBe(204);
  });

  it('lets logout through for a must-change user', async () => {
    claims = { sub: 'u1', sid: 's1', pwd_change: true };
    const r = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...BEARER, cookie: 'openldr_session=sid1.secret' } });
    expect(r.statusCode).toBe(204);
  });
});

describe('without local sign-in', () => {
  it('registers no auth routes', async () => {
    const { ctx } = fakeCtx({ claims: () => ({ sub: 'u1', sid: 's1' }) });
    const app = appFor(ctx);
    for (const url of ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/change-password', '/api/auth/setup']) {
      const r = await app.inject({ method: 'POST', url, headers: BEARER, payload: {} });
      expect(r.statusCode).toBe(404);
    }
  });
});

describe('sign-in limit per network', () => {
  async function exhaust(app: ReturnType<typeof appFor>, remoteAddress: string) {
    for (let i = 0; i < 30; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ada', password: 'x' }, remoteAddress });
    }
  }
  const attempt = (app: ReturnType<typeof appFor>, remoteAddress: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ada', password: 'x' }, remoteAddress });

  function freshApp() {
    const fake = fakeSignIn();
    fake.state.loginResult = { ok: false, reason: 'invalid' };
    return appFor(fakeCtx({ localSignIn: fake.signIn }).ctx);
  }

  it('gives two addresses in one IPv6 /64 one budget', async () => {
    const app = freshApp();
    await exhaust(app, '2001:db8:1:2::1');
    expect((await attempt(app, '2001:db8:1:2:ffff:ffff:ffff:ffff')).statusCode).toBe(429);
  });

  it('gives addresses in different /64s separate budgets', async () => {
    const app = freshApp();
    await exhaust(app, '2001:db8:1:2::1');
    expect((await attempt(app, '2001:db8:1:3::1')).statusCode).toBe(401);
  });

  it('gives ::ffff:1.2.3.4 and 1.2.3.4 one budget', async () => {
    const app = freshApp();
    await exhaust(app, '::ffff:1.2.3.4');
    expect((await attempt(app, '1.2.3.4')).statusCode).toBe(429);
    expect((await attempt(app, '1.2.3.5')).statusCode).toBe(401);
  });
});

describe('networkKey', () => {
  it('keys IPv4 and IPv4-mapped IPv6 by the IPv4 address', () => {
    expect(networkKey('1.2.3.4')).toBe('1.2.3.4');
    expect(networkKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(networkKey('::ffff:0102:0304')).toBe('1.2.3.4');
  });

  it('keys IPv6 by its /64, however it is written', () => {
    expect(networkKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(networkKey('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(networkKey('2001:DB8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(networkKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(networkKey('::1')).toBe('0:0:0:0::/64');
  });

  it('keys an address that does not parse as itself', () => {
    expect(networkKey('not-an-ip')).toBe('not-an-ip');
    expect(networkKey('')).toBe('');
  });
});

describe('createAttemptLimiter', () => {
  it('refuses the 31st attempt in a minute from one key', () => {
    const allow = createAttemptLimiter({ now: () => 0 });
    for (let i = 0; i < 30; i++) expect(allow('a')).toBe(true);
    expect(allow('a')).toBe(false);
    expect(allow('b')).toBe(true);
  });

  it("resets a key's window after 60 seconds", () => {
    let t = 0;
    const allow = createAttemptLimiter({ now: () => t });
    for (let i = 0; i < 30; i++) allow('a');
    t = 59_999;
    expect(allow('a')).toBe(false);
    t = 60_000;
    expect(allow('a')).toBe(true);
  });

  it('accepts a new key when full and evicts the oldest key', () => {
    const allow = createAttemptLimiter({ limit: 1, maxEntries: 2, now: () => 0 });
    expect(allow('a')).toBe(true);
    expect(allow('b')).toBe(true);
    expect(allow('c')).toBe(true);
    // 'a' was evicted, so it starts a new window. 'c' is still tracked and stays refused.
    expect(allow('c')).toBe(false);
    expect(allow('a')).toBe(true);
    // Adding 'a' back evicted 'b', the oldest left, so 'b' starts again too.
    expect(allow('b')).toBe(true);
  });

  it('moves a key with an ended window to the back of the eviction order', () => {
    let t = 0;
    const allow = createAttemptLimiter({ limit: 1, windowMs: 1000, maxEntries: 2, now: () => t });
    allow('a');
    t = 500;
    allow('b');
    t = 1000;
    expect(allow('a')).toBe(true); // a's window ended: new window, now newest
    expect(allow('c')).toBe(true); // full: evicts b, the oldest
    expect(allow('a')).toBe(false); // a is still tracked
  });
});
