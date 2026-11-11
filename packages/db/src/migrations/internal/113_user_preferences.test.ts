import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './113_user_preferences';

describe('113_user_preferences', () => {
  it('stores one row per user and drops cleanly', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('user_preferences').values({ user_id: 'u1', prefs: JSON.stringify({ theme: 'dark' }) as never }).execute();
      await expect(db.insertInto('user_preferences').values({ user_id: 'u1', prefs: '{}' as never }).execute()).rejects.toThrow();
      const row = await db.selectFrom('user_preferences').select(['user_id', 'prefs', 'updated_at']).executeTakeFirstOrThrow();
      expect(row.user_id).toBe('u1');
      expect(row.prefs).toEqual({ theme: 'dark' });
      expect(row.updated_at).toBeInstanceOf(Date);
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('user_preferences').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
