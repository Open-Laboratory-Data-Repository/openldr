import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createSyncActivityStore } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAuditStore } from '@openldr/audit';
import { createUpdateCheck, UPDATE_KEYS } from '@openldr/bootstrap';
import { registerNotificationRoutes } from './notification-routes';

const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

async function buildCtx(update: Record<string, string> = {}) {
  const internalDb = await makeMigratedDb();
  const syncActivity = createSyncActivityStore(internalDb);
  const audit = createAuditStore(internalDb);
  // The route reads update state per request; the real check over an in-memory settings map keeps
  // the key names honest (a stub would pass even if the route asked for the wrong thing).
  const settings = new Map<string, string>(Object.entries(update));
  const updateCheck = createUpdateCheck({
    get: async (k: string) => (settings.has(k) ? { value: settings.get(k)! } : undefined),
    set: async (k: string, v: string) => { settings.set(k, v); },
  } as any);
  return { internalDb, syncActivity, audit, updateCheck, logger: nullLogger } as any;
}

function appWithUser(roles: string[], ctx: any, capabilities: string[] = ['notifications.view']) {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => { req.user = { id: 'u1', username: 'analyst', roles, capabilities }; });
  registerNotificationRoutes(app, ctx);
  return app;
}

function appWithoutUser(ctx: any) {
  const app = Fastify();
  registerNotificationRoutes(app, ctx);
  return app;
}

describe('notification routes', () => {
  it('GET /api/notifications is role-gated: no user -> 401', async () => {
    const ctx = await buildCtx();
    const app = appWithoutUser(ctx);
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/notifications is role-gated: wrong role -> 403', async () => {
    const ctx = await buildCtx();
    const app = appWithUser(['lab_technician'], ctx, []);
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/notifications returns { notifications, unreadCount, total } and surfaces a failed sync row', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['data_analyst'], ctx);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('notifications');
    expect(body).toHaveProperty('unreadCount');
    expect(body).toHaveProperty('total');
    expect(body.total).toBe(1);
    expect(body.unreadCount).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].type).toBe('sync_failed');
  });

  it('GET /api/notifications?limit=abc clamps to a normal feed instead of an errored/empty one', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['data_analyst'], ctx);

    const res = await app.inject({ method: 'GET', url: '/api/notifications?limit=abc' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  // The route must actually hand the cached update state to listNotifications — without that the
  // bell renders every other row correctly and silently omits the release.
  it('GET /api/notifications includes the update entry when a newer version is cached', async () => {
    const ctx = await buildCtx({
      [UPDATE_KEYS.latestVersion]: '999.0.0',
      [UPDATE_KEYS.releasedAt]: '2026-08-01',
      [UPDATE_KEYS.notesUrl]: 'https://example.org/notes',
      // PAST, never now: createdAt is compared against the mark-all-read cursor.
      [UPDATE_KEYS.firstSeenAt]: '2026-08-01T00:00:00.000Z',
    });
    const app = appWithUser(['data_analyst'], ctx);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const entry = res.json().notifications.find((n: any) => n.type === 'update_available');
    expect(entry).toBeTruthy();
    expect(entry.id).toBe('update:999.0.0');
    expect(entry.metadata.notesUrl).toBe('https://example.org/notes');
  });

  it('GET /api/notifications has no update entry when the check is off', async () => {
    const ctx = await buildCtx({
      [UPDATE_KEYS.enabled]: 'false',
      [UPDATE_KEYS.latestVersion]: '999.0.0',
      [UPDATE_KEYS.firstSeenAt]: '2026-08-01T00:00:00.000Z',
    });
    const app = appWithUser(['data_analyst'], ctx);
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.json().notifications.some((n: any) => n.type === 'update_available')).toBe(false);
  });

  it('POST /api/notifications/read marks an id read, dropping it from unreadOnly', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['lab_admin'], ctx);

    const before = await app.inject({ method: 'GET', url: '/api/notifications' });
    const id = before.json().notifications[0].id;

    const readRes = await app.inject({ method: 'POST', url: '/api/notifications/read', payload: { ids: [id] } });
    expect(readRes.statusCode).toBe(200);

    const unreadOnly = await app.inject({ method: 'GET', url: '/api/notifications?unreadOnly=true' });
    expect(unreadOnly.statusCode).toBe(200);
    expect(unreadOnly.json().notifications).toHaveLength(0);
  });

  it('POST /api/notifications/read-all sets unreadCount to 0', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['lab_manager'], ctx);

    const readAllRes = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(readAllRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(after.json().unreadCount).toBe(0);
  });

  it('PUT /api/notifications/preferences disabling sync_failed hides it from the list', async () => {
    const ctx = await buildCtx();
    await ctx.syncActivity.record({ direction: 'push', event: 'failed', error: 'central unreachable' });
    const app = appWithUser(['system_auditor'], ctx);

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { prefs: [{ type: 'sync_failed', enabled: false }] },
    });
    expect(putRes.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(after.statusCode).toBe(200);
    expect(after.json().notifications).toEqual([]);
  });
});
