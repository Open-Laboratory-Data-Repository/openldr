import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { DataScope } from '@openldr/rbac';
import { registerRolesRoutes } from './roles-routes';
import './auth-plugin';

// Roles part 3: read and set a user's data limit. Set needs roles.manage, checks the register, and
// audits before and after as objects (node-pg would send a bare array as a Postgres array literal).
function setup(capabilities: string[]) {
  const saved = new Map<string, DataScope>();
  const audit: any[] = [];
  const facilities = [{ id: 'f1', region: 'Dodoma', district: 'Kondoa' }];
  const ctx = {
    dataScopes: {
      async get(s: string) { return saved.get(s) ?? { limited: false }; },
      async set(s: string, scope: DataScope) { const before = saved.get(s) ?? { limited: false }; saved.set(s, scope); return { before, after: scope }; },
    },
    users: { async get(id: string) { return id === 'u1' ? { id } : undefined; }, async getBySubject(s: string) { return s === 'sub-1' ? { id: 'u1' } : undefined; } },
    roles: { async rolesForUser() { return []; } },
    facilityRegistry: {
      async get(id: string) { return facilities.find((f) => f.id === id); },
      async list(o: { region?: string; district?: string }) {
        const rows = facilities.filter((f) => (!o.region || f.region === o.region) && (!o.district || f.district === o.district));
        return { rows, total: rows.length };
      },
    },
    audit: { record: async (e: any) => { audit.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as any;
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => { req.user = { id: 'admin', username: 'admin', displayName: null, roles: [], capabilities }; });
  registerRolesRoutes(app, ctx);
  return { app, saved, audit };
}
const MANAGE = ['roles.manage', 'roles.view'];
const limit = { limited: true, facilities: ['f1'], districts: [{ region: 'Dodoma', district: 'Kondoa' }], regions: ['Dodoma'] };

describe('user data limit routes', () => {
  it('reads Everything for a user with no limit', async () => {
    const res = await setup(['users.view']).app.inject({ url: '/api/users/sub-1/data-scope' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ limited: false });
  });

  it('sets a limit, answers it, and audits before and after as objects', async () => {
    const { app, saved, audit } = setup(MANAGE);
    const res = await app.inject({ method: 'PUT', url: '/api/users/sub-1/data-scope', payload: limit });
    expect(res.json()).toEqual(limit);
    expect(res.statusCode).toBe(200);
    expect(saved.get('sub-1')).toEqual(limit);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'user.data_scope.set', entityType: 'user', entityId: 'sub-1', before: { limited: false }, after: limit });
    expect(Array.isArray(audit[0].before) || Array.isArray(audit[0].after)).toBe(false);
  });

  it('refuses without roles.manage, a bad body, an unknown user and a place not in the register, saving nothing', async () => {
    expect((await setup(['roles.view', 'users.manage']).app.inject({ method: 'PUT', url: '/api/users/sub-1/data-scope', payload: limit })).statusCode).toBe(403);
    const { app, saved, audit } = setup(MANAGE);
    expect((await app.inject({ method: 'PUT', url: '/api/users/sub-1/data-scope', payload: { limited: true, facilities: 'f1' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/users/ghost/data-scope', payload: limit })).statusCode).toBe(404);
    const away = await app.inject({ method: 'PUT', url: '/api/users/sub-1/data-scope', payload: { ...limit, regions: ['Nowhere'] } });
    expect(away.statusCode).toBe(400);
    expect(away.json().error).toMatch(/Nowhere/);
    expect(saved.size).toBe(0);
    expect(audit).toHaveLength(0);
  });
});
