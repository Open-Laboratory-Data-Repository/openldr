import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDbUpTo } from './test-helpers';
import { up, down } from './117_access_keys';

describe('117_access_keys', () => {
  it('creates the table and drops it again', async () => {
    const db = await makeMigratedDbUpTo('116_local_sign_in');
    try {
      await up(db);
      await db.insertInto('users').values({ id: 'u1', subject: 'u1', username: 'ada', roles: '[]' }).execute();
      await db.insertInto('access_keys').values({ id: 'k1', user_id: 'u1', name: 'n', key_hash: 'h1', prefix: 'oldr_ab' }).execute();
      const row = await db.selectFrom('access_keys').selectAll().executeTakeFirstOrThrow();
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.created_by).toBeNull();
      expect(row.expires_at).toBeNull();
      expect(row.revoked_at).toBeNull();
      expect(row.last_used_at).toBeNull();
      // The key itself is never a column, only its hash and a short prefix.
      expect(Object.keys(row).sort()).toEqual(
        ['created_at', 'created_by', 'expires_at', 'id', 'key_hash', 'last_used_at', 'name', 'prefix', 'revoked_at', 'user_id'],
      );

      // A key needs a real user, and its hash is unique.
      await expect(db.insertInto('access_keys').values({ id: 'k2', user_id: 'nobody', name: 'n', key_hash: 'h2', prefix: 'p' }).execute()).rejects.toThrow();
      await expect(db.insertInto('access_keys').values({ id: 'k3', user_id: 'u1', name: 'n', key_hash: 'h1', prefix: 'p' }).execute()).rejects.toThrow();

      // Deleting the user removes its keys.
      await db.deleteFrom('users').where('id', '=', 'u1').execute();
      expect(await db.selectFrom('access_keys').selectAll().execute()).toEqual([]);

      await down(db);
      await expect(sql`select 1 from access_keys`.execute(db)).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
