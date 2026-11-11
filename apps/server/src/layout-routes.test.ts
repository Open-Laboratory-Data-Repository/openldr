import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeMigratedDb } from '@openldr/db/testing';
import { createRoleStore } from '@openldr/db';
import { registerLayoutRoutes } from './layout-routes';

// Layer under test: the routes plus the shared store, over pg-mem. Not real Postgres, not the
// auth plugin (the user is injected).
async function build(caps: string[] | null, tokenRoles: string[] = [], devBypass = false) {
  const internalDb = await makeMigratedDb();
  const roles = createRoleStore(internalDb as never);
  await internalDb.insertInto('roles').values([{ id: 'rb', slug: 'bench', name: 'Bench staff', description: null, is_system: false }] as never).execute();
  const audited: Array<{ action: string; entityId?: string; metadata?: unknown }> = [];
  const ctx = {
    cfg: { AUTH_DEV_BYPASS: devBypass }, internalDb, roles, audit: { record: async (e: any) => { audited.push(e); } }, logger: { warn() {}, error() {}, info() {}, debug() {} },
    // u1 signs in as subject sub-1; 'dev:x' has no users row, like the dev sign-in.
    users: { get: async (id: string) => (id === 'u1' ? { id: 'u1', subject: 'sub-1' } : undefined) },
  };
  const app = Fastify();
  if (caps) app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles: tokenRoles, capabilities: caps }; });
  registerLayoutRoutes(app, ctx as any);
  return { app, audited, roles };
}

const bench = { name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] };

describe('/api/layouts', () => {
  it('needs a signed-in user to read, and settings.edit_general to change', async () => {
    const anon = await build(null);
    expect((await anon.app.inject({ method: 'GET', url: '/api/layouts' })).statusCode).toBe(401);
    const user = await build([]);
    expect((await user.app.inject({ method: 'GET', url: '/api/layouts' })).json()).toEqual({ layouts: [], roleOrder: [], myRoles: [] });
    expect((await user.app.inject({ method: 'POST', url: '/api/layouts', payload: bench })).statusCode).toBe(403);
    expect((await user.app.inject({ method: 'PUT', url: '/api/layouts/x', payload: bench })).statusCode).toBe(403);
    expect((await user.app.inject({ method: 'DELETE', url: '/api/layouts/x' })).statusCode).toBe(403);
  });

  it('creates, lists, updates and deletes, auditing each change', async () => {
    const { app, audited } = await build(['settings.edit_general']);
    const made = await app.inject({ method: 'POST', url: '/api/layouts', payload: bench });
    expect(made.statusCode).toBe(200);
    const id = made.json().id;
    expect((await app.inject({ method: 'GET', url: '/api/layouts' })).json()).toEqual({
      layouts: [{ id, name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] }],
      roleOrder: ['bench'],
      myRoles: [],
    });
    const put = await app.inject({ method: 'PUT', url: `/api/layouts/${id}`, payload: { ...bench, roles: [] } });
    expect(put.json().roles).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/layouts/${id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/layouts' })).json().layouts).toEqual([]);
    expect(audited.map((a) => a.action)).toEqual(['layout.create', 'layout.update', 'layout.delete']);
    expect(audited[0]).toMatchObject({ entityId: id, metadata: { name: 'Bench' } });
  });

  it('answers 400 for bad input, 404 for an unknown id, 409 for a duplicate name', async () => {
    const { app } = await build(['settings.edit_general']);
    expect((await app.inject({ method: 'POST', url: '/api/layouts', payload: { ...bench, pages: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/layouts', payload: { ...bench, roles: ['nope'] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/layouts/missing', payload: bench })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/layouts/missing' })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: '/api/layouts', payload: bench });
    const dup = await app.inject({ method: 'POST', url: '/api/layouts', payload: { ...bench, roles: [] } });
    expect(dup.statusCode).toBe(409);
  });

  // The roles a user really has are the user_roles rows (what the Roles page assigns), not the
  // sign-in token's roles: the token has none on an OIDC install and goes stale on Keycloak.
  it("returns the caller's roles from user_roles, not from the sign-in token", async () => {
    const { app, roles } = await build([], ['lab_admin']);
    await roles.assignRole('sub-1', 'rb');
    expect((await app.inject({ method: 'GET', url: '/api/layouts' })).json().myRoles).toEqual(['bench']);
  });

  // The dev sign-in (bypass on, no bearer token) has a users row but no user_roles rows: its roles
  // come from AUTH_DEV_ROLES and it holds every capability (auth-plugin.ts devActor). Use those.
  it('uses the dev sign-in roles when the dev bypass signed the request in', async () => {
    const { app } = await build([], ['lab_admin'], true);
    expect((await app.inject({ method: 'GET', url: '/api/layouts' })).json().myRoles).toEqual(['lab_admin']);
    // A real bearer token is never the dev actor, even with the bypass on.
    const withToken = await app.inject({ method: 'GET', url: '/api/layouts', headers: { authorization: 'Bearer abc' } });
    expect(withToken.json().myRoles).toEqual([]);
  });

  // Two saves at the same instant: Postgres refuses the second with 23505. Answer 409, not 500.
  it('answers 409 when Postgres refuses a save that raced another', async () => {
    const raced = { code: '23505', constraint: 'role_layout_defaults_pkey' };
    const internalDb = { transaction: () => ({ execute: async () => { throw raced; } }) };
    const ctx = { cfg: {}, internalDb, roles: {}, users: { get: async () => undefined }, audit: { record: async () => {} }, logger: { warn() {}, error() {}, info() {}, debug() {} } };
    const app = Fastify();
    app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles: [], capabilities: ['settings.edit_general'] }; });
    registerLayoutRoutes(app, ctx as any);
    const res = await app.inject({ method: 'POST', url: '/api/layouts', payload: bench });
    expect(res.statusCode).toBe(409);
  });
});
