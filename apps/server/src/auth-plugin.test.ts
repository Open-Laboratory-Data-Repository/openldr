import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { AppContext } from '@openldr/bootstrap';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import { registerAuth } from './auth-plugin';
import { requireCapability } from './rbac';

type Claims = { sub: string; [k: string]: unknown };

function ctx(opts: {
  bypass?: boolean;
  verify?: (t: string) => Promise<Claims>;
  user?: {
    id: string;
    username: string;
    displayName: string | null;
    roles: string[];
    status: 'active' | 'disabled';
    subject?: string | null;
    rbacInitialized?: boolean;
  };
  roles?: {
    resolveCapabilities?: (subject: string) => Promise<string[]>;
    backfillUserFromRoleNames?: (subject: string, roleNames: string[]) => Promise<void>;
  };
  markRbacInitialized?: (id: string) => Promise<void>;
}): AppContext {
  const providedUser = opts.user ?? { id: 'u1', username: 'ada', displayName: 'Ada', roles: ['lab_manager'], status: 'active' as const };
  // Default already-initialized so pre-existing tests (which don't care about RBAC backfill)
  // don't trip the once-only migration path.
  const u = { subject: null as string | null, rbacInitialized: true, ...providedUser };
  return {
    cfg: { AUTH_DEV_BYPASS: opts.bypass ?? false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
    logger: { warn() {}, error() {}, info() {} },
    auth: { verifyToken: opts.verify ?? (async () => { throw new Error('bad'); }) },
    audit: { record: vi.fn(async (e: unknown) => ({ ...(e as object), id: 'x', occurredAt: 't' })) },
    roles: {
      resolveCapabilities: opts.roles?.resolveCapabilities ?? (async () => []),
      backfillUserFromRoleNames: opts.roles?.backfillUserFromRoleNames ?? (async () => {}),
    },
    users: {
      isSubjectBlocked: async () => false,
      syncFromClaims: async () => u,
      getByUsername: async () => undefined,
      create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
      markRbacInitialized: opts.markRbacInitialized ?? (async () => {}),
    },
  } as unknown as AppContext;
}

async function appWith(c: AppContext) {
  const app = Fastify();
  registerAuth(app, c);
  app.get('/api/probe', async (req) => ({ user: req.user ?? null }));
  app.get('/health', async () => ({ ok: true }));
  return app;
}

describe('registerAuth', () => {
  it('does not grant generic-provider users legacy Keycloak roles on first login', async () => {
    const backfill = vi.fn(async () => {});
    const c = ctx({
      verify: async () => ({ sub: 'generic-1', realm_access: { roles: ['lab_admin'] } }),
      user: { id: 'local-1', subject: 'generic-1', username: 'ada', displayName: null, roles: [], status: 'active', rbacInitialized: false },
      roles: { backfillUserFromRoleNames: backfill },
    });
    c.cfg.AUTH_ADAPTER = 'oidc';
    const app = await appWith(c);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer valid' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().user).toMatchObject({ roles: [], capabilities: [] });
      expect(backfill).toHaveBeenCalledWith('generic-1', []);
    } finally { await app.close(); }
  });
  it('leaves /health public (no actor required)', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('401s an /api request with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(401);
  });

  it('injects a dev actor when bypass is on and no token', async () => {
    const app = await appWith(ctx({ bypass: true }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toContain('lab_admin');
  });

  it('resolves req.user from a valid token', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada');
  });

  it('sources req.user.roles from the token realm_access (not the local record), filtering provider defaults', async () => {
    const c = ctx({
      verify: async () => ({ sub: 's1', realm_access: { roles: ['lab_admin', 'offline_access', 'default-roles-openldr'] } }),
      user: { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active' },
    });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toEqual(['lab_admin']);
  });

  it('401s on an invalid token', async () => {
    const app = await appWith(ctx({ verify: async () => { throw new Error('bad'); } }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    expect(res.statusCode).toBe(401);
  });

  it('403s a disabled user', async () => {
    const c = ctx({ verify: async () => ({ sub: 's1' }), user: { id: 'u2', username: 'x', displayName: null, roles: [], status: 'disabled' } });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(403);
  });

  it('401s when syncFromClaims throws', async () => {
    const c = ctx({ verify: async () => ({ sub: 's1' }) });
    // override users.syncFromClaims to throw
    (c.users as unknown as { syncFromClaims: () => Promise<unknown> }).syncFromClaims = async () => { throw new Error('db down'); };
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(401);
  });

  it('does not downgrade a credentialed request when bypass is on', async () => {
    const app = await appWith(ctx({ bypass: true, verify: async () => ({ sub: 's1' }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada'); // resolved via verifyToken+syncFromClaims, NOT the dev actor
  });

  it('allows /api/config with no token when bypass is off', async () => {
    const app = await appWith(ctx({ bypass: false }));
    app.get('/api/config', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts an access_token query param on the ontology SSE routes only', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1' }) }));
    app.get('/api/terminology/ontology/:id/build', async (req) => ({ user: req.user ?? null }));
    app.get('/api/probe2', async (req) => ({ user: req.user ?? null }));
    const ok = await app.inject({ method: 'GET', url: '/api/terminology/ontology/x/build?path=p&access_token=good' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBeTruthy();
    const nonSse = await app.inject({ method: 'GET', url: '/api/probe2?access_token=good' });
    expect(nonSse.statusCode).toBe(401); // query token not honoured off the SSE routes
  });

  it('records one throttled auth.failed on an invalid token', async () => {
    const c = ctx({ verify: async () => { const e: any = new Error('bad'); e.code = 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'; throw e; } });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer bad' } });
    const calls = (c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed');
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatchObject({ action: 'auth.failed', entityType: 'auth', metadata: expect.objectContaining({ reason: 'bad-signature' }) });
  });

  it('does NOT record auth.failed for a dev-bypass request', async () => {
    const c = ctx({ bypass: true });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe' });
    expect((c.audit.record as any).mock.calls.filter((a: any[]) => a[0].action === 'auth.failed')).toHaveLength(0);
  });

  it('never includes the token string in the audit row', async () => {
    const c = ctx({ verify: async () => { throw new Error('bad'); } });
    const app = await appWith(c);
    await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer super-secret-token-value' } });
    const calls = (c.audit.record as any).mock.calls;
    expect(JSON.stringify(calls)).not.toContain('super-secret-token-value');
  });

  it("resolves req.user.capabilities from the user's assigned-role capabilities", async () => {
    const c = ctx({
      verify: async () => ({ sub: 's1' }),
      user: { id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active', subject: 's1', rbacInitialized: true },
      roles: { resolveCapabilities: async (subject) => (subject === 's1' ? ['patients.read', 'reports.view'] : []) },
    });
    const app = await appWith(c);
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.capabilities).toEqual(['patients.read', 'reports.view']);
  });

  it('gives the dev-bypass actor every capability', async () => {
    const app = await appWith(ctx({ bypass: true }));
    const res = await app.inject({ method: 'GET', url: '/api/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.capabilities).toHaveLength(CAPABILITY_KEYS.length);
    expect(new Set(res.json().user.capabilities as string[])).toEqual(new Set(CAPABILITY_KEYS));
  });

  it('backfills token realm roles into user_roles exactly once, on first login', async () => {
    let rbacInitialized = false;
    let assignedRoles: string[] = [];
    const backfillUserFromRoleNames = vi.fn(async (_subject: string, roleNames: string[]) => {
      assignedRoles = [...assignedRoles, ...roleNames];
    });
    const resolveCapabilities = vi.fn(async () => (assignedRoles.includes('lab_manager') ? ['reports.manage'] : []));
    const markRbacInitialized = vi.fn(async () => {
      rbacInitialized = true;
    });
    let realmRoles = ['lab_manager'];
    const c: AppContext = {
      cfg: { AUTH_DEV_BYPASS: false, AUTH_DEV_USERNAME: 'dev-admin', AUTH_DEV_ROLES: 'lab_admin' },
      logger: { warn() {}, error() {}, info() {} },
      auth: { verifyToken: async () => ({ sub: 's1', realm_access: { roles: realmRoles } }) },
      audit: { record: vi.fn(async (e: unknown) => ({ ...(e as object), id: 'x', occurredAt: 't' })) },
      roles: { resolveCapabilities, backfillUserFromRoleNames },
      users: {
        isSubjectBlocked: async () => false,
        syncFromClaims: async () => ({ id: 'u1', username: 'ada', displayName: 'Ada', roles: [], status: 'active', subject: 's1', rbacInitialized }),
        getByUsername: async () => undefined,
        create: async () => ({ id: 'dev1', username: 'dev-admin', displayName: 'Dev Admin', roles: ['lab_admin'], status: 'active' }),
        markRbacInitialized,
      },
    } as unknown as AppContext;
    const app = await appWith(c);

    const first = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(first.statusCode).toBe(200);
    expect(backfillUserFromRoleNames).toHaveBeenCalledTimes(1);
    expect(backfillUserFromRoleNames).toHaveBeenCalledWith('s1', ['lab_manager']);
    expect(markRbacInitialized).toHaveBeenCalledTimes(1);
    expect(markRbacInitialized).toHaveBeenCalledWith('u1');
    expect(first.json().user.capabilities).toEqual(['reports.manage']);

    // Second login: token now carries a different realm role. Since rbac_initialized is
    // already true, the backfill must NOT run again — the DB role assignment stays authoritative.
    realmRoles = ['lab_tech'];
    const second = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(second.statusCode).toBe(200);
    expect(backfillUserFromRoleNames).toHaveBeenCalledTimes(1); // still 1 — not re-invoked
    expect(second.json().user.capabilities).toEqual(['reports.manage']); // unaffected by the new token roles
  });
});

describe('registerAuth with local sign-in', () => {
  const SIGN_IN_PATHS = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/setup'];

  async function withProbes(c: AppContext) {
    const app = await appWith(c);
    for (const url of [...SIGN_IN_PATHS, '/api/auth/change-password', '/api/auth/change-password/x', '/api/auth/change-passwordx']) {
      app.post(url, async (req) => ({ user: req.user ?? null, sessionId: req.sessionId ?? null }));
    }
    return app;
  }

  it('lets the four sign-in routes through with no token under local sign-in', async () => {
    const c = ctx({ bypass: false });
    (c as { localSignIn?: unknown }).localSignIn = {};
    const app = await withProbes(c);
    for (const url of SIGN_IN_PATHS) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.json().user).toBeNull();
    }
    const gated = await app.inject({ method: 'POST', url: '/api/auth/change-password' });
    expect(gated.statusCode).toBe(401);
  });

  it('keeps the sign-in paths gated without local sign-in', async () => {
    const app = await withProbes(ctx({ bypass: false }));
    for (const url of SIGN_IN_PATHS) {
      expect((await app.inject({ method: 'POST', url })).statusCode, url).toBe(401);
    }
  });

  const local = (c: AppContext): AppContext => Object.assign(c, { localSignIn: {} });

  it('lets a must-change token reach only the exact change-password path', async () => {
    const app = await withProbes(local(ctx({ verify: async () => ({ sub: 's1', sid: 'sess-1', pwd_change: true }) })));
    const headers = { authorization: 'Bearer good' };
    const ok = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.username).toBe('ada');
    for (const url of ['/api/probe', '/api/auth/change-password/x', '/api/auth/change-passwordx']) {
      const res = await app.inject({ method: url === '/api/probe' ? 'GET' : 'POST', url, headers });
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: 'password_change_required' });
    }
    const query = await app.inject({ method: 'POST', url: '/api/auth/change-password?x=1', headers });
    expect(query.statusCode).toBe(200);
  });

  it('ignores pwd_change unless it is exactly true', async () => {
    const app = await appWith(local(ctx({ verify: async () => ({ sub: 's1', pwd_change: 'true' }) })));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
  });

  it('ignores pwd_change without local sign-in', async () => {
    const app = await appWith(ctx({ verify: async () => ({ sub: 's1', pwd_change: true }) }));
    const res = await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer good' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('ada');
  });

  it('keeps the session ID from a string sid claim only', async () => {
    const withSid = await withProbes(ctx({ verify: async () => ({ sub: 's1', sid: 'sess-1' }) }));
    const a = await withSid.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: 'Bearer good' } });
    expect(a.json().sessionId).toBe('sess-1');
    const numeric = await withProbes(ctx({ verify: async () => ({ sub: 's1', sid: 42 }) }));
    const b = await numeric.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: 'Bearer good' } });
    expect(b.json().sessionId).toBeNull();
  });
});

// `inject` cannot send these request lines, so this suite uses a real listener and a raw socket.
// The router strips `http://host` and decodes percent-escapes before it matches a route, so the
// hook must decide by the route it matched, not by the raw request text.
describe('registerAuth decides by the matched route, not the raw request line', () => {
  /** Send one raw request line and read the status and body. */
  function rawGet(port: number, target: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const sock = connect(port, '127.0.0.1');
      let data = '';
      sock.setEncoding('latin1');
      sock.on('data', (c: string) => { data += c; });
      sock.on('error', reject);
      sock.on('end', () => {
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
        resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
      });
      sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
  }

  /** The same path in the four request-line forms. The encoded form escapes the first letter. */
  function forms(path: string): Record<string, string> {
    const ch = path[1]!;
    const encoded = `/%${ch.charCodeAt(0).toString(16)}${path.slice(2)}`;
    return { path, full: `http://anything${path}`, encoded, both: `http://anything${encoded}` };
  }

  // A key-shaped value, made up for this test. It must be refused before anything reads it.
  const URL_KEY = `oldr_${'A'.repeat(43)}`;

  async function listening() {
    const c = ctx({ bypass: false });
    const keyStoreReads: string[] = [];
    Object.assign(c, {
      localSignIn: {},
      // Any read of the key store is recorded. A key in the URL must never get that far.
      accessKeys: new Proxy({}, { get: (_t, prop) => { keyStoreReads.push(String(prop)); return undefined; } }),
    });
    const app = Fastify();
    registerAuth(app, c);
    const seen = (req: { user?: unknown }) => ({ user: req.user ?? null });
    app.get('/api/thing', async (req) => seen(req));
    app.get('/api/capped', { preHandler: requireCapability('roles.manage') }, async (req) => seen(req));
    app.get('/api/config', async (req) => seen(req));
    app.get('/api/auth/login', async (req) => seen(req));
    app.get('/api/workflows/hooks/*', async (req) => seen(req));
    app.get('/api/sync/pull', async (req) => seen(req));
    app.get('/health', async (req) => seen(req));
    // Registered under a prefix, so the matched pattern must carry the prefix.
    await app.register(async (p) => { p.get('/thing', async (req) => seen(req)); }, { prefix: '/api/pre' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, c, keyStoreReads, port: (app.server.address() as AddressInfo).port };
  }

  const ROUTES = [
    '/api/thing', '/api/capped', '/api/pre/thing', '/api/config', '/api/auth/login',
    '/api/workflows/hooks/abc', '/api/sync/pull', '/health', '/api/zzz',
  ];
  const NEEDS_SIGN_IN = new Set(['/api/thing', '/api/capped', '/api/pre/thing', '/api/zzz']);

  it('gives every form the answer the path form gets, and never answers a signed-in route without sign-in', async () => {
    const { app, c, keyStoreReads, port } = await listening();
    try {
      for (const route of ROUTES) {
        for (const query of ['', `?access_token=${URL_KEY}`]) {
          const expected = await rawGet(port, `${route}${query}`);
          if (NEEDS_SIGN_IN.has(route)) expect(expected.status, `${route}${query}`).toBe(401);
          else if (route !== '/api/zzz') expect(expected.status, `${route}${query}`).not.toBe(401);
          for (const [name, target] of Object.entries(forms(route))) {
            const got = await rawGet(port, `${target}${query}`);
            expect({ status: got.status, body: got.body }, `${name} ${target}${query}`).toEqual({ status: expected.status, body: expected.body });
          }
        }
      }
      // The URL key was refused unread on every form.
      expect(keyStoreReads).toEqual([]);
      expect(JSON.stringify((c.audit.record as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(URL_KEY);
    } finally { await app.close(); }
  });

  it('refuses a key in the URL of a signed-in route in every form, with the key error', async () => {
    const { app, port } = await listening();
    try {
      for (const target of Object.values(forms('/api/thing'))) {
        const got = await rawGet(port, `${target}?access_token=${URL_KEY}`);
        expect(got.status, target).toBe(401);
        expect(JSON.parse(got.body), target).toEqual({ error: 'invalid access key' });
      }
    } finally { await app.close(); }
  });
});
