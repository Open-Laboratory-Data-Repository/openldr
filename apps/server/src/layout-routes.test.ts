import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerLayoutRoutes } from './layout-routes';

// Layer under test: the routes plus the shared store, over pg-mem. Not real Postgres, not the
// auth plugin (the user is injected).
async function build(caps: string[] | null) {
  const internalDb = await makeMigratedDb();
  await internalDb.insertInto('roles').values([{ id: 'rb', slug: 'bench', name: 'Bench staff', description: null, is_system: false }] as never).execute();
  const audited: Array<{ action: string; entityId?: string; metadata?: unknown }> = [];
  const ctx = { internalDb, audit: { record: async (e: any) => { audited.push(e); } }, logger: { warn() {}, error() {}, info() {}, debug() {} } };
  const app = Fastify();
  if (caps) app.addHook('onRequest', async (req: any) => { req.user = { id: 'u1', username: 'admin', roles: [], capabilities: caps }; });
  registerLayoutRoutes(app, ctx as any);
  return { app, audited };
}

const bench = { name: 'Bench', startPage: '/forms', pages: ['/forms', '/patients'], roles: ['bench'] };

describe('/api/layouts', () => {
  it('needs a signed-in user to read, and settings.edit_general to change', async () => {
    const anon = await build(null);
    expect((await anon.app.inject({ method: 'GET', url: '/api/layouts' })).statusCode).toBe(401);
    const user = await build([]);
    expect((await user.app.inject({ method: 'GET', url: '/api/layouts' })).json()).toEqual({ layouts: [], roleOrder: [] });
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
});
