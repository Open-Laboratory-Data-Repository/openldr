import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createAccessKeyStore, type AccessKeyStore } from './access-key-store';
import type { InternalSchema } from './schema/internal';

describe('AccessKeyStore', () => {
  let db: Kysely<InternalSchema>;
  let store: AccessKeyStore;
  const now = new Date('2026-06-01T12:00:00.000Z');

  const input = (over: Partial<Parameters<AccessKeyStore['create']>[0]> = {}) => ({
    userId: 'u1', name: 'nightly import', keyHash: 'hash-1', prefix: 'oldr_abcd',
    createdBy: 'admin-1', expiresAt: null, ...over,
  });

  beforeEach(async () => {
    db = await makeMigratedDb();
    store = createAccessKeyStore(db);
    for (const id of ['u1', 'u2']) {
      await db.insertInto('users').values({ id, subject: id, username: id, roles: JSON.stringify([]) as never }).execute();
    }
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('stores a key and lists it for its user, newest first', async () => {
    const k1 = await store.create(input({ keyHash: 'h1', name: 'first', expiresAt: '2027-01-01T00:00:00.000Z' }));
    expect(k1).toEqual({
      id: expect.any(String), userId: 'u1', name: 'first', prefix: 'oldr_abcd', createdBy: 'admin-1',
      createdAt: expect.any(String), expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, lastUsedAt: null,
    });
    expect(new Date(k1.createdAt).toISOString()).toBe(k1.createdAt);

    const k2 = await store.create(input({ keyHash: 'h2', name: 'second', createdBy: null }));
    const other = await store.create(input({ keyHash: 'h3', userId: 'u2' }));
    await db.updateTable('access_keys').set({ created_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', k1.id).execute();
    await db.updateTable('access_keys').set({ created_at: new Date('2026-01-02T00:00:00Z') }).where('id', '=', k2.id).execute();

    const listed = await store.listForUser('u1');
    expect(listed.map((k) => k.id)).toEqual([k2.id, k1.id]);
    expect(listed[1]).toEqual({ ...k1, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(listed[0]!.createdBy).toBeNull();
    expect((await store.listForUser('u2')).map((k) => k.id)).toEqual([other.id]);
    expect(await store.listForUser('nobody')).toEqual([]);
  });

  it('orders two keys made at the same moment by id', async () => {
    const a = await store.create(input({ keyHash: 'h1' }));
    const b = await store.create(input({ keyHash: 'h2' }));
    const same = new Date('2026-01-01T00:00:00Z');
    await db.updateTable('access_keys').set({ created_at: same }).execute();
    const ids = [a.id, b.id].sort();
    expect((await store.listForUser('u1')).map((k) => k.id)).toEqual(ids);
  });

  it('finds a usable key by hash, and not a revoked or expired one', async () => {
    const live = await store.create(input({ keyHash: 'live' }));
    const later = await store.create(input({ keyHash: 'later', expiresAt: new Date(now.getTime() + 1000).toISOString() }));
    await store.create(input({ keyHash: 'expired', expiresAt: new Date(now.getTime() - 1000).toISOString() }));
    await store.create(input({ keyHash: 'at-now', expiresAt: now.toISOString() }));
    const revoked = await store.create(input({ keyHash: 'revoked' }));
    expect(await store.revoke(revoked.id, 'u1', now)).toBe(true);

    expect(await store.findUsableByHash('live', now)).toEqual(live);
    expect(await store.findUsableByHash('later', now)).toEqual(later);
    expect(await store.findUsableByHash('expired', now)).toBeNull();
    expect(await store.findUsableByHash('at-now', now)).toBeNull();
    expect(await store.findUsableByHash('revoked', now)).toBeNull();
    expect(await store.findUsableByHash('unknown', now)).toBeNull();
    // The expiry is read against the `now` given, not the database clock.
    expect(await store.findUsableByHash('later', new Date(now.getTime() + 2000))).toBeNull();
  });

  it('refuses a second key with the same hash', async () => {
    await store.create(input({ keyHash: 'same' }));
    await expect(store.create(input({ keyHash: 'same', userId: 'u2' }))).rejects.toThrow();
    expect(await store.listForUser('u2')).toEqual([]);
  });

  it('revokes only a key that belongs to that user, once', async () => {
    const k = await store.create(input());
    expect(await store.revoke(k.id, 'other-user', now)).toBe(false);
    expect((await store.listForUser('u1'))[0]!.revokedAt).toBeNull();
    expect(await store.revoke(k.id, k.userId, now)).toBe(true);
    expect(await store.revoke(k.id, k.userId, now)).toBe(false);
    expect(await store.revoke('no-such-key', k.userId, now)).toBe(false);
    expect((await store.listForUser('u1'))[0]!.revokedAt).toBe(now.toISOString());
  });

  it('writes last used at most once in 60 seconds', async () => {
    const k = await store.create(input());
    const t0 = new Date('2026-06-01T12:00:00.000Z');
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const stored = async () => (await store.listForUser('u1'))[0]!.lastUsedAt;

    await store.touchLastUsed(k.id, t0);
    expect(await stored()).toBe(t0.toISOString());
    await store.touchLastUsed(k.id, at(30_000));
    expect(await stored()).toBe(t0.toISOString());
    await store.touchLastUsed(k.id, at(60_000));
    expect(await stored()).toBe(t0.toISOString());
    await store.touchLastUsed(k.id, at(61_000));
    expect(await stored()).toBe(at(61_000).toISOString());
    // An unknown id writes nothing and does not throw.
    await store.touchLastUsed('no-such-key', t0);
  });

  it('removes a user\'s keys when the user is deleted', async () => {
    await store.create(input({ keyHash: 'h1' }));
    await store.create(input({ keyHash: 'h2' }));
    const kept = await store.create(input({ keyHash: 'h3', userId: 'u2' }));
    await db.deleteFrom('users').where('id', '=', 'u1').execute();
    expect(await store.listForUser('u1')).toEqual([]);
    expect(await store.findUsableByHash('h1', now)).toBeNull();
    expect(await store.findUsableByHash('h3', now)).toEqual(kept);
  });

  it('refuses a key for an account that does not exist', async () => {
    await expect(store.create(input({ userId: 'nobody' }))).rejects.toThrow();
  });
});
