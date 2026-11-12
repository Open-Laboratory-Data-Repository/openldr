import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import { createPasswordHasher, type PasswordHasher, type ScryptFn } from './password';
import { loadOrCreateSigningKey, type SigningKey } from './tokens';
import {
  LOCK_MS, SESSION_IDLE_MS, SESSION_TOTAL_MS, SETUP_CODE_TTL_MS,
  createLocalSignIn, type LocalSignIn, type NewSession,
} from './sign-in';
import { FAKE_ROLES, makeFakes, type FakeClock, type FakeRoles, type FakeStore, type FakeUsers } from './test-support';

const GOOD = 'correct horse battery';
const NEW = 'another long passphrase';

// Fast stand-in for scrypt: a 64-byte digest of salt and password.
const fakeScrypt: ScryptFn = async (password, salt) => createHash('sha512').update(salt).update(password).digest();

/**
 * The same digest, slowed down: 30 ms for GOOD and 5 ms for anything else. The hasher runs four
 * at a time, so in a burst the wrong guesses finish and set the lock while GOOD still hashes.
 * `peak` is the most hashes that ran at once; `calls` counts hashes per password.
 */
function burstScrypt() {
  const track = { inFlight: 0, peak: 0, calls: new Map<string, number>() };
  const scrypt: ScryptFn = async (password, salt, keylen, opts) => {
    track.inFlight++;
    track.peak = Math.max(track.peak, track.inFlight);
    track.calls.set(password, (track.calls.get(password) ?? 0) + 1);
    await new Promise((r) => setTimeout(r, password === GOOD ? 30 : 5));
    track.inFlight--;
    return fakeScrypt(password, salt, keylen, opts);
  };
  return { scrypt, track };
}

let store: FakeStore;
let users: FakeUsers;
let roles: FakeRoles;
let clock: FakeClock;
let hasher: PasswordHasher;
let key: SigningKey;
let svc: LocalSignIn;
let adaId: string;

beforeEach(async () => {
  ({ store, users, roles, clock } = makeFakes());
  hasher = createPasswordHasher({ scrypt: fakeScrypt });
  key = await loadOrCreateSigningKey(store, randomBytes(32));
  svc = createLocalSignIn({ store, users, roles, hasher, key, now: clock.now });
});

async function addAda(mustChange = false): Promise<string> {
  const { id } = await store.createUser({ username: 'ada', email: 'ada@example.org', displayName: 'Ada L' });
  await store.setPassword(id, await hasher.hash(GOOD), mustChange);
  await roles.setUserRoles(id, [FAKE_ROLES[1]!.id]);
  adaId = id;
  return id;
}

async function login(password = GOOD): Promise<NewSession> {
  const r = await svc.login({ identifier: 'ada', password, ip: '10.0.0.1', userAgent: 'test' });
  if (!r.ok) throw new Error(`login failed: ${r.reason}`);
  return r;
}

describe('login', () => {
  beforeEach(async () => {
    await addAda();
  });

  it('signs in with the right password and returns a cookie and a token', async () => {
    const r = await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expiresIn).toBe(600);
    expect(r.cookieValue.split('.')).toHaveLength(2);
    expect(r.userId).toBe(adaId);
    expect(r.mustChangePassword).toBe(false);
    expect(r.cookieExpiresAt.getTime()).toBe(clock.now().getTime() + SESSION_TOTAL_MS);
    const [sessionId, secret] = r.cookieValue.split('.') as [string, string];
    const session = await store.getSession(sessionId);
    expect(session?.userId).toBe(adaId);
    expect(session?.secretHash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(session?.secretHash).not.toContain(secret);
  });

  it('gives the same failure for an unknown user and a wrong password', async () => {
    expect(await svc.login({ identifier: 'nobody', password: 'x'.repeat(12), ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid' });
    expect(await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid', userId: adaId });
  });

  it('gives no user ID for an unknown identifier', async () => {
    const r = await svc.login({ identifier: 'nobody', password: GOOD, ip: null, userAgent: null });
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(r).not.toHaveProperty('userId');
    expect(r).not.toHaveProperty('lockStarted');
  });

  it('returns a fresh result for each unknown user', async () => {
    const first = await svc.login({ identifier: 'nobody', password: GOOD, ip: null, userAgent: null });
    (first as Record<string, unknown>).reason = 'locked';
    (first as Record<string, unknown>).userId = 'tampered';
    expect(await svc.login({ identifier: 'nobody', password: GOOD, ip: null, userAgent: null })).toStrictEqual({ ok: false, reason: 'invalid' });
  });

  it('does not let a right guess in a parallel burst get past the lock', async () => {
    const { scrypt: slowScrypt, track } = burstScrypt();
    const slowHasher = createPasswordHasher({ scrypt: slowScrypt });
    const burn = vi.spyOn(slowHasher, 'burn');
    const slowSvc = createLocalSignIn({ store, users, roles, hasher: slowHasher, key, now: clock.now });
    const attempt = (password: string) => slowSvc.login({ identifier: 'ada', password, ip: null, userAgent: null });

    const [right, ...wrong] = await Promise.all([attempt(GOOD), ...Array.from({ length: 5 }, () => attempt('wrong wrong!'))]);

    // Proof the six calls overlapped: none saw a lock at the first check, so none burned a
    // hash, and four hashes ran at once.
    expect(burn).not.toHaveBeenCalled();
    expect(track.peak).toBe(4);
    expect(right).toEqual({ ok: false, reason: 'locked', userId: adaId });
    expect(wrong.filter((r) => !r.ok && r.lockStarted)).toHaveLength(1);
    expect(wrong.every((r) => !r.ok && r.reason === 'invalid')).toBe(true);
    expect(await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'locked', userId: adaId });
  });

  it('answers locked to a wrong guess that finishes after the lock is set, and still counts it', async () => {
    for (let i = 0; i < 4; i++) await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    // The fifth failure lands while this call is between its first lock check and its hash.
    const realVerify = hasher.verify.bind(hasher);
    vi.spyOn(hasher, 'verify').mockImplementationOnce(async (password, stored) => {
      await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
      return realVerify(password, stored);
    });
    const record = vi.spyOn(store, 'recordFailure');
    const r = await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    expect(r).toEqual({ ok: false, reason: 'locked', userId: adaId });
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('burns a hash for an unknown user', async () => {
    const burn = vi.spyOn(hasher, 'burn');
    await svc.login({ identifier: 'nobody', password: 'x'.repeat(12), ip: null, userAgent: null });
    expect(burn).toHaveBeenCalledTimes(1);
  });

  it('burns a hash for a user with no password', async () => {
    const { id } = await store.createUser({ username: 'nopass' });
    const burn = vi.spyOn(hasher, 'burn');
    expect(await svc.login({ identifier: 'nopass', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid', userId: id });
    expect(burn).toHaveBeenCalledTimes(1);
  });

  it('signs in with the email in any case', async () => {
    const r = await svc.login({ identifier: 'ADA@example.org', password: GOOD, ip: null, userAgent: null });
    expect(r.ok).toBe(true);
  });

  it('locks after five wrong tries, even for the right password, then unlocks after five minutes', async () => {
    for (let i = 0; i < 5; i++) await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    const burn = vi.spyOn(hasher, 'burn');
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null }))).toEqual({ ok: false, reason: 'locked', userId: adaId });
    expect(burn).toHaveBeenCalledTimes(1);
    clock.advance(LOCK_MS + 1);
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('marks only the fifth wrong try as the start of a lock', async () => {
    for (let i = 1; i <= 4; i++) {
      expect(await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid', userId: adaId });
    }
    expect(await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null }))
      .toEqual({ ok: false, reason: 'invalid', userId: adaId, lockStarted: true });
  });

  it('does not mark a try made while already locked', async () => {
    for (let i = 0; i < 5; i++) await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    const r = await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    expect(r).toEqual({ ok: false, reason: 'locked', userId: adaId });
    expect(r).not.toHaveProperty('lockStarted');
  });

  it('does not mark a wrong try when recordFailure hands back a lock that has ended', async () => {
    // One failure with a limit of one leaves an ended lock on the row.
    await store.recordFailure(adaId, new Date(clock.now().getTime() - 2 * LOCK_MS), 1, LOCK_MS);
    const r = await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    expect(r).toEqual({ ok: false, reason: 'invalid', userId: adaId });
  });

  it('does not lock after four wrong tries, and a good sign-in clears the count', async () => {
    for (let i = 0; i < 4; i++) await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
    expect((await store.getCredential(adaId))?.failedCount).toBe(0);
    await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null });
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('treats a lock that has ended as no lock', async () => {
    // One failure with a limit of one sets a lock that ended a full lock period ago.
    await store.recordFailure(adaId, new Date(clock.now().getTime() - 2 * LOCK_MS), 1, LOCK_MS);
    expect((await store.getCredential(adaId))!.lockedUntil).not.toBeNull();
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('refuses a disabled user', async () => {
    users.disable('ada');
    expect(await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'disabled', userId: adaId });
  });

  it('refuses a blocked user', async () => {
    users.block('ada');
    expect(await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'disabled', userId: adaId });
  });

  it('answers invalid, not disabled, to a wrong password for a disabled user', async () => {
    users.disable('ada');
    expect(await svc.login({ identifier: 'ada', password: 'wrong wrong!', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'invalid', userId: adaId });
  });

  it('puts role slugs and the must-change mark in the token', async () => {
    const plain = await login();
    const p1 = decodeJwt(plain.accessToken);
    expect(p1).toMatchObject({ sub: adaId, preferred_username: 'ada', name: 'Ada L', email: 'ada@example.org' });
    expect(p1.realm_access).toEqual({ roles: ['lab_technician'] });
    expect(p1.sid).toBe(plain.cookieValue.split('.')[0]);
    expect(p1.pwd_change).toBeUndefined();

    await store.setPassword(adaId, await hasher.hash(GOOD), true);
    const marked = await login();
    expect(marked.mustChangePassword).toBe(true);
    expect(decodeJwt(marked.accessToken).pwd_change).toBe(true);
  });
});

describe('sessions', () => {
  beforeEach(async () => {
    await addAda();
  });

  it('refreshes a live session and refuses a dead one', async () => {
    const s = await login();
    expect(await svc.refresh(s.cookieValue)).toMatchObject({ expiresIn: 600 });
    clock.advance(SESSION_IDLE_MS + 1);
    expect(await svc.refresh(s.cookieValue)).toBeNull();
  });

  it('ends a session at seven days even when it is used every hour', async () => {
    const s = await login();
    const hours = SESSION_TOTAL_MS / 3_600_000;
    for (let h = 1; h < hours; h++) {
      clock.advance(3_600_000);
      expect(await svc.refresh(s.cookieValue)).not.toBeNull();
    }
    clock.advance(3_600_000);
    expect(await svc.refresh(s.cookieValue)).toBeNull();
  });

  it('refuses refresh with a wrong secret', async () => {
    const s = await login();
    const [id] = s.cookieValue.split('.');
    expect(await svc.refresh(`${id}.${randomBytes(32).toString('base64url')}`)).toBeNull();
  });

  it('refuses refresh for a user disabled after sign-in and deletes the session', async () => {
    const s = await login(); users.disable('ada');
    expect(await svc.refresh(s.cookieValue)).toBeNull();
    expect(await store.getSession(s.cookieValue.split('.')[0]!)).toBeNull();
  });

  it('refuses refresh for a user blocked after sign-in and deletes the session', async () => {
    const s = await login(); users.block('ada');
    expect(await svc.refresh(s.cookieValue)).toBeNull();
    expect(await store.getSession(s.cookieValue.split('.')[0]!)).toBeNull();
  });

  it('carries the current roles and must-change mark on refresh', async () => {
    const s = await login();
    await roles.setUserRoles(adaId, [FAKE_ROLES[0]!.id]);
    await store.setPassword(adaId, await hasher.hash(GOOD), true);
    const g = await svc.refresh(s.cookieValue);
    expect(g?.mustChangePassword).toBe(true);
    const p = decodeJwt(g!.accessToken);
    expect(p.realm_access).toEqual({ roles: ['lab_admin'] });
    expect(p.pwd_change).toBe(true);
  });

  it('touches a session only when its last use is more than a minute old', async () => {
    const s = await login();
    const id = s.cookieValue.split('.')[0]!;
    const touch = vi.spyOn(store, 'touchSession');
    clock.advance(30_000);
    await svc.refresh(s.cookieValue);
    expect(await svc.sessionIsLive(id, adaId)).toBe(true);
    expect(touch).not.toHaveBeenCalled();
    clock.advance(31_000);
    await svc.refresh(s.cookieValue);
    expect(touch).toHaveBeenCalledTimes(1);
    expect((await store.getSession(id))!.lastUsedAt.getTime()).toBe(clock.now().getTime());
  });

  it('keeps a session alive while it is checked, and ends it after the idle limit', async () => {
    const s = await login();
    const id = s.cookieValue.split('.')[0]!;
    clock.advance(SESSION_IDLE_MS - 1000);
    expect(await svc.sessionIsLive(id, adaId)).toBe(true);
    clock.advance(SESSION_IDLE_MS - 1000);
    expect(await svc.sessionIsLive(id, adaId)).toBe(true);
    clock.advance(SESSION_IDLE_MS);
    expect(await svc.sessionIsLive(id, adaId)).toBe(false);
    expect(await svc.sessionIsLive('no-such-session', adaId)).toBe(false);
  });

  it('refuses a live session ID paired with another user ID', async () => {
    const s = await login();
    const id = s.cookieValue.split('.')[0]!;
    const { id: otherId } = await store.createUser({ username: 'bo' });
    expect(await svc.sessionIsLive(id, otherId)).toBe(false);
    expect(await svc.sessionIsLive(id, adaId)).toBe(true);
  });

  it('logs out, and a logged-out cookie no longer refreshes', async () => {
    const s = await login();
    expect(await svc.logout(s.cookieValue)).toEqual({ userId: adaId });
    expect(await svc.refresh(s.cookieValue)).toBeNull();
    expect(await svc.logout(s.cookieValue)).toBeNull();
  });

  it('logs out nothing for a wrong secret', async () => {
    const s = await login();
    const [id] = s.cookieValue.split('.');
    expect(await svc.logout(`${id}.${randomBytes(32).toString('base64url')}`)).toBeNull();
    expect(await store.getSession(id!)).not.toBeNull();
  });

  it('never throws on a cookie value it cannot parse', async () => {
    const s = await login();
    const [id, secret] = s.cookieValue.split('.') as [string, string];
    const bad = ['', '.', 'nodot', `${id}.`, `.${secret}`, `${id}.${secret}.x`, `${id}..${secret}`, 'a.b', '\0.\0', `${id}.${secret}\0`, '🙂.🙂'];
    for (const v of bad) {
      expect(await svc.refresh(v)).toBeNull();
      expect(await svc.logout(v)).toBeNull();
    }
    for (const v of ['', '\0', '🙂', `${id}.x`]) expect(await svc.sessionIsLive(v, adaId)).toBe(false);
    expect(await store.getSession(id)).not.toBeNull();
  });
});

describe('changePassword', () => {
  beforeEach(async () => {
    await addAda(true);
  });

  it('changes a password, clears must-change, and ends other sessions', async () => {
    const a = await login();
    const b = await login();
    const aId = a.cookieValue.split('.')[0]!;
    const bId = b.cookieValue.split('.')[0]!;
    expect(await svc.changePassword({ userId: adaId, sessionId: aId, currentPassword: GOOD, newPassword: NEW })).toBe('ok');
    expect((await store.getCredential(adaId))!.mustChange).toBe(false);
    expect(await store.getSession(bId)).toBeNull();
    expect(await store.getSession(aId)).not.toBeNull();
    expect((await svc.refresh(a.cookieValue))?.mustChangePassword).toBe(false);
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(false);
    expect((await svc.login({ identifier: 'ada', password: NEW, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('refuses a wrong current password and a weak new one', async () => {
    const a = await login();
    const sessionId = a.cookieValue.split('.')[0]!;
    expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: 'wrong wrong!', newPassword: NEW })).toBe('wrong_current');
    expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: GOOD, newPassword: 'short' })).toBe('too_short');
    expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: GOOD, newPassword: 'x'.repeat(129) })).toBe('too_long');
    expect((await store.getCredential(adaId))!.mustChange).toBe(true);
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('locks after five wrong current passwords, and the lock holds for sign-in too', async () => {
    const sessionId = (await login()).cookieValue.split('.')[0]!;
    for (let i = 0; i < 5; i++) {
      expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: 'wrong wrong!', newPassword: NEW })).toBe('wrong_current');
    }
    const verify = vi.spyOn(hasher, 'verify');
    expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: GOOD, newPassword: NEW })).toBe('wrong_current');
    expect(verify).not.toHaveBeenCalled();
    expect(await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'locked', userId: adaId });
    clock.advance(LOCK_MS + 1);
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('does not let a right current password in a parallel burst get past the lock', async () => {
    const sessionId = (await login()).cookieValue.split('.')[0]!;
    const before = (await store.getCredential(adaId))!.passwordHash;
    const { scrypt: slowScrypt, track } = burstScrypt();
    const slowSvc = createLocalSignIn({
      store, users, roles, hasher: createPasswordHasher({ scrypt: slowScrypt }), key, now: clock.now,
    });
    const attempt = (currentPassword: string) =>
      slowSvc.changePassword({ userId: adaId, sessionId, currentPassword, newPassword: NEW });

    const [right, ...wrong] = await Promise.all([attempt(GOOD), ...Array.from({ length: 5 }, () => attempt('wrong wrong!'))]);

    // Proof the six calls overlapped: all six reached the hash, and four hashes ran at once.
    expect(track.calls.get(GOOD)).toBe(1);
    expect(track.calls.get('wrong wrong!')).toBe(5);
    expect(track.peak).toBe(4);
    expect(right).toBe('wrong_current');
    expect(wrong).toEqual(Array(5).fill('wrong_current'));
    // The new password was never hashed or stored.
    expect(track.calls.has(NEW)).toBe(false);
    expect((await store.getCredential(adaId))!.passwordHash).toBe(before);
    clock.advance(LOCK_MS + 1);
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('checks the current password before the rules', async () => {
    const a = await login();
    const sessionId = a.cookieValue.split('.')[0]!;
    expect(await svc.changePassword({ userId: adaId, sessionId, currentPassword: 'wrong wrong!', newPassword: 'short' })).toBe('wrong_current');
  });

  it('refuses a new password equal to the username', async () => {
    await store.createUser({ username: 'grace.hopper' });
    const id = (await store.findUserIdByIdentifier('grace.hopper'))!;
    await store.setPassword(id, await hasher.hash(GOOD), false);
    expect(await svc.changePassword({ userId: id, sessionId: 'x', currentPassword: GOOD, newPassword: 'Grace.Hopper' })).toBe('same_as_username');
  });
});

describe('setup', () => {
  it('sets up the first admin once', async () => {
    expect(await svc.setupRequired()).toBe(true);
    const code = await svc.createSetupCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const r = await svc.setup({ setupCode: code.toLowerCase(), username: 'ada', displayName: 'Ada L', password: GOOD, ip: null, userAgent: null });
    expect(r.ok).toBe(true);
    expect(roles.slugsFor(r.ok ? r.userId : '')).toEqual(['lab_admin']);
    expect(await svc.setupRequired()).toBe(false);
    expect(await svc.setup({ setupCode: code, username: 'eve', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'already_set_up' });
    if (!r.ok) return;
    expect(r.mustChangePassword).toBe(false);
    expect((await store.getCredential(r.userId))!.mustChange).toBe(false);
    expect((await users.get(r.userId))!.displayName).toBe('Ada L');
    expect(decodeJwt(r.accessToken).realm_access).toEqual({ roles: ['lab_admin'] });
    expect(await svc.refresh(r.cookieValue)).not.toBeNull();
    expect((await svc.login({ identifier: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('uses only the code alphabet and accepts the code without dashes', async () => {
    for (let i = 0; i < 50; i++) {
      expect(await svc.createSetupCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){2}$/);
    }
    const code = await svc.createSetupCode();
    const r = await svc.setup({ setupCode: code.replace(/-/g, ''), username: 'ada', password: GOOD, ip: null, userAgent: null });
    expect(r.ok).toBe(true);
  });

  it('replaces an older code with a new one', async () => {
    const old = await svc.createSetupCode();
    const code = await svc.createSetupCode();
    expect(await svc.setup({ setupCode: old, username: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'bad_code' });
    expect((await svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('lets only one of two setup requests at the same moment create an admin', async () => {
    const code = await svc.createSetupCode();
    const [a, b] = await Promise.all([
      svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null }),
      svc.setup({ setupCode: code, username: 'eve', password: GOOD, ip: null, userAgent: null }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(store.credentialCount()).toBe(1);
  });

  it('refuses a wrong or expired setup code', async () => {
    const code = await svc.createSetupCode();
    expect(await svc.setup({ setupCode: 'AAAA-BBBB-CCCC', username: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'bad_code' });
    clock.advance(SETUP_CODE_TTL_MS);
    expect(await svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'bad_code' });
    expect(store.credentialCount()).toBe(0);
    expect(await store.findUserIdByIdentifier('ada')).toBeNull();
  });

  it('leaves setup required when a write before the password fails', async () => {
    const code = await svc.createSetupCode();
    vi.spyOn(roles, 'setUserRoles').mockRejectedValueOnce(new Error('database down'));
    await expect(svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null })).rejects.toThrow('database down');
    expect(await svc.setupRequired()).toBe(true);
    expect(store.credentialCount()).toBe(0);
    // The leftover user row has no password, so a new code and another name can finish setup.
    const again = await svc.setup({ setupCode: await svc.createSetupCode(), username: 'eve', password: GOOD, ip: null, userAgent: null });
    expect(again.ok).toBe(true);
  });

  it('refuses a taken username without spending the code', async () => {
    await store.createUser({ username: 'ada' });
    const code = await svc.createSetupCode();
    expect(await svc.setup({ setupCode: code, username: 'ada', password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'username_taken' });
    expect((await svc.setup({ setupCode: code, username: 'eve', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });

  it('checks the username and password before it spends the code', async () => {
    const code = await svc.createSetupCode();
    for (const username of ['ab', 'has space', 'x'.repeat(65), 'ad@min']) {
      expect(await svc.setup({ setupCode: code, username, password: GOOD, ip: null, userAgent: null })).toEqual({ ok: false, reason: 'bad_username' });
    }
    expect(await svc.setup({ setupCode: code, username: 'ada', password: 'short', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'too_short' });
    expect(await svc.setup({ setupCode: code, username: 'adalovelace', password: 'AdaLovelace', ip: null, userAgent: null })).toEqual({ ok: false, reason: 'same_as_username' });
    expect((await svc.setup({ setupCode: code, username: 'a.d_a-1', password: GOOD, ip: null, userAgent: null })).ok).toBe(true);
  });
});
