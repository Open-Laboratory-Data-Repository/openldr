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

// The local-account actions run for real, wrapped so a test can see whether they were called.
// Their audit writes land in mocks.recordAuditEvent through the record-audit mock above.
vi.mock('@openldr/bootstrap', async () => {
  const local = await import('../../bootstrap/src/local-accounts');
  return {
    ...await import('../../bootstrap/src/account-status'),
    ...local,
    createLocalAccount: vi.fn(local.createLocalAccount),
    resetLocalPassword: vi.fn(local.resetLocalPassword),
    endLocalSessions: vi.fn(local.endLocalSessions),
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    listUserDirectory: mocks.listUserDirectory,
  };
});

import { createLocalAccount, resetLocalPassword, endLocalSessions } from '@openldr/bootstrap';
import { accountFixture } from '../../bootstrap/src/account-status.test-support';

import {
  runUserDirectoryList, runUserCreate, runUserSetRole, runUserSetStatus, runUserResetPassword, runUserEndSessions,
} from './user';

function localCtx() {
  return {
    localSignIn: { setupRequired: vi.fn().mockResolvedValue(false) },
    auth: {
      directory: {
        create: vi.fn(async (input: { username: string; password?: string }) => ({
          id: 'u-new', username: input.username, email: null, firstName: null, lastName: null, enabled: true, roles: [], createdAt: null,
        })),
      },
      resetPassword: vi.fn().mockResolvedValue(undefined),
      forceLogout: vi.fn().mockResolvedValue(undefined),
    },
    users: {
      getByUsername: vi.fn(async (username: string) => (username === 'bob' ? { id: 'u1', username: 'bob' } : undefined)),
      create: vi.fn(),
    },
    audit: {},
    logger: {},
    close: vi.fn(),
  };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('user commands under local sign-in', () => {
  let out: string;
  let err: string;
  let ctx: ReturnType<typeof localCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { err += String(chunk); return true; });
    ctx = localCtx();
    mocks.createAppContext.mockResolvedValue(ctx);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('reset-password refuses without --force and changes nothing', async () => {
    const code = await runUserResetPassword('bob', { json: false, force: false });

    expect(code).toBe(1);
    expect(err).toContain('sessions');
    expect(err).toContain('--force');
    expect(resetLocalPassword).not.toHaveBeenCalled();
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(ctx.auth.resetPassword).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('reset-password prints the temporary password once with --force', async () => {
    const code = await runUserResetPassword('bob', { json: false, force: true });

    expect(code).toBe(0);
    const [userId, password, temporary] = ctx.auth.resetPassword.mock.calls[0];
    expect(userId).toBe('u1');
    expect(temporary).toBe(true);
    expect(occurrences(out, password)).toBe(1);
    expect(err).not.toContain(password);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'user.reset_password', entityId: 'u1' }),
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain(password);
    expect(ctx.close).toHaveBeenCalled();
  });

  it('reset-password puts the temporary password in the JSON output', async () => {
    const code = await runUserResetPassword('bob', { json: true, force: true });

    expect(code).toBe(0);
    const password = ctx.auth.resetPassword.mock.calls[0][1];
    expect(JSON.parse(out)).toEqual({ username: 'bob', temporaryPassword: password });
  });

  it('reset-password exits 1 for an unknown user', async () => {
    const code = await runUserResetPassword('Bob', { json: false, force: true });

    expect(code).toBe(1);
    expect(err).toBe('no user named Bob. Usernames here match exactly, including case.\n');
    expect(out).toBe('');
    expect(ctx.auth.resetPassword).not.toHaveBeenCalled();
  });

  it('reset-password exits 1 when local sign-in is off', async () => {
    const { localSignIn: _off, ...keycloakCtx } = ctx;
    mocks.createAppContext.mockResolvedValue(keycloakCtx);

    const code = await runUserResetPassword('bob', { json: false, force: true });

    expect(code).toBe(1);
    expect(err).toBe('local sign-in is not enabled\n');
    expect(ctx.auth.resetPassword).not.toHaveBeenCalled();
  });

  it('end-sessions calls endLocalSessions', async () => {
    const code = await runUserEndSessions('bob', { json: false });

    expect(code).toBe(0);
    expect(endLocalSessions).toHaveBeenCalledWith(ctx, expect.objectContaining({ actorType: 'cli' }), 'bob');
    expect(ctx.auth.forceLogout).toHaveBeenCalledWith('u1');
    expect(out).toBe('ended sessions for bob\n');
    expect(ctx.close).toHaveBeenCalled();
  });

  it('end-sessions exits 1 for an unknown user', async () => {
    const code = await runUserEndSessions('Bob', { json: false });

    expect(code).toBe(1);
    expect(err).toBe('no user named Bob. Usernames here match exactly, including case.\n');
    expect(ctx.auth.forceLogout).not.toHaveBeenCalled();
  });

  it('end-sessions exits 1 when local sign-in is off', async () => {
    const { localSignIn: _off, ...keycloakCtx } = ctx;
    mocks.createAppContext.mockResolvedValue(keycloakCtx);

    const code = await runUserEndSessions('bob', { json: false });

    expect(code).toBe(1);
    expect(err).toBe('local sign-in is not enabled\n');
    expect(ctx.auth.forceLogout).not.toHaveBeenCalled();
  });

  it('user create under local sign-in goes through the directory', async () => {
    const code = await runUserCreate({ username: 'carol', name: 'Carol', email: 'carol@lab.test', role: ['lab_tech'], json: false });

    expect(code).toBe(0);
    expect(createLocalAccount).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ actorType: 'cli' }),
      { username: 'carol', name: 'Carol', email: 'carol@lab.test', roles: ['lab_tech'] },
    );
    expect(ctx.users.create).not.toHaveBeenCalled();
    const password = ctx.auth.directory.create.mock.calls[0][0].password!;
    expect(password).toHaveLength(16);
    expect(occurrences(out, password)).toBe(1);
    expect(err).not.toContain(password);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'user.create', entityId: 'u-new' }),
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain(password);
  });

  it('user create under local sign-in puts the temporary password in the JSON output', async () => {
    const code = await runUserCreate({ username: 'carol', json: true });

    expect(code).toBe(0);
    const password = ctx.auth.directory.create.mock.calls[0][0].password!;
    const body = JSON.parse(out);
    expect(body.temporaryPassword).toBe(password);
    expect(body.user).toMatchObject({ id: 'u-new', username: 'carol' });
  });

  it('user create under local sign-in refuses before setup is done', async () => {
    ctx.localSignIn.setupRequired.mockResolvedValue(true);

    const code = await runUserCreate({ username: 'carol', json: false });

    expect(code).toBe(1);
    expect(err).toBe('no administrator exists yet. Run "openldr auth setup-code" and finish setup in studio first.\n');
    expect(createLocalAccount).not.toHaveBeenCalled();
    expect(ctx.auth.directory.create).not.toHaveBeenCalled();
    expect(ctx.users.create).not.toHaveBeenCalled();
  });

  it('user create under keycloak still writes the local row', async () => {
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.users.create.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });

    const code = await runUserCreate({ username: 'bob', json: true });

    expect(code).toBe(0);
    expect(mocks.appCtx.users.create).toHaveBeenCalledWith({ username: 'bob', displayName: undefined, email: undefined, roles: undefined });
    expect(createLocalAccount).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual({ id: 'u1', username: 'bob', roles: [] });
  });
});

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
