import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { LocalAuthStore } from '@openldr/ports';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createLocalAuthStore } from './local-auth-store';
import type { InternalSchema } from './schema/internal';

describe('LocalAuthStore', () => {
  let db: Kysely<InternalSchema>;
  let store: LocalAuthStore;

  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createLocalAuthStore(db);
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('creates a user whose subject equals its id and is RBAC initialised', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.subject).toBe(id);
    expect(row.rbac_initialized).toBe(true);
  });

  it('prefers the exact username over a case variant', async () => {
    const a = await store.createUser({ username: 'Bob' });
    const b = await store.createUser({ username: 'bob' });
    expect(await store.findUserIdByIdentifier('Bob')).toBe(a.id);
    expect(await store.findUserIdByIdentifier('bob')).toBe(b.id);
    expect(await store.findUserIdByIdentifier('BOB')).toBeNull();
  });

  it('matches a single user ignoring case', async () => {
    const a = await store.createUser({ username: 'Ada' });
    expect(await store.findUserIdByIdentifier('ada')).toBe(a.id);
  });

  it('matches a single user by email ignoring case', async () => {
    const a = await store.createUser({ username: 'u1', email: 'Ada@x.org' });
    expect(await store.findUserIdByIdentifier('ada@X.org')).toBe(a.id);
    expect(await store.findUserIdByIdentifier('nobody')).toBeNull();
  });

  it('refuses an email that two accounts share', async () => {
    await store.createUser({ username: 'u1', email: 'lab@x.org' });
    await store.createUser({ username: 'u2', email: 'LAB@x.org' });
    expect(await store.findUserIdByIdentifier('lab@x.org')).toBeNull();
    expect(await store.findUserIdByIdentifier('u1')).not.toBeNull();
  });

  it('stores a password and reads it back', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    expect(await store.getCredential(id)).toBeNull();
    expect(await store.anyCredentialExists()).toBe(false);
    await store.setPassword(id, 'h1', true);
    const cred = (await store.getCredential(id))!;
    expect(cred.userId).toBe(id);
    expect(cred.passwordHash).toBe('h1');
    expect(cred.mustChange).toBe(true);
    expect(cred.failedCount).toBe(0);
    expect(cred.lockedUntil).toBeNull();
    expect(cred.passwordChangedAt).toBeInstanceOf(Date);
    expect(await store.anyCredentialExists()).toBe(true);
    await store.setPassword(id, 'h2', false);
    const again = (await store.getCredential(id))!;
    expect(again.passwordHash).toBe('h2');
    expect(again.mustChange).toBe(false);
  });

  it('locks on the fifth failure and resets the count', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h', false);
    const now = new Date('2026-01-01T00:00:00Z');
    for (let i = 0; i < 4; i++) expect((await store.recordFailure(id, now, 5, 300_000)).lockedUntil).toBeNull();
    const fifth = await store.recordFailure(id, now, 5, 300_000);
    expect(fifth.lockedUntil?.toISOString()).toBe('2026-01-01T00:05:00.000Z');
    expect((await store.getCredential(id))!.failedCount).toBe(0);
  });

  it('recordFailure on a user with no credential returns no lock', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    expect((await store.recordFailure(id, new Date(), 5, 300_000)).lockedUntil).toBeNull();
  });

  it('clearFailures resets the count and the lock', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h', false);
    const now = new Date('2026-01-01T00:00:00Z');
    await store.recordFailure(id, now, 5, 300_000);
    await store.recordFailure(id, now, 5, 300_000);
    expect((await store.getCredential(id))!.failedCount).toBe(2);
    await store.clearFailures(id);
    const cred = (await store.getCredential(id))!;
    expect(cred.failedCount).toBe(0);
    expect(cred.lockedUntil).toBeNull();
  });

  it('setPassword clears a lock', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h', false);
    const now = new Date('2026-01-01T00:00:00Z');
    await store.recordFailure(id, now, 2, 300_000);
    const locked = await store.recordFailure(id, now, 2, 300_000);
    expect(locked.lockedUntil).not.toBeNull();
    await store.recordFailure(id, now, 2, 300_000);
    expect((await store.getCredential(id))!.failedCount).toBe(1);
    await store.setPassword(id, 'h2', false);
    const cred = (await store.getCredential(id))!;
    expect(cred.lockedUntil).toBeNull();
    expect(cred.failedCount).toBe(0);
  });

  it('replacePassword writes and returns true when the expected hash matches', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h1', true);
    const before = (await store.getCredential(id))!.passwordChangedAt;
    expect(await store.replacePassword(id, 'h1', 'h2', false)).toBe(true);
    const cred = (await store.getCredential(id))!;
    expect(cred.passwordHash).toBe('h2');
    expect(cred.mustChange).toBe(false);
    expect(cred.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('replacePassword returns false and changes nothing when the expected hash differs', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'admin-hash', true);
    const before = (await store.getCredential(id))!;
    expect(await store.replacePassword(id, 'old-hash', 'user-hash', false)).toBe(false);
    expect(await store.getCredential(id)).toEqual(before);
  });

  it('replacePassword returns false for a user with no credential row and inserts nothing', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    expect(await store.replacePassword(id, 'h1', 'h2', false)).toBe(false);
    expect(await store.getCredential(id)).toBeNull();
  });

  it('replacePassword clears a lock', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h1', false);
    const now = new Date('2026-01-01T00:00:00Z');
    await store.recordFailure(id, now, 2, 300_000);
    expect((await store.recordFailure(id, now, 2, 300_000)).lockedUntil).not.toBeNull();
    await store.recordFailure(id, now, 2, 300_000);
    expect(await store.replacePassword(id, 'h1', 'h2', false)).toBe(true);
    const cred = (await store.getCredential(id))!;
    expect(cred.lockedUntil).toBeNull();
    expect(cred.failedCount).toBe(0);
  });

  it('setNames then getNames round-trips', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h', false);
    await store.setNames(id, 'Ada', 'Lovelace');
    expect(await store.getNames(id)).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    await store.setNames(id, null, null);
    expect(await store.getNames(id)).toEqual({ firstName: null, lastName: null });
  });

  it('setNames works for a user with no credential row', async () => {
    const { id } = await store.createUser({ username: 'grace' });
    await store.setNames(id, 'Grace', 'Hopper');
    expect(await store.getCredential(id)).toBeNull();
    expect(await store.getNames(id)).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
  });

  it('getNames for an unknown id returns nulls', async () => {
    expect(await store.getNames('no-such-user')).toEqual({ firstName: null, lastName: null });
  });

  it('insertSigningKeyIfNone keeps the first key', async () => {
    expect(await store.getSigningKey()).toBeNull();
    const first = await store.insertSigningKeyIfNone({ kid: 'k1', sealedPrivateJwk: 's1', publicJwk: {} });
    const second = await store.insertSigningKeyIfNone({ kid: 'k2', sealedPrivateJwk: 's2', publicJwk: {} });
    expect(first.kid).toBe('k1'); expect(second.kid).toBe('k1');
  });

  it('round-trips the public JWK', async () => {
    const publicJwk = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };
    await store.insertSigningKeyIfNone({ kid: 'k1', sealedPrivateJwk: 's1', publicJwk });
    expect(await store.getSigningKey()).toEqual({ kid: 'k1', sealedPrivateJwk: 's1', publicJwk });
  });

  it('consumes a setup code once, and not after it expires', async () => {
    await store.replaceSetupCode('h', new Date('2026-01-01T00:30:00Z'));
    expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:31:00Z'))).toBe(false);
    await store.replaceSetupCode('h', new Date('2026-01-01T00:30:00Z'));
    expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:10:00Z'))).toBe(true);
    expect(await store.consumeSetupCode('h', new Date('2026-01-01T00:10:00Z'))).toBe(false);
  });

  it('a replaced setup code stops the old one working', async () => {
    const exp = new Date('2026-01-01T00:30:00Z');
    const now = new Date('2026-01-01T00:10:00Z');
    await store.replaceSetupCode('old', exp);
    await store.replaceSetupCode('new', exp);
    expect(await store.consumeSetupCode('old', now)).toBe(false);
    expect(await store.consumeSetupCode('new', now)).toBe(true);
  });

  it('creates, reads, touches and deletes a session', async () => {
    const { id: userId } = await store.createUser({ username: 'ada' });
    const expiresAt = new Date('2026-01-08T00:00:00Z');
    const s = await store.createSession({ userId, secretHash: 'sh', expiresAt, ip: '10.0.0.1', userAgent: 'test' });
    expect(s.userId).toBe(userId);
    expect(s.secretHash).toBe('sh');
    expect(s.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(await store.getSession(s.id)).toEqual(s);
    const touched = new Date('2026-01-02T00:00:00Z');
    await store.touchSession(s.id, touched);
    expect((await store.getSession(s.id))!.lastUsedAt.toISOString()).toBe(touched.toISOString());
    await store.deleteSession(s.id);
    expect(await store.getSession(s.id)).toBeNull();
  });

  it('deleteSessionsForUser can spare one session', async () => {
    const { id: userId } = await store.createUser({ username: 'ada' });
    const { id: otherId } = await store.createUser({ username: 'bob' });
    const expiresAt = new Date('2026-01-08T00:00:00Z');
    const mk = (u: string) => store.createSession({ userId: u, secretHash: 'sh', expiresAt, ip: null, userAgent: null });
    const s1 = await mk(userId);
    await mk(userId);
    await mk(userId);
    const other = await mk(otherId);
    expect(await store.deleteSessionsForUser(userId, s1.id)).toBe(2);
    const left = await db.selectFrom('auth_sessions').select('id').where('user_id', '=', userId).execute();
    expect(left.map((r) => r.id)).toEqual([s1.id]);
    expect(await store.getSession(other.id)).not.toBeNull();
    expect(await store.deleteSessionsForUser(userId)).toBe(1);
  });

  it('deleting a user removes its credential and sessions', async () => {
    const { id } = await store.createUser({ username: 'ada' });
    await store.setPassword(id, 'h', false);
    const s = await store.createSession({ userId: id, secretHash: 'sh', expiresAt: new Date('2026-01-08T00:00:00Z'), ip: null, userAgent: null });
    await db.deleteFrom('users').where('id', '=', id).execute();
    expect(await store.getCredential(id)).toBeNull();
    expect(await store.getSession(s.id)).toBeNull();
  });
});
