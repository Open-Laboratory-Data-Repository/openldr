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
    ...await import('../../bootstrap/src/access-keys'),
    ...local,
    createLocalAccount: vi.fn(local.createLocalAccount),
    resetLocalPassword: vi.fn(local.resetLocalPassword),
    endLocalSessions: vi.fn(local.endLocalSessions),
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    listUserDirectory: mocks.listUserDirectory,
  };
});

import { createLocalAccount, resetLocalPassword, endLocalSessions, createAccessKey, hashAccessKey } from '@openldr/bootstrap';
import { createAccessKeyStore } from '@openldr/db';
import { accountFixture } from '../../bootstrap/src/account-status.test-support';
import { makeMigratedDb } from '../../db/src/migrations/internal/test-helpers';

import {
  runUserDirectoryList, runUserCreate, runUserSetRole, runUserSetStatus, runUserResetPassword, runUserEndSessions,
  runUserKeyList, runUserKeyCreate, runUserKeyRevoke,
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
    roles: {
      getBySlug: vi.fn(async (slug: string) => (slug === 'lab_technician' ? { id: 'role-tech', slug } : null)),
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
    const code = await runUserCreate({ username: 'carol', name: 'Carol', email: 'carol@lab.test', role: ['lab_technician'], json: false });

    expect(code).toBe(0);
    expect(createLocalAccount).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ actorType: 'cli' }),
      { username: 'carol', name: 'Carol', email: 'carol@lab.test', roles: ['lab_technician'] },
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

  it('user create under local sign-in refuses a role that does not exist', async () => {
    const code = await runUserCreate({ username: 'carol', role: ['lab_tech'], json: false });

    expect(code).toBe(1);
    expect(err).toBe('no role named lab_tech\n');
    expect(out).toBe('');
    expect(ctx.auth.directory.create).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
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

  it('creates an account with no password and prints no password', async () => {
    const code = await runUserCreate({ username: 'bot', role: ['lab_technician'], password: false, json: false });

    expect(code).toBe(0);
    expect(createLocalAccount).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ actorType: 'cli' }),
      { username: 'bot', name: undefined, email: undefined, roles: ['lab_technician'], password: 'none' },
    );
    const directoryInput = ctx.auth.directory.create.mock.calls[0][0];
    expect(directoryInput).not.toHaveProperty('password');
    expect(directoryInput).not.toHaveProperty('temporaryPassword');
    expect(out).toBe('created bot (u-new)\nbot has no password and cannot sign in to Studio.\n');
    expect(out).not.toMatch(/temporary password/i);
    expect(err).toBe('');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'user.create', entityId: 'u-new', metadata: expect.objectContaining({ password: 'none' }) }),
    );
  });

  it('creates an account with no password and has no password field in the JSON output', async () => {
    const code = await runUserCreate({ username: 'bot', password: false, json: true });

    expect(code).toBe(0);
    const body = JSON.parse(out);
    expect(Object.keys(body)).toEqual(['user']);
    expect(body.user).toMatchObject({ id: 'u-new', username: 'bot' });
  });

  it('user create --no-password under keycloak writes the local row as before', async () => {
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
    mocks.appCtx.users.create.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });

    const code = await runUserCreate({ username: 'bob', password: false, json: true });

    expect(code).toBe(0);
    expect(mocks.appCtx.users.create).toHaveBeenCalledWith({ username: 'bob', displayName: undefined, email: undefined, roles: undefined });
    expect(createLocalAccount).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toEqual({ id: 'u1', username: 'bob', roles: [] });
  });
});

describe('user key commands (pg-mem)', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  let keyCtx: {
    accessKeys: ReturnType<typeof createAccessKeyStore>;
    users: { get: (id: string) => Promise<unknown>; getByUsername: (username: string) => Promise<unknown> };
    audit: object; logger: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    close: ReturnType<typeof vi.fn>;
  };
  let out: string;
  let err: string;
  const admin = { actorType: 'user' as const, actorId: null, actorName: 'admin' };
  const people: Record<string, { id: string; username: string }> = {
    bob: { id: 'u1', username: 'bob' },
    ann: { id: 'u2', username: 'ann' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await makeMigratedDb();
    for (const p of Object.values(people)) {
      await db.insertInto('users').values({ id: p.id, subject: p.id, username: p.username, roles: JSON.stringify([]) as never }).execute();
    }
    keyCtx = {
      accessKeys: createAccessKeyStore(db),
      users: {
        get: async (id: string) => Object.values(people).find((p) => p.id === id),
        getByUsername: async (username: string) => people[username],
      },
      audit: {},
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      close: vi.fn(),
    };
    mocks.createAppContext.mockResolvedValue(keyCtx);
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { err += String(chunk); return true; });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.destroy(); });

  const makeKey = (userId: string, name: string) => createAccessKey(keyCtx as never, admin, { userId, name });

  function expectNoKeyLogged(key: string): void {
    const logged = JSON.stringify(keyCtx.logger.warn.mock.calls) + JSON.stringify(keyCtx.logger.info.mock.calls)
      + JSON.stringify(keyCtx.logger.error.mock.calls);
    expect(logged).not.toContain(key);
  }

  it('lists keys as text and as JSON, without any key value', async () => {
    const made = await makeKey('u1', 'ci');
    await makeKey('u2', 'ann-key');

    expect(await runUserKeyList('bob', { json: false })).toBe(0);
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].split('\t')).toEqual([made.record.id, 'ci', made.record.prefix, made.record.createdAt, '-', '-', '-']);
    expect(out).not.toContain(made.key);
    expect(out).not.toContain(hashAccessKey(made.key));
    expect(out).not.toContain('ann-key');

    out = '';
    expect(await runUserKeyList('bob', { json: true })).toBe(0);
    expect(JSON.parse(out)).toEqual([made.record]);
    expect(out).not.toContain(made.key);
    expect(out).not.toContain(hashAccessKey(made.key));
    expect(keyCtx.close).toHaveBeenCalledTimes(2);
  });

  it('lists no keys as a plain line', async () => {
    expect(await runUserKeyList('bob', { json: false })).toBe(0);
    expect(out).toBe('(no keys)\n');
  });

  it('gives the same unknown-user message as the other user commands', async () => {
    expect(await runUserKeyList('Bob', { json: false })).toBe(1);
    expect(await runUserKeyCreate('Bob', { name: 'ci', json: false })).toBe(1);
    expect(await runUserKeyRevoke('Bob', 'k1', { force: true })).toBe(1);
    expect(err).toBe('no user named Bob. Usernames here match exactly, including case.\n'.repeat(3));
    expect(out).toBe('');
    expect(await db.selectFrom('access_keys').selectAll().execute()).toEqual([]);
  });

  it('creates a key and prints it once', async () => {
    expect(await runUserKeyCreate('bob', { name: 'ci', json: false })).toBe(0);

    expect(out).toMatch(/^oldr_[A-Za-z0-9_-]{43}\n$/);
    const key = out.trimEnd();
    expect(err).toContain('cannot be shown again');
    expect(err.trimEnd().split('\n')).toHaveLength(1);
    expect(err).not.toContain(key);
    const rows = await db.selectFrom('access_keys').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 'u1', name: 'ci', key_hash: hashAccessKey(key), expires_at: null });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'access_key.create', entityId: rows[0].id }),
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain(key);
    expectNoKeyLogged(key);
    expect(keyCtx.close).toHaveBeenCalled();
  });

  it('creates a key as one JSON object with the notice on standard error', async () => {
    expect(await runUserKeyCreate('bob', { name: 'ci', json: true })).toBe(0);

    const body = JSON.parse(out);
    expect(Object.keys(body).sort()).toEqual(['key', 'record']);
    expect(body.key).toMatch(/^oldr_/);
    expect(body.record).toMatchObject({ userId: 'u1', name: 'ci', prefix: body.key.slice(0, 12) });
    expect(err).toContain('cannot be shown again');
    expect(err).not.toContain(body.key);
  });

  it('reads a bare --expires date as the end of that day in UTC, and takes a full date-time', async () => {
    const year = new Date().getUTCFullYear() + 2;
    expect(await runUserKeyCreate('bob', { name: 'dated', expires: `${year}-03-31`, json: true })).toBe(0);
    expect(JSON.parse(out).record.expiresAt).toBe(`${year}-03-31T23:59:59.999Z`);

    out = '';
    expect(await runUserKeyCreate('bob', { name: 'timed', expires: `${year}-03-31T08:00:00+02:00`, json: true })).toBe(0);
    expect(JSON.parse(out).record.expiresAt).toBe(`${year}-03-31T06:00:00.000Z`);
  });

  it('refuses an --expires that does not parse or is in the past', async () => {
    const lastYear = new Date().getUTCFullYear() - 1;
    for (const expires of ['soon', '99999', '2030-02-31', '2030-01-01T00:00', `${lastYear}-01-01`]) {
      err = '';
      expect(await runUserKeyCreate('bob', { name: 'ci', expires, json: false }), expires).toBe(1);
      expect(err, expires).toMatch(/^--expires /);
      expect(err.trimEnd().split('\n'), expires).toHaveLength(1);
    }
    expect(out).toBe('');
    expect(await db.selectFrom('access_keys').selectAll().execute()).toEqual([]);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses an empty key name with a plain message', async () => {
    expect(await runUserKeyCreate('bob', { name: '   ', json: false })).toBe(1);
    expect(err).toBe('user key create refused: name is empty\n');
    expect(out).toBe('');
  });

  it('refuses to revoke without --force', async () => {
    const made = await makeKey('u1', 'ci');
    mocks.createAppContext.mockClear();
    mocks.recordAuditEvent.mockClear();

    expect(await runUserKeyRevoke('bob', made.record.id, { force: false })).toBe(1);

    expect(err).toContain('--force');
    expect(err).toContain(made.record.id);
    expect(out).toBe('');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const [row] = await db.selectFrom('access_keys').selectAll().execute();
    expect(row.revoked_at).toBeNull();
  });

  it('refuses a key value in place of a key ID without echoing it', async () => {
    const made = await makeKey('u1', 'ci');
    mocks.createAppContext.mockClear();

    for (const force of [false, true]) {
      err = '';
      expect(await runUserKeyRevoke('bob', made.key, { force })).toBe(1);
      expect(err).toContain('not a key ID');
      expect(err).not.toContain(made.key);
      expect(err).not.toContain(made.record.prefix);
    }
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('revokes a key and audits it', async () => {
    const made = await makeKey('u1', 'ci');
    mocks.recordAuditEvent.mockClear();

    expect(await runUserKeyRevoke('bob', made.record.id, { force: true })).toBe(0);

    expect(out).toBe(`revoked key ${made.record.id} for bob\n`);
    const [row] = await db.selectFrom('access_keys').selectAll().execute();
    expect(row.revoked_at).not.toBeNull();
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'access_key.revoke', entityId: made.record.id }),
    );
    expect(JSON.stringify(mocks.recordAuditEvent.mock.calls)).not.toContain(made.key);
    expect(keyCtx.close).toHaveBeenCalled();
  });

  it('gives one message for an unknown key, another user\'s key and a revoked key', async () => {
    const bobs = await makeKey('u1', 'ci');
    const anns = await makeKey('u2', 'ann-key');
    await runUserKeyRevoke('bob', bobs.record.id, { force: true });
    mocks.recordAuditEvent.mockClear();
    out = '';

    const messages: string[] = [];
    for (const keyId of ['no-such-id', anns.record.id, bobs.record.id]) {
      err = '';
      expect(await runUserKeyRevoke('bob', keyId, { force: true }), keyId).toBe(1);
      messages.push(err.replace(keyId, '<id>'));
    }
    expect(messages[0]).toBe('bob has no unrevoked key <id>\n');
    expect(new Set(messages).size).toBe(1);
    expect(out).toBe('');
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const annRow = await db.selectFrom('access_keys').selectAll().where('id', '=', anns.record.id).executeTakeFirstOrThrow();
    expect(annRow.revoked_at).toBeNull();
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
