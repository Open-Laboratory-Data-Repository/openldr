import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, createPublicKey, randomBytes, type JsonWebKeyInput } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { IdentityAdminNotConfiguredError, type AuthPort } from '@openldr/ports';
import { createPasswordHasher, type PasswordHasher, type ScryptFn } from './password';
import { LOCAL_ISSUER, loadOrCreateSigningKey, signAccessToken } from './tokens';
import type { LocalSignIn, NewSession } from './sign-in';
import { PasswordResetEmailUnsupportedError, PasswordRuleError, createLocalAuth } from './local-auth';
import { FAKE_ROLES, makeFakes, type FakeClock, type FakeRoles, type FakeStore, type FakeUsers } from './test-support';

const GOOD = 'correct horse battery';
const NEW = 'another long passphrase';

const fakeScrypt: ScryptFn = async (password, salt) => createHash('sha512').update(salt).update(password).digest();

let store: FakeStore;
let users: FakeUsers;
let roles: FakeRoles;
let clock: FakeClock;
let hasher: PasswordHasher;
let secretKey: Buffer;
let auth: AuthPort;
let signIn: LocalSignIn;
let adaId: string;

async function build(ping: () => Promise<void> = async () => {}) {
  return createLocalAuth({ store, users, roles, secretKey, ping, now: clock.now, hasher });
}

beforeEach(async () => {
  ({ store, users, roles, clock } = makeFakes());
  hasher = createPasswordHasher({ scrypt: fakeScrypt });
  secretKey = randomBytes(32);
  ({ auth, signIn } = await build());
  const { id } = await store.createUser({ username: 'ada', email: 'ada@example.org', displayName: 'Ada L' });
  await store.setPassword(id, await hasher.hash(GOOD), false);
  await roles.setUserRoles(id, [FAKE_ROLES[1]!.id]);
  adaId = id;
});

async function login(svc: LocalSignIn, identifier = 'ada', password = GOOD): Promise<NewSession> {
  const r = await svc.login({ identifier, password, ip: null, userAgent: null });
  if (!r.ok) throw new Error(`login failed: ${r.reason}`);
  return r;
}

describe('verifyToken', () => {
  it('verifies its own token while the session is live', async () => {
    const s = await login(signIn);
    const claims = await auth.verifyToken(s.accessToken);
    expect(claims.sub).toBe(s.userId);
    expect(claims).toMatchObject({ preferred_username: 'ada', realm_access: { roles: ['lab_technician'] } });
    expect(typeof claims.sid).toBe('string');
  });

  it('refuses a token after forceLogout', async () => {
    const s = await login(signIn);
    await auth.forceLogout(s.userId);
    await expect(auth.verifyToken(s.accessToken)).rejects.toThrow('session ended');
  });

  /** The session ID inside a session's access token. */
  function sidOf(session: NewSession): string {
    return decodeJwt(session.accessToken).sid as string;
  }

  /** Ada's claims with a live session ID, as a forger would copy them from a real token. */
  async function adaClaimsWithLiveSid(): Promise<Record<string, unknown>> {
    const s = await login(signIn);
    return { preferred_username: 'ada', sid: sidOf(s), realm_access: { roles: ['lab_admin'] } };
  }

  function iatNow(): number {
    return Math.floor(clock.now().getTime() / 1000);
  }

  it('refuses a token signed by another key under its own key ID', async () => {
    const otherKey = await loadOrCreateSigningKey(makeFakes().store, randomBytes(32));
    const forged = await signAccessToken(otherKey, {
      sub: adaId, username: 'ada', name: null, email: null, sid: sidOf(await login(signIn)),
      roles: ['lab_admin'], mustChangePassword: false,
    }, clock.now());
    await expect(auth.verifyToken(forged)).rejects.toMatchObject({ code: 'ERR_JWKS_NO_MATCHING_KEY' });
  });

  it('refuses a token signed by another key that borrows this key ID', async () => {
    const ownKey = await loadOrCreateSigningKey(store, secretKey);
    const otherKey = await loadOrCreateSigningKey(makeFakes().store, randomBytes(32));
    const forged = await new SignJWT(await adaClaimsWithLiveSid())
      .setProtectedHeader({ alg: 'ES256', kid: ownKey.kid })
      .setIssuer(LOCAL_ISSUER).setSubject(adaId).setIssuedAt(iatNow()).setExpirationTime(iatNow() + 600)
      .sign(otherKey.privateKey);
    await expect(auth.verifyToken(forged)).rejects.toMatchObject({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
  });

  it('refuses a token from another issuer', async () => {
    const ownKey = await loadOrCreateSigningKey(store, secretKey);
    const token = await new SignJWT(await adaClaimsWithLiveSid())
      .setProtectedHeader({ alg: 'ES256', kid: ownKey.kid })
      .setIssuer('https://issuer.example').setSubject(adaId).setIssuedAt(iatNow()).setExpirationTime(iatNow() + 600)
      .sign(ownKey.privateKey);
    await expect(auth.verifyToken(token)).rejects.toMatchObject({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' });
  });

  it('refuses an HS256 token keyed with the public key text', async () => {
    const stored = (await store.getSigningKey())!;
    const publicPem = createPublicKey({ key: stored.publicJwk as JsonWebKeyInput['key'], format: 'jwk' }).export({ type: 'spki', format: 'pem' });
    const token = await new SignJWT(await adaClaimsWithLiveSid())
      .setProtectedHeader({ alg: 'HS256', kid: stored.kid })
      .setIssuer(LOCAL_ISSUER).setSubject(adaId).setIssuedAt(iatNow()).setExpirationTime(iatNow() + 600)
      .sign(new TextEncoder().encode(publicPem as string));
    await expect(auth.verifyToken(token)).rejects.toMatchObject({ code: 'ERR_JOSE_ALG_NOT_ALLOWED' });
  });

  it("refuses a token carrying one user's subject and another user's live session", async () => {
    const ownKey = await loadOrCreateSigningKey(store, secretKey);
    await auth.directory.create({ username: 'bo', password: 'temporary pw 1', temporaryPassword: false });
    const bo = await login(signIn, 'bo', 'temporary pw 1');
    const token = await signAccessToken(ownKey, {
      sub: adaId, username: 'ada', name: null, email: null, sid: sidOf(bo),
      roles: ['lab_admin'], mustChangePassword: false,
    }, clock.now());
    await expect(auth.verifyToken(token)).rejects.toThrow('session ended');
    expect((await auth.verifyToken(bo.accessToken)).sub).toBe(bo.userId);
  });

  it('refuses a token with no session ID', async () => {
    const key = await loadOrCreateSigningKey(store, secretKey);
    const iat = Math.floor(clock.now().getTime() / 1000);
    const token = await new SignJWT({ preferred_username: 'ada' })
      .setProtectedHeader({ alg: 'ES256', kid: key.kid })
      .setIssuer(LOCAL_ISSUER).setSubject(adaId).setIssuedAt(iat).setExpirationTime(iat + 600)
      .sign(key.privateKey);
    await expect(auth.verifyToken(token)).rejects.toThrow('token missing sid claim');
  });

  it('refuses an expired token', async () => {
    const s = await login(signIn);
    clock.advance(601_000);
    await expect(auth.verifyToken(s.accessToken)).rejects.toThrow();
  });
});

describe('directory', () => {
  it('creates a user who must change a temporary password', async () => {
    const u = await auth.directory.create({ username: 'bo', firstName: 'Bo', lastName: 'Li', roles: ['lab_technician'], password: 'temporary pw 1' });
    expect(u).toMatchObject({ username: 'bo', firstName: 'Bo', lastName: 'Li', enabled: true, roles: ['lab_technician'], createdAt: null });
    expect((await users.get(u.id))?.displayName).toBe('Bo Li');
    const r = await signIn.login({ identifier: 'bo', password: 'temporary pw 1', ip: null, userAgent: null });
    expect(r.ok && r.mustChangePassword).toBe(true);
  });

  it('honours temporaryPassword false and ignores unknown role slugs', async () => {
    const u = await auth.directory.create({ username: 'bo', roles: ['lab_technician', 'no_such_role'], password: 'temporary pw 1', temporaryPassword: false });
    expect(u.roles).toEqual(['lab_technician']);
    const r = await signIn.login({ identifier: 'bo', password: 'temporary pw 1', ip: null, userAgent: null });
    expect(r.ok && r.mustChangePassword).toBe(false);
  });

  it('creates a user with no password who cannot sign in', async () => {
    const before = store.credentialCount();
    const u = await auth.directory.create({ username: 'bo' });
    expect(store.credentialCount()).toBe(before);
    const r = await signIn.login({ identifier: 'bo', password: 'anything at all', ip: null, userAgent: null });
    expect(r).toMatchObject({ ok: false, reason: 'invalid', userId: u.id });
  });

  it('creates a disabled user when enabled is false', async () => {
    const u = await auth.directory.create({ username: 'bo', enabled: false, password: 'temporary pw 1' });
    expect(u.enabled).toBe(false);
    const r = await signIn.login({ identifier: 'bo', password: 'temporary pw 1', ip: null, userAgent: null });
    expect(r).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('refuses a weak password on create and on reset', async () => {
    await expect(auth.directory.create({ username: 'bo', password: 'short' })).rejects.toThrow('password too_short');
    expect(await users.getByUsername('bo')).toBeUndefined();
    await expect(auth.resetPassword(adaId, 'short', true)).rejects.toThrow('password too_short');
  });

  it('throws a PasswordRuleError naming the failure, so a route can answer 400', async () => {
    const cases = [
      ['short', 'too_short'],
      ['x'.repeat(129), 'too_long'],
      ['Bo.Li.Example', 'same_as_username'],
    ] as const;
    for (const [password, failure] of cases) {
      const onCreate = await auth.directory.create({ username: 'bo.li.example', password }).catch((e: unknown) => e);
      expect(onCreate).toBeInstanceOf(PasswordRuleError);
      expect(onCreate).toMatchObject({ name: 'PasswordRuleError', failure });
    }
    const onReset = await auth.resetPassword(adaId, 'ada', true).catch((e: unknown) => e);
    expect(onReset).toBeInstanceOf(PasswordRuleError);
    expect(onReset).toMatchObject({ name: 'PasswordRuleError', failure: 'too_short' });
    expect(String(onReset)).not.toContain(GOOD);
  });

  it('refuses a username that already exists and writes nothing', async () => {
    const before = (await users.list({ offset: 0, limit: 100 })).length;
    await expect(auth.directory.create({ username: 'ada', password: 'temporary pw 1' })).rejects.toThrow('username already exists');
    expect((await users.list({ offset: 0, limit: 100 })).length).toBe(before);
    expect(await hasher.verify(GOOD, (await store.getCredential(adaId))!.passwordHash)).toBe(true);
  });

  it('gets a user and returns null for an unknown ID', async () => {
    await store.setNames(adaId, 'Ada', 'Lovelace');
    expect(await auth.directory.get(adaId)).toEqual({
      id: adaId, username: 'ada', email: 'ada@example.org', firstName: 'Ada', lastName: 'Lovelace',
      enabled: true, roles: ['lab_technician'], createdAt: null,
    });
    expect(await auth.directory.get('no-such-id')).toBeNull();
  });

  it('lists users with first, max, search and enabled', async () => {
    await auth.directory.create({ username: 'bo', email: 'bo@example.org' });
    await auth.directory.create({ username: 'cy', enabled: false });
    expect((await auth.directory.list()).map((u) => u.username)).toEqual(['ada', 'bo', 'cy']);
    expect((await auth.directory.list({ first: 1, max: 1 })).map((u) => u.username)).toEqual(['bo']);
    expect((await auth.directory.list({ search: 'BO@' })).map((u) => u.username)).toEqual(['bo']);
    expect((await auth.directory.list({ enabled: false })).map((u) => u.username)).toEqual(['cy']);
    expect((await auth.directory.list())[0]).toMatchObject({ id: adaId, roles: ['lab_technician'] });
  });

  it('replaces roles with setRoles', async () => {
    await auth.directory.setRoles(adaId, ['data_analyst']);
    expect((await auth.directory.get(adaId))?.roles).toEqual(['data_analyst']);
    await auth.directory.setRoles(adaId, []);
    expect((await auth.directory.get(adaId))?.roles).toEqual([]);
  });

  it('updates email and names and keeps fields that were not given', async () => {
    await auth.directory.update(adaId, { email: 'a@example.org', firstName: 'Ada', lastName: 'Lovelace' });
    expect(await auth.directory.get(adaId)).toMatchObject({ email: 'a@example.org', firstName: 'Ada', lastName: 'Lovelace' });
    expect((await users.get(adaId))?.displayName).toBe('Ada Lovelace');
    await auth.directory.update(adaId, { email: undefined, firstName: undefined, lastName: undefined, enabled: true });
    expect(await auth.directory.get(adaId)).toMatchObject({ email: 'a@example.org', firstName: 'Ada', lastName: 'Lovelace', enabled: true });
    await auth.directory.update(adaId, { lastName: null });
    expect(await auth.directory.get(adaId)).toMatchObject({ firstName: 'Ada', lastName: null });
    expect((await users.get(adaId))?.displayName).toBe('Ada');
  });

  it('leaves the display name alone when no name is given', async () => {
    await auth.directory.update(adaId, { email: 'a@example.org' });
    expect((await users.get(adaId))?.displayName).toBe('Ada L');
  });

  it('disables through update and blocks sign-in', async () => {
    await auth.directory.update(adaId, { enabled: false });
    expect((await auth.directory.get(adaId))?.enabled).toBe(false);
    const r = await signIn.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null });
    expect(r).toMatchObject({ ok: false, reason: 'disabled' });
    await auth.directory.update(adaId, { enabled: true });
    expect((await login(signIn)).userId).toBe(adaId);
  });

  it('ends every session on disable, so an old cookie stays dead after re-enable', async () => {
    const a = await login(signIn);
    const b = await login(signIn);
    await auth.directory.update(adaId, { enabled: false });
    await auth.directory.update(adaId, { enabled: true });
    expect(await signIn.refresh(a.cookieValue)).toBeNull();
    expect(await signIn.refresh(b.cookieValue)).toBeNull();
    await expect(auth.verifyToken(a.accessToken)).rejects.toThrow('session ended');
  });

  it('keeps sessions when an update does not disable', async () => {
    const a = await login(signIn);
    await auth.directory.update(adaId, { email: 'a@example.org' });
    await auth.directory.update(adaId, { enabled: true });
    expect(await signIn.refresh(a.cookieValue)).not.toBeNull();
  });

  it('throws user not found for an unknown ID and creates no rows', async () => {
    const before = (await users.list({ offset: 0, limit: 100 })).length;
    await expect(auth.directory.update('no-such-id', { email: 'x@example.org' })).rejects.toThrow('user not found');
    await expect(auth.directory.setRoles('no-such-id', ['lab_admin'])).rejects.toThrow('user not found');
    await expect(auth.resetPassword('no-such-id', NEW, false)).rejects.toThrow('user not found');
    await expect(auth.forceLogout('no-such-id')).rejects.toThrow('user not found');
    expect((await users.list({ offset: 0, limit: 100 })).length).toBe(before);
    expect(await store.getCredential('no-such-id')).toBeNull();
    expect(roles.slugsFor('no-such-id')).toEqual([]);
  });
});

describe('password and sessions', () => {
  it('resetPassword clears a lock and ends sessions', async () => {
    const s = await login(signIn);
    for (let i = 0; i < 5; i++) await signIn.login({ identifier: 'ada', password: 'wrong password', ip: null, userAgent: null });
    expect(await signIn.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).toMatchObject({ ok: false, reason: 'locked' });

    await auth.resetPassword(adaId, NEW, false);

    await expect(auth.verifyToken(s.accessToken)).rejects.toThrow('session ended');
    const r = await login(signIn, 'ada', NEW);
    expect(r.mustChangePassword).toBe(false);
  });

  /**
   * An adapter whose hasher stops on `gatedPassword` once `arm()` is called, until `release()`.
   * `started` resolves when that hash begins.
   */
  async function gatedAuth(gatedPassword = GOOD) {
    let armed = false;
    let hashStarted!: () => void;
    const started = new Promise<void>((r) => { hashStarted = r; });
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    const gatedScrypt: ScryptFn = async (password, salt, keylen, opts) => {
      if (armed && password === gatedPassword) {
        hashStarted();
        await released;
      }
      return fakeScrypt(password, salt, keylen, opts);
    };
    const built = await createLocalAuth({
      store, users, roles, secretKey, ping: async () => {}, now: clock.now,
      hasher: createPasswordHasher({ scrypt: gatedScrypt }),
    });
    return { ...built, started, release, arm: () => { armed = true; } };
  }

  it('fails a sign-in whose hash was running when an admin reset the password', async () => {
    const gated = await gatedAuth();
    gated.arm();
    const pending = gated.signIn.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null });
    await gated.started;
    await gated.auth.resetPassword(adaId, NEW, false);
    gated.release();

    expect(await pending).toMatchObject({ ok: false, reason: 'invalid', userId: adaId });
    expect(await store.deleteSessionsForUser(adaId)).toBe(0);
  });

  it('refuses a password change whose hash was running when an admin reset the password', async () => {
    const gated = await gatedAuth();
    const s = await login(gated.signIn);
    const sessionId = s.cookieValue.split('.')[0]!;
    gated.arm();
    const pending = gated.signIn.changePassword({ userId: adaId, sessionId, currentPassword: GOOD, newPassword: 'user chosen pw 1' });
    await gated.started;
    await gated.auth.resetPassword(adaId, NEW, true);
    gated.release();

    expect(await pending).toEqual({ outcome: 'wrong_current' });
    const credential = (await store.getCredential(adaId))!;
    expect(await hasher.verify(NEW, credential.passwordHash)).toBe(true);
    expect(await hasher.verify('user chosen pw 1', credential.passwordHash)).toBe(false);
    expect(credential.mustChange).toBe(true);
    expect(await store.deleteSessionsForUser(adaId)).toBe(0);
  });

  it('refuses a password change when an admin reset lands while the new password hashes', async () => {
    const chosen = 'user chosen pw 1';
    const gated = await gatedAuth(chosen);
    const s = await login(gated.signIn);
    const sessionId = s.cookieValue.split('.')[0]!;
    gated.arm();
    const pending = gated.signIn.changePassword({ userId: adaId, sessionId, currentPassword: GOOD, newPassword: chosen });
    await gated.started;
    await gated.auth.resetPassword(adaId, NEW, true);
    gated.release();

    expect(await pending).toEqual({ outcome: 'wrong_current' });
    const credential = (await store.getCredential(adaId))!;
    expect(await hasher.verify(NEW, credential.passwordHash)).toBe(true);
    expect(credential.mustChange).toBe(true);
    expect(await store.deleteSessionsForUser(adaId)).toBe(0);
  });

  it('fails a sign-in when an admin reset lands as its session is created', async () => {
    const createSession = store.createSession;
    store.createSession = async (input) => {
      store.createSession = createSession;
      await auth.resetPassword(adaId, NEW, false);
      return createSession(input);
    };

    const r = await signIn.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null });

    expect(r).toMatchObject({ ok: false, reason: 'invalid', userId: adaId });
    expect(await store.deleteSessionsForUser(adaId)).toBe(0);
  });

  it('resetPassword with temporary true forces a change', async () => {
    await auth.resetPassword(adaId, NEW, true);
    expect((await login(signIn, 'ada', NEW)).mustChangePassword).toBe(true);
  });

  it('gives an account created with no password a password', async () => {
    const u = await auth.directory.create({ username: 'bo' });
    await auth.resetPassword(u.id, NEW, true);
    expect((await login(signIn, 'bo', NEW)).mustChangePassword).toBe(true);
  });

  it('forceLogout ends every session of the user only', async () => {
    const a1 = await login(signIn);
    const a2 = await login(signIn);
    const bo = await auth.directory.create({ username: 'bo', password: 'temporary pw 1', temporaryPassword: false });
    const b = await login(signIn, 'bo', 'temporary pw 1');
    await auth.forceLogout(adaId);
    await expect(auth.verifyToken(a1.accessToken)).rejects.toThrow('session ended');
    await expect(auth.verifyToken(a2.accessToken)).rejects.toThrow('session ended');
    expect((await auth.verifyToken(b.accessToken)).sub).toBe(bo.id);
  });

  it('does not support the reset email', async () => {
    await expect(auth.sendPasswordResetEmail(adaId)).rejects.toBeInstanceOf(PasswordResetEmailUnsupportedError);
  });
});

describe('clients and health', () => {
  it('reports sync client admin as not configured', async () => {
    await expect(auth.clients.findUuidByClientId('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.createConfidentialClient('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.addSiteIdMapper('x', 's')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.addAudienceMapper('x', 'a')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.getClientSecret('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.regenerateClientSecret('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
    await expect(auth.clients.deleteClient('x')).rejects.toBeInstanceOf(IdentityAdminNotConfiguredError);
  });

  it('reports health from the ping', async () => {
    expect(await auth.healthCheck()).toMatchObject({ status: 'up', detail: 'local sign-in ready' });
    const down = await build(async () => { throw new Error('database unreachable'); });
    expect(await down.auth.healthCheck()).toMatchObject({ status: 'down', detail: 'database unreachable' });
  });

  it('reuses the stored signing key across instances', async () => {
    const s = await login(signIn);
    const again = await build();
    expect((await again.auth.verifyToken(s.accessToken)).sub).toBe(adaId);
  });
});
