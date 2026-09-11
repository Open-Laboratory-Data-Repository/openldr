import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    users: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      setRoles: vi.fn(),
      setStatus: vi.fn(),
    },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
  listUserDirectory: vi.fn(),
}));

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('../../bootstrap/src/record-audit', () => ({ recordAuditEvent: mocks.recordAuditEvent }));

vi.mock('@openldr/bootstrap', async () => ({
  ...await import('../../bootstrap/src/account-status'),
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
  listUserDirectory: mocks.listUserDirectory,
}));

import { accountFixture } from '../../bootstrap/src/account-status.test-support';

import { runUserDirectoryList, runUserCreate, runUserSetRole, runUserSetStatus } from './user';

describe('user CLI audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('user create audits user.create (cli, local backend)', async () => {
    mocks.appCtx.users.create.mockResolvedValue({ id: 'u1', username: 'bob', roles: ['lab_tech'] });

    const code = await runUserCreate({ username: 'bob', role: ['lab_tech'], json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.create',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ username: 'bob', roles: ['lab_tech'], backend: 'local' }),
      }),
    );
  });

  it('user set-role audits user.update (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setRoles.mockResolvedValue(undefined);

    const code = await runUserSetRole('u1', ['lab_admin'], { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.update',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ roles: ['lab_admin'], backend: 'local' }),
      }),
    );
  });

  it('user activate audits user.status with enabled:true (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setStatus.mockResolvedValue(undefined);

    const code = await runUserSetStatus('u1', 'active', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.status',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ enabled: true, backend: 'local' }),
      }),
    );
  });

  it('user deactivate audits user.status with enabled:false (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setStatus.mockResolvedValue(undefined);

    const code = await runUserSetStatus('u1', 'disabled', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.status',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ enabled: false, backend: 'local' }),
      }),
    );
  });

  it('does not audit when the target user is not found (set-role)', async () => {
    mocks.appCtx.users.get.mockResolvedValue(undefined);

    const code = await runUserSetRole('missing', ['lab_admin'], { json: true });

    expect(code).toBe(1);
    expect(mocks.appCtx.users.setRoles).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('does not audit when the target user is not found (set-status)', async () => {
    mocks.appCtx.users.get.mockResolvedValue(undefined);

    const code = await runUserSetStatus('missing', 'active', { json: true });

    expect(code).toBe(1);
    expect(mocks.appCtx.users.setStatus).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe('user CLI provider status', () => {
  afterEach(() => vi.restoreAllMocks());
  it('disables the linked provider account using a local id', async () => {
    const f = await accountFixture();
    try {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const local = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      mocks.createAppContext.mockResolvedValue({ ...f.ctx, close: async () => {} });
      expect(await runUserSetStatus(local.id, 'disabled', { json: true })).toBe(0);
      expect(f.provider.enabled).toBe(false);
      expect(await f.users.get(local.id)).toMatchObject({ status: 'disabled' });
      expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ actorName: 'cli' }), expect.objectContaining({ action: 'user.status', entityId: f.provider.id }));
    } finally { await f.db.destroy(); }
  });
  it('disables and enables a generic-provider local account through the shared service', async () => {
    const f = await accountFixture();
    try {
      const local = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      mocks.createAppContext.mockResolvedValue({ ...f.ctx, cfg: { AUTH_ADAPTER: 'oidc' }, close: async () => {} });
      expect(await runUserSetStatus(local.id, 'disabled', { json: true })).toBe(0);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(true);
      expect(await runUserSetStatus(local.id, 'active', { json: true })).toBe(0);
      expect(await f.users.isSubjectBlocked(f.provider.id)).toBe(false);
      expect(f.directory.get).not.toHaveBeenCalled();
      expect(f.directory.update).not.toHaveBeenCalled();
      expect(mocks.recordAuditEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ actorName: 'cli' }), expect.objectContaining({ action: 'user.status', metadata: expect.objectContaining({ backend: 'local' }) }));
    } finally { await f.db.destroy(); }
  });
  it('throws on provider failure without emitting success and preserves the local block', async () => {
    const f = await accountFixture();
    try {
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const local = await f.users.syncFromClaims({ sub: f.provider.id, preferred_username: 'ada' });
      f.directory.update.mockRejectedValueOnce(new Error('provider unavailable'));
      mocks.createAppContext.mockResolvedValue({ ...f.ctx, close: async () => {} });
      await expect(runUserSetStatus(local.id, 'disabled', { json: true })).rejects.toThrow(/local account is disabled/);
      expect(await f.users.get(local.id)).toMatchObject({ status: 'disabled' });
      expect(output).not.toHaveBeenCalled();
    } finally { await f.db.destroy(); }
  });
});

it('directory-list forwards bounded provider options and closes context', async () => {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  const page = { rows: [], offset: 100, limit: 25, total: null, hasMore: false };
  mocks.listUserDirectory.mockResolvedValue(page);
  expect(await runUserDirectoryList({ offset: '100', limit: '25', search: 'Ada', enabled: 'false', json: true })).toBe(0);
  expect(mocks.listUserDirectory).toHaveBeenCalledWith(mocks.appCtx, { offset: '100', limit: '25', search: 'Ada', enabled: 'false' });
  expect(output).toHaveBeenCalledWith(JSON.stringify(page, null, 2) + '\n');
  expect(mocks.appCtx.close).toHaveBeenCalled();
  output.mockRestore();
});
