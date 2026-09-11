import { describe, it, expect, vi } from 'vitest';
import { setAccountStatus } from './account-status';
import { accountFixture } from './account-status.test-support';

const actor = { actorType: 'cli' as const, actorName: 'cli', actorId: null };

describe('account status service', () => {
  it.each(['setStatus', 'unblockSubject'] as const)('keeps generic access blocked when enabling fails at %s', async (method) => {
    const f = await accountFixture();
    f.ctx.cfg = { AUTH_ADAPTER: 'oidc' };
    try {
      const user = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      await setAccountStatus(f.ctx, { localId: user.id }, false, actor);
      vi.spyOn(f.users, method).mockRejectedValueOnce(new Error('storage failure'));
      await expect(setAccountStatus(f.ctx, { localId: user.id }, true, actor)).rejects.toThrow(/access remains blocked/);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(f.directory.get).not.toHaveBeenCalled();
      expect(f.events.at(-1)).toMatchObject({ action: 'user.status.failed', metadata: { backend: 'local', subjectBlocked: true } });
    } finally { await f.db.destroy(); }
  });
  it('disables and enables a linked local account without provider administration', async () => {
    const f = await accountFixture();
    f.ctx.cfg = { AUTH_ADAPTER: 'oidc', IDENTITY_ADMIN_ADAPTER: 'none' };
    try {
      const user = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      await setAccountStatus(f.ctx, { localId: user.id }, false, actor);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(await f.users.get(user.id)).toMatchObject({ status: 'disabled' });
      await setAccountStatus(f.ctx, { localId: user.id }, true, actor);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(false);
      expect(await f.users.get(user.id)).toMatchObject({ status: 'active' });
      expect(f.directory.get).not.toHaveBeenCalled();
      expect(f.directory.update).not.toHaveBeenCalled();
      expect(f.events.at(-1)).toMatchObject({ action: 'user.status', metadata: { backend: 'local' } });
    } finally { await f.db.destroy(); }
  });
  it('disables a provider subject before its first login and re-enables it', async () => {
    const f = await accountFixture();
    try {
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      expect(f.provider.enabled).toBe(false);
      expect(await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' })).toMatchObject({ status: 'disabled', username: 'ada' });
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, true, actor);
      expect(f.provider.enabled).toBe(true);
      expect(await f.users.getBySubject(f.provider.id)).toMatchObject({ status: 'active' });
      expect(f.events.at(-1)).toMatchObject({ action: 'user.status', actorName: 'cli' });
    } finally { await f.db.destroy(); }
  });
  it('uses the linked subject when the CLI supplies a local id', async () => {
    const f = await accountFixture();
    try {
      const user = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      await setAccountStatus(f.ctx, { localId: user.id }, false, actor);
      expect(f.provider.enabled).toBe(false);
      expect(await f.users.get(user.id)).toMatchObject({ status: 'disabled' });
    } finally { await f.db.destroy(); }
  });
  it('keeps local-only accounts independent of the provider', async () => {
    const f = await accountFixture();
    try {
      const user = await f.users.create({ username: 'local' });
      await setAccountStatus(f.ctx, { localId: user.id }, false, actor);
      expect(await f.users.get(user.id)).toMatchObject({ subject: null, status: 'disabled' });
      expect(f.directory.get).not.toHaveBeenCalled();
      expect(f.events.at(-1).metadata.backend).toBe('local');
    } finally { await f.db.destroy(); }
  });
  it('reports provider disable failure while retaining the local block', async () => {
    const f = await accountFixture();
    try {
      f.directory.update.mockRejectedValueOnce(new Error('provider down'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor)).rejects.toThrow(/local account is disabled/);
      expect(await f.users.syncFromClaims({ sub: f.provider.id })).toMatchObject({ status: 'disabled' });
      expect(f.events.at(-1)).toMatchObject({ action: 'user.status.failed', metadata: { localStatus: 'disabled' } });
    } finally { await f.db.destroy(); }
  });
  it('does not lift the local block if provider enable fails', async () => {
    const f = await accountFixture();
    try {
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      f.directory.update.mockRejectedValueOnce(new Error('provider down'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, true, actor)).rejects.toThrow();
      expect(await f.users.getBySubject(f.provider.id)).toMatchObject({ status: 'disabled' });
      expect(f.provider.enabled).toBe(false);
    } finally { await f.db.destroy(); }
  });
  it('reports a local failure after provider enable without reporting success', async () => {
    const f = await accountFixture();
    try {
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      vi.spyOn(f.users, 'setSubjectStatus').mockRejectedValueOnce(new Error('db write failed'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, true, actor)).rejects.toThrow(/provider was enabled/);
      expect(f.provider.enabled).toBe(true);
      expect(await f.users.getBySubject(f.provider.id)).toMatchObject({ status: 'disabled' });
      expect(f.events.at(-1).action).toBe('user.status.failed');
    } finally { await f.db.destroy(); }
  });
  it('blocks local access even if the provider lookup fails', async () => {
    const f = await accountFixture();
    try {
      f.directory.get.mockRejectedValueOnce(new Error('provider unavailable'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor)).rejects.toThrow(/local account is disabled/);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(await f.users.getBySubject(f.provider.id)).toBeUndefined();
      expect(f.directory.update).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
  it('does not disable the provider when writing the local block fails', async () => {
    const f = await accountFixture();
    try {
      vi.spyOn(f.users, 'blockSubject').mockRejectedValueOnce(new Error('database unavailable'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor)).rejects.toThrow('database unavailable');
      expect(f.directory.get).not.toHaveBeenCalled();
      expect(f.provider.enabled).toBe(true);
      expect(f.events.at(-1).action).toBe('user.status.failed');
    } finally { await f.db.destroy(); }
  });

  it('keeps the preprovisioned local identity and fields through disable and enable', async () => {
    const f = await accountFixture();
    try {
      const local = await f.users.create({ username: 'ada', displayName: 'Ada', email: 'ada@example.test', roles: ['custom-role'] });
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      expect(await f.users.getBySubject(f.provider.id)).toMatchObject({ id: local.id, displayName: 'Ada', email: 'ada@example.test', roles: ['custom-role'], status: 'disabled' });
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, true, actor);
      expect(await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' })).toMatchObject({ id: local.id, status: 'active' });
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(false);
      expect(await f.users.list()).toHaveLength(1);
    } finally { await f.db.destroy(); }
  });
  it('keeps an unknown subject blocked during lookup failure without orphaning an unclaimed user', async () => {
    const f = await accountFixture();
    try {
      const local = await f.users.create({ username: 'ada' });
      f.directory.get.mockRejectedValueOnce(new Error('provider unavailable'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor)).rejects.toThrow();
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(await f.users.list()).toHaveLength(1);
      expect(await f.users.get(local.id)).toMatchObject({ subject: null });
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      expect(await f.users.getBySubject(f.provider.id)).toMatchObject({ id: local.id, status: 'disabled' });
    } finally { await f.db.destroy(); }
  });
  it('keeps the subject block if clearing it after enable fails', async () => {
    const f = await accountFixture();
    try {
      await setAccountStatus(f.ctx, { providerSubject: f.provider.id }, false, actor);
      vi.spyOn(f.users, 'unblockSubject').mockRejectedValueOnce(new Error('database unavailable'));
      await expect(setAccountStatus(f.ctx, { providerSubject: f.provider.id }, true, actor)).rejects.toThrow(/Local access remains blocked/);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(f.events.at(-1).action).toBe('user.status.failed');
    } finally { await f.db.destroy(); }
  });

});
