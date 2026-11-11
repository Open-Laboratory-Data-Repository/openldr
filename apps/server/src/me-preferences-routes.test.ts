import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { makeMigratedDb } from '@openldr/db/testing';
import { registerMePreferencesRoutes } from './me-preferences-routes';

// Layer under test: the route plus the shared store, over pg-mem. Not real Postgres, not the
// auth plugin (the user is injected).
async function build(userId?: string, shared?: { internalDb: any }) {
  const ctx = shared ?? { internalDb: await makeMigratedDb() };
  const app = Fastify();
  if (userId) app.addHook('preHandler', async (req: any) => { req.user = { id: userId, username: userId, roles: [], capabilities: [] }; });
  registerMePreferencesRoutes(app, ctx as any);
  return { app, ctx };
}

describe('/api/me/preferences', () => {
  it('needs a signed-in user', async () => {
    const { app } = await build();
    expect((await app.inject({ method: 'GET', url: '/api/me/preferences' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/me/preferences', payload: { theme: 'dark' } })).statusCode).toBe(401);
  });

  it('works for a user with no capabilities at all, starting empty', async () => {
    const { app } = await build('u1');
    const res = await app.inject({ method: 'GET', url: '/api/me/preferences' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('saves a patch and returns the merged result', async () => {
    const { app } = await build('u1');
    await app.inject({ method: 'PUT', url: '/api/me/preferences', payload: { theme: 'dark' } });
    const put = await app.inject({ method: 'PUT', url: '/api/me/preferences', payload: { startPage: '/reports', sidebarCollapsed: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ theme: 'dark', startPage: '/reports', sidebarCollapsed: true });
    expect((await app.inject({ method: 'GET', url: '/api/me/preferences' })).json()).toEqual({ theme: 'dark', startPage: '/reports', sidebarCollapsed: true });
  });

  it("never touches another user's preferences", async () => {
    const a = await build('u1');
    const b = await build('u2', a.ctx);
    await a.app.inject({ method: 'PUT', url: '/api/me/preferences', payload: { theme: 'dark' } });
    await b.app.inject({ method: 'PUT', url: '/api/me/preferences', payload: { theme: 'light' } });
    expect((await a.app.inject({ method: 'GET', url: '/api/me/preferences' })).json()).toEqual({ theme: 'dark' });
    expect((await b.app.inject({ method: 'GET', url: '/api/me/preferences' })).json()).toEqual({ theme: 'light' });
  });

  it.each([
    { theme: 'purple' },
    { startPage: 'https://evil.test' },
    { startPage: '//evil.test' },
    { userId: 'u2', theme: 'dark' },
    ['theme', 'dark'],
  ])('refuses %j with a 400 and saves nothing', async (payload) => {
    const { app } = await build('u1');
    const res = await app.inject({ method: 'PUT', url: '/api/me/preferences', payload: payload as any });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid preferences' });
    expect((await app.inject({ method: 'GET', url: '/api/me/preferences' })).json()).toEqual({});
  });
});
