import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createLocalAuthStore, createRoleStore } from '@openldr/db';
import { createUserStore } from '@openldr/users';
import { createLocalAuth, type LocalSignIn } from '@openldr/adapter-auth';
import type { Config } from '@openldr/config';
import type { DirectoryCreateInput } from '@openldr/ports';
import {
  createSetupCode, createLocalAccount, resetLocalPassword, endLocalSessions, generateTemporaryPassword,
  LocalSignInNotEnabledError, SetupAlreadyDoneError, UnknownUserError,
} from './local-accounts';
import { setAccountStatus } from './account-status';
import type { AppContext } from './index';

const actor = { actorType: 'cli' as const, actorId: null, actorName: 'cli' };
const adaId = 'user-ada';

function fake(opts: { setupRequired?: boolean } = {}): LocalSignIn {
  const unused = vi.fn(async () => { throw new Error('not used in this test'); });
  return {
    setupRequired: vi.fn(async () => opts.setupRequired ?? true),
    createSetupCode: vi.fn(async () => 'ABCD-EFGH-JKMN'),
    login: unused, refresh: unused, logout: unused, changePassword: unused, setup: unused, sessionIsLive: unused,
  };
}

function makeCtx(localSignIn: LocalSignIn | undefined) {
  const audit = { events: [] as Array<Record<string, unknown>>, record: vi.fn() };
  audit.record.mockImplementation(async (e: Record<string, unknown>) => { audit.events.push(e); return e; });
  const auth = {
    resetPassword: vi.fn(async () => {}),
    forceLogout: vi.fn(async () => {}),
    directory: {
      create: vi.fn(async (input: DirectoryCreateInput) => ({
        id: 'new-id', username: input.username, email: input.email ?? null, firstName: input.firstName ?? null,
        lastName: input.lastName ?? null, enabled: true, roles: input.roles ?? [], createdAt: null,
      })),
    },
  };
  const users = {
    getByUsername: vi.fn(async (username: string) => (username === 'ada'
      ? { id: adaId, subject: adaId, username: 'ada', displayName: null, email: null, roles: [], status: 'active', lastLoginAt: null, createdAt: null, rbacInitialized: true }
      : undefined)),
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const ctx = { localSignIn, auth, users, audit, logger } as unknown as AppContext;
  return { ctx, auth, users, audit };
}

describe('createSetupCode', () => {
  it('createSetupCode refuses when local sign-in is off', async () => {
    await expect(createSetupCode({ localSignIn: undefined })).rejects.toBeInstanceOf(LocalSignInNotEnabledError);
  });

  it('createSetupCode refuses once an admin exists', async () => {
    await expect(createSetupCode({ localSignIn: fake({ setupRequired: false }) })).rejects.toBeInstanceOf(SetupAlreadyDoneError);
  });

  it('returns the code from local sign-in while setup is still needed', async () => {
    const signIn = fake({ setupRequired: true });
    await expect(createSetupCode({ localSignIn: signIn })).resolves.toBe('ABCD-EFGH-JKMN');
    expect(signIn.createSetupCode).toHaveBeenCalledTimes(1);
  });
});

describe('generateTemporaryPassword', () => {
  it('makes a 16-character temporary password that passes the rules', () => {
    const p = generateTemporaryPassword();
    expect(p).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]{16}$/);
  });

  it('uses only the stated alphabet and does not repeat itself', () => {
    const alphabet = new Set('ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(16);
      for (const ch of p) expect(alphabet.has(ch)).toBe(true);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('resetLocalPassword', () => {
  it('resetLocalPassword sets a temporary password and audits without it', async () => {
    const { ctx, audit } = makeCtx(fake({ setupRequired: false }));
    const { temporaryPassword } = await resetLocalPassword(ctx, actor, 'ada');
    expect(ctx.auth.resetPassword).toHaveBeenCalledWith(adaId, temporaryPassword, true);
    expect(JSON.stringify(audit.events)).not.toContain(temporaryPassword);
    expect(audit.events[0]).toMatchObject({ action: 'user.reset_password', entityId: adaId });
    expect(audit.events[0]).toMatchObject({ actorName: 'cli', metadata: { username: 'ada' } });
  });

  it('resetLocalPassword refuses an unknown username', async () => {
    const { ctx, audit } = makeCtx(fake({ setupRequired: false }));
    await expect(resetLocalPassword(ctx, actor, 'nobody')).rejects.toBeInstanceOf(UnknownUserError);
    expect(ctx.auth.resetPassword).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });
});

describe('createLocalAccount', () => {
  it('createLocalAccount creates through the directory with a temporary password', async () => {
    const { ctx, auth, audit } = makeCtx(fake({ setupRequired: false }));
    const { user, temporaryPassword } = await createLocalAccount(ctx, actor, {
      username: 'bo', name: 'Bo Diddley', email: 'bo@lab.example', roles: ['lab_technician'],
    });
    expect(auth.directory.create).toHaveBeenCalledWith({
      username: 'bo', firstName: 'Bo Diddley', email: 'bo@lab.example', roles: ['lab_technician'],
      password: temporaryPassword, temporaryPassword: true,
    });
    const input = auth.directory.create.mock.calls[0]![0];
    expect(input.lastName).toBeUndefined();
    expect(user).toMatchObject({ id: 'new-id', username: 'bo' });
    expect(temporaryPassword).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]{16}$/);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ action: 'user.create', entityType: 'user', entityId: 'new-id', metadata: { username: 'bo' } });
    expect(JSON.stringify(audit.events)).not.toContain(temporaryPassword);
  });

  it('passes no name, email or roles when none are given', async () => {
    const { ctx, auth } = makeCtx(fake({ setupRequired: false }));
    await createLocalAccount(ctx, actor, { username: 'cy' });
    const input = auth.directory.create.mock.calls[0]![0];
    expect(input).toMatchObject({ username: 'cy', temporaryPassword: true });
    expect(input.firstName).toBeUndefined();
    expect(input.email).toBeUndefined();
    expect(input.roles).toBeUndefined();
  });
});

describe('endLocalSessions', () => {
  it('endLocalSessions calls forceLogout and audits', async () => {
    const { ctx, audit } = makeCtx(fake({ setupRequired: false }));
    await endLocalSessions(ctx, actor, 'ada');
    expect(ctx.auth.forceLogout).toHaveBeenCalledWith(adaId);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({ action: 'user.force_logout', entityType: 'user', entityId: adaId, metadata: { username: 'ada' } });
  });

  it('refuses an unknown username', async () => {
    const { ctx, audit } = makeCtx(fake({ setupRequired: false }));
    await expect(endLocalSessions(ctx, actor, 'nobody')).rejects.toBeInstanceOf(UnknownUserError);
    expect(ctx.auth.forceLogout).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });
});

describe('when local sign-in is off', () => {
  it('every account action refuses and calls nothing', async () => {
    const { ctx, auth, audit } = makeCtx(undefined);
    await expect(createLocalAccount(ctx, actor, { username: 'bo' })).rejects.toBeInstanceOf(LocalSignInNotEnabledError);
    await expect(resetLocalPassword(ctx, actor, 'ada')).rejects.toBeInstanceOf(LocalSignInNotEnabledError);
    await expect(endLocalSessions(ctx, actor, 'ada')).rejects.toBeInstanceOf(LocalSignInNotEnabledError);
    expect(auth.directory.create).not.toHaveBeenCalled();
    expect(auth.resetPassword).not.toHaveBeenCalled();
    expect(auth.forceLogout).not.toHaveBeenCalled();
    expect(audit.events).toHaveLength(0);
  });
});

// Under local sign-in resolveAuthCapabilities(cfg).identityAdmin is true, so the status route
// and setAccountStatus take the provider path and call ctx.auth.directory. This runs that path
// against the real local adapter over a migrated pg-mem database.
describe('account status under local sign-in (pg-mem)', () => {
  it('disables and re-enables a local user, and a disabled user cannot sign in', async () => {
    const db = await makeMigratedDb();
    try {
      const store = createLocalAuthStore(db);
      // pg-mem has no advisory locks. The live test in account-status.live.test.ts covers the lock.
      const users = createUserStore(db, { withSubjectLock: (_subject, work) => work(db) });
      const roles = createRoleStore(db);
      const { auth, signIn } = await createLocalAuth({ store, users, roles, secretKey: randomBytes(32), ping: async () => {} });
      const events: Array<Record<string, unknown>> = [];
      const ctx = {
        localSignIn: signIn, auth, users, roles,
        cfg: { AUTH_ADAPTER: 'local' } as Config,
        audit: { record: async (e: Record<string, unknown>) => { events.push(e); return e; } },
        logger: { error() {}, warn() {}, info() {} },
      } as unknown as AppContext;
      const login = (password: string) => signIn.login({ identifier: 'ada', password, ip: null, userAgent: null });

      // As on a real install: system roles exist and the first admin is set up before any account.
      await roles.seedSystemRoles();
      const setupCode = await createSetupCode(ctx);
      expect(await signIn.setup({ setupCode, username: 'root', password: 'first admin pw', ip: null, userAgent: null })).toMatchObject({ ok: true });

      const { user, temporaryPassword } = await createLocalAccount(ctx, actor, { username: 'ada', name: 'Ada' });
      expect(user.firstName).toBe('Ada');
      expect(user.lastName).toBeNull();
      expect(await login(temporaryPassword)).toMatchObject({ ok: true, mustChangePassword: true });

      await setAccountStatus(ctx, { providerSubject: user.id }, false, actor);
      expect((await users.get(user.id))?.status).toBe('disabled');
      expect(await login(temporaryPassword)).toMatchObject({ ok: false, reason: 'disabled' });

      await setAccountStatus(ctx, { providerSubject: user.id }, true, actor);
      expect((await users.get(user.id))?.status).toBe('active');
      expect(await users.isSubjectBlocked(user.id)).toBe(false);
      expect(await login(temporaryPassword)).toMatchObject({ ok: true });

      const statusEvents = events.filter((e) => e.action === 'user.status');
      expect(statusEvents).toHaveLength(2);
      expect(statusEvents[0]).toMatchObject({ metadata: { enabled: false, backend: 'provider', localId: user.id } });
      expect(JSON.stringify(events)).not.toContain(temporaryPassword);
    } finally {
      await db.destroy();
    }
  }, 30000);
});
