import { createHash } from 'node:crypto';
import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createAccessKeyStore, type InternalSchema } from '@openldr/db';
import type { AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import { createUserStore } from '@openldr/users';
import {
  ACCESS_KEY_PREFIX, generateAccessKey, hashAccessKey, looksLikeAccessKey,
  createAccessKey, listAccessKeys, revokeAccessKey, resolveAccessKey,
  UnknownAccessKeyError, AccessKeyInputError, type KeyContext,
} from './access-keys';
import type { AppContext } from './index';

const actor = { actorType: 'user' as const, actorId: 'admin-1', actorName: 'admin' };
const userId = 'u1';
const otherUserId = 'u2';

describe('access key values', () => {
  it('makes a key with the prefix and 43 body characters, different every time', () => {
    expect(ACCESS_KEY_PREFIX).toBe('oldr_');
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = generateAccessKey();
      expect(key).toMatch(/^oldr_[A-Za-z0-9_-]{43}$/);
      expect(looksLikeAccessKey(key)).toBe(true);
      seen.add(key);
    }
    expect(seen.size).toBe(100);
  });

  it('hashes the whole key with SHA-256 as hex', () => {
    const key = generateAccessKey();
    expect(hashAccessKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hashAccessKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessKey(key)).not.toBe(hashAccessKey(generateAccessKey()));
  });

  it('tells a key from a token by its prefix', () => {
    expect(looksLikeAccessKey('eyJhbGciOiJIUzI1NiJ9.e30.sig')).toBe(false);
    expect(looksLikeAccessKey('')).toBe(false);
    expect(looksLikeAccessKey('OLDR_abc')).toBe(false);
  });
});

describe('access key actions (pg-mem)', () => {
  let db: Kysely<InternalSchema>;
  let ctx: KeyContext;
  let events: Array<Record<string, unknown>>;
  let warn: ReturnType<typeof vi.fn>;

  const allRowsOf = (table: 'access_keys') => db.selectFrom(table).selectAll().execute();

  beforeEach(async () => {
    db = await makeMigratedDb();
    for (const id of [userId, otherUserId]) {
      await db.insertInto('users').values({ id, subject: id, username: id, roles: JSON.stringify([]) as never }).execute();
    }
    events = [];
    warn = vi.fn();
    ctx = {
      accessKeys: createAccessKeyStore(db),
      users: createUserStore(db, { withSubjectLock: (_subject, work) => work(db) }),
      audit: { record: async (e: Record<string, unknown>) => { events.push(e); return e; } } as unknown as AuditStore,
      logger: { error: vi.fn(), warn, info: vi.fn() } as unknown as Logger,
    };
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('takes an AppContext as it is', () => {
    expectTypeOf<AppContext>().toMatchTypeOf<KeyContext>();
  });

  it('stores only the hash and the first 12 characters', async () => {
    const { record, key } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
    const rowList = await allRowsOf('access_keys');
    const rows = JSON.stringify(rowList);
    expect(rows).not.toContain(key);
    expect(record.prefix).toBe(key.slice(0, 12));
    expect(rowList).toHaveLength(1);
    expect(rowList[0]).toMatchObject({ key_hash: hashAccessKey(key), prefix: key.slice(0, 12), user_id: userId, created_by: 'admin-1' });
    expect(record).toMatchObject({ userId, name: 'assistant', createdBy: 'admin-1', expiresAt: null, revokedAt: null });
    expect(await listAccessKeys(ctx, userId)).toEqual([record]);
    expect(await listAccessKeys(ctx, otherUserId)).toEqual([]);
  });

  it('trims the name and keeps a future expiry', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const { record } = await createAccessKey(ctx, actor, { userId, name: '  nightly  ', expiresAt });
    expect(record.name).toBe('nightly');
    expect(record.expiresAt).toBe(expiresAt);
    const { record: long } = await createAccessKey(ctx, actor, { userId, name: 'x'.repeat(80) });
    expect(long.name).toHaveLength(80);
  });

  it('resolves a fresh key, and not a revoked, expired or unknown one', async () => {
    const now = new Date();
    const fresh = await createAccessKey(ctx, actor, { userId, name: 'fresh' });
    const resolved = await resolveAccessKey(ctx, fresh.key, now);
    expect(resolved?.id).toBe(fresh.record.id);
    expect((await listAccessKeys(ctx, userId)).find((k) => k.id === fresh.record.id)?.lastUsedAt).toBe(now.toISOString());

    const revoked = await createAccessKey(ctx, actor, { userId, name: 'revoked' });
    await revokeAccessKey(ctx, actor, { userId, keyId: revoked.record.id });
    expect(await resolveAccessKey(ctx, revoked.key, now)).toBeNull();

    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const expiring = await createAccessKey(ctx, actor, { userId, name: 'expiring', expiresAt });
    expect(await resolveAccessKey(ctx, expiring.key, now)).not.toBeNull();
    expect(await resolveAccessKey(ctx, expiring.key, new Date(now.getTime() + 120_000))).toBeNull();

    expect(await resolveAccessKey(ctx, generateAccessKey(), now)).toBeNull();
    expect(await resolveAccessKey(ctx, fresh.key.slice(0, -1), now)).toBeNull();
  });

  it('returns null for a value without the prefix and touches no database', async () => {
    const find = vi.spyOn(ctx.accessKeys, 'findUsableByHash');
    const touch = vi.spyOn(ctx.accessKeys, 'touchLastUsed');
    expect(await resolveAccessKey(ctx, 'eyJhbGciOiJIUzI1NiJ9.e30.sig', new Date())).toBeNull();
    expect(await resolveAccessKey(ctx, '', new Date())).toBeNull();
    expect(find).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
  });

  it('still returns the record when the last-used write fails, and logs no key material', async () => {
    const { record, key } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
    vi.spyOn(ctx.accessKeys, 'touchLastUsed').mockRejectedValue(new Error('database went away'));
    expect((await resolveAccessKey(ctx, key, new Date()))?.id).toBe(record.id);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(key);
    expect(logged).not.toContain(hashAccessKey(key));
    expect(logged).not.toContain(record.prefix);
  });

  it('refuses an unknown user, an empty name and a past expiry', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const attempts: Array<Parameters<typeof createAccessKey>[2]> = [
      { userId: 'nobody', name: 'assistant' },
      { userId, name: '' },
      { userId, name: '   ' },
      { userId, name: 'x'.repeat(81) },
      { userId, name: 'assistant', expiresAt: past },
      { userId, name: 'assistant', expiresAt: 'next tuesday' },
    ];
    for (const input of attempts) {
      await expect(createAccessKey(ctx, actor, input)).rejects.toBeInstanceOf(AccessKeyInputError);
    }
    expect(await allRowsOf('access_keys')).toEqual([]);
    expect(events).toEqual([]);
  });

  it('audits create and revoke without the key or its hash', async () => {
    const { record, key } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
    await revokeAccessKey(ctx, actor, { userId, keyId: record.id });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      ...actor, action: 'access_key.create', entityType: 'access_key', entityId: record.id,
      metadata: { name: 'assistant', prefix: key.slice(0, 12), userId },
    });
    expect(events[1]).toMatchObject({
      ...actor, action: 'access_key.revoke', entityType: 'access_key', entityId: record.id,
      metadata: { name: 'assistant', prefix: key.slice(0, 12), userId },
    });
    const audited = JSON.stringify(events);
    expect(audited).not.toContain(key);
    expect(audited).not.toContain(hashAccessKey(key));
  });

  it('revoking a key of another user throws UnknownAccessKeyError and changes nothing', async () => {
    const { record, key } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
    events.length = 0;
    const wrongUser = revokeAccessKey(ctx, actor, { userId: otherUserId, keyId: record.id });
    await expect(wrongUser).rejects.toBeInstanceOf(UnknownAccessKeyError);
    expect(await resolveAccessKey(ctx, key, new Date())).not.toBeNull();
    expect((await listAccessKeys(ctx, userId))[0]?.revokedAt).toBeNull();
    expect(events).toEqual([]);
  });

  it('gives one error for no such key, another user\'s key and an already revoked key', async () => {
    const { record } = await createAccessKey(ctx, actor, { userId, name: 'assistant' });
    await revokeAccessKey(ctx, actor, { userId, keyId: record.id });
    events.length = 0;
    const messages: string[] = [];
    for (const input of [
      { userId, keyId: 'no-such-id' },
      { userId: otherUserId, keyId: record.id },
      { userId, keyId: record.id },
    ]) {
      const err = await revokeAccessKey(ctx, actor, input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnknownAccessKeyError);
      messages.push((err as Error).message);
    }
    expect(new Set(messages).size).toBe(1);
    expect(events).toEqual([]);
  });
});
