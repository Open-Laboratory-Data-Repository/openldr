import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { accountFixture } from '../../../packages/bootstrap/src/account-status.test-support';
import { registerUsersRoutes } from './users-routes';
import { registerAuth } from './auth-plugin';

async function setup() {
  const f = await accountFixture();
  const claims = { sub: f.provider.id, preferred_username: 'ada' };
  const ctx = {
    ...f.ctx,
    cfg: { AUTH_DEV_BYPASS: false },
    auth: { ...f.ctx.auth, verifyToken: async () => claims },
    roles: { resolveCapabilities: async () => ['users.view'], backfillUserFromRoleNames: async () => {} },
    userProfiles: { get: async () => undefined },
  } as AppContext;
  const admin = Fastify();
  admin.addHook('preHandler', async req => {
    req.user = { id: 'admin', username: 'admin', displayName: null, roles: [], capabilities: ['users.manage'] };
  });
  registerUsersRoutes(admin, ctx);
  const protectedApp = Fastify();
  registerAuth(protectedApp, ctx);
  protectedApp.get('/api/probe', async () => ({ ok: true }));
  const probe = () => protectedApp.inject({ method: 'GET', url: '/api/probe', headers: { authorization: 'Bearer same-token' } });
  const status = (enabled: boolean) => admin.inject({ method: 'POST', url: `/api/users/${f.provider.id}/status`, payload: { enabled } });
  return { ...f, probe, status, close: async () => { await admin.close(); await protectedApp.close(); await f.db.destroy(); } };
}

describe('account status route and authentication', () => {
  it('rejects the same verified token on the next request, then accepts it after enable', async () => {
    const f = await setup();
    try {
      expect((await f.probe()).statusCode).toBe(200);
      const disabled = await f.status(false);
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json()).toMatchObject({ id: f.provider.id, enabled: false });
      const denied = await f.probe();
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: 'account disabled' });
      expect((await f.status(true)).statusCode).toBe(200);
      expect((await f.probe()).statusCode).toBe(200);
    } finally { await f.close(); }
  });
  it('rejects a first token even when provider disable fails', async () => {
    const f = await setup();
    try {
      f.directory.update.mockRejectedValueOnce(new Error('provider unavailable'));
      const disabled = await f.status(false);
      expect(disabled.statusCode).toBe(502);
      expect(disabled.json().error).toContain('local account is disabled');
      expect((await f.probe()).statusCode).toBe(403);
      expect(f.events).toContainEqual(expect.objectContaining({ action: 'user.status.failed', actorName: 'admin' }));
      expect(f.events.some(e => e.action === 'user.status')).toBe(false);
    } finally { await f.close(); }
  });
  it('keeps rejecting tokens after a failed re-enable', async () => {
    const f = await setup();
    try {
      expect((await f.status(false)).statusCode).toBe(200);
      f.directory.update.mockRejectedValueOnce(new Error('provider unavailable'));
      expect((await f.status(true)).statusCode).toBe(502);
      expect((await f.probe()).statusCode).toBe(403);
    } finally { await f.close(); }
  });
  it('rejects an unseen subject while directory lookup is unavailable without creating a user', async () => {
    const f = await setup();
    try {
      f.directory.get.mockRejectedValueOnce(new Error('provider unavailable'));
      expect((await f.status(false)).statusCode).toBe(502);
      expect((await f.probe()).statusCode).toBe(403);
      expect(await f.users.list()).toHaveLength(0);
    } finally { await f.close(); }
  });

  it('returns a retryable conflict when another status change holds the subject lock', async () => {
    const f = await setup();
    try {
      f.users.withSubjectLock = async () => {
        const error = new Error('another account status change is in progress; retry the action');
        error.name = 'AccountStatusConflictError';
        throw error;
      };
      const result = await f.status(false);
      expect(result.statusCode).toBe(409);
      expect(result.json().error).toContain('retry the action');
      expect(f.provider.enabled).toBe(true);
    } finally { await f.close(); }
  });

});
