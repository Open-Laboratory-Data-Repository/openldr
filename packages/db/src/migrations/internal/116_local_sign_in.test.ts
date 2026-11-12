import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDbUpTo } from './test-helpers';
import { up, down } from './116_local_sign_in';

describe('116_local_sign_in', () => {
  it('adds the sign-in tables and user names, cascades user deletes, and down removes them', async () => {
    const db = await makeMigratedDbUpTo('115_lab_order_requester');
    try {
      await up(db);
      await db.insertInto('users').values({ id: 'u1', subject: 'u1', username: 'ada', roles: '[]', first_name: 'Ada', last_name: null }).execute();
      expect(await db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', 'u1').executeTakeFirstOrThrow())
        .toEqual({ first_name: 'Ada', last_name: null });

      await db.insertInto('local_credentials').values({ user_id: 'u1', password_hash: 'h' }).execute();
      const cred = await db.selectFrom('local_credentials').selectAll().executeTakeFirstOrThrow();
      expect(cred.must_change).toBe(false);
      expect(cred.failed_count).toBe(0);
      expect(cred.locked_until).toBeNull();
      expect(cred.password_changed_at).toBeInstanceOf(Date);
      // A credential needs a real user.
      await expect(db.insertInto('local_credentials').values({ user_id: 'nobody', password_hash: 'h' }).execute()).rejects.toThrow();

      await db.insertInto('auth_sessions').values({ id: 's1', user_id: 'u1', secret_hash: 'x', expires_at: new Date('2030-01-01T00:00:00Z') }).execute();
      const session = await db.selectFrom('auth_sessions').selectAll().executeTakeFirstOrThrow();
      expect(session.created_at).toBeInstanceOf(Date);
      expect(session.last_used_at).toBeInstanceOf(Date);

      await db.insertInto('auth_signing_keys').values({ kid: 'k1', sealed_private_jwk: 's', public_jwk: JSON.stringify({ kty: 'EC' }) }).execute();
      expect((await db.selectFrom('auth_signing_keys').select('public_jwk').executeTakeFirstOrThrow()).public_jwk).toEqual({ kty: 'EC' });

      // The setup code table holds one row, with id 1.
      await db.insertInto('auth_setup_code').values({ id: 1, code_hash: 'c', expires_at: new Date() }).execute();
      await expect(db.insertInto('auth_setup_code').values({ id: 2, code_hash: 'c', expires_at: new Date() }).execute()).rejects.toThrow();

      // Deleting the user removes its credential and sessions.
      await db.deleteFrom('users').where('id', '=', 'u1').execute();
      expect(await db.selectFrom('local_credentials').selectAll().execute()).toEqual([]);
      expect(await db.selectFrom('auth_sessions').selectAll().execute()).toEqual([]);

      await down(db);
      for (const table of ['local_credentials', 'auth_sessions', 'auth_signing_keys', 'auth_setup_code']) {
        await expect(sql`select 1 from ${sql.table(table)}`.execute(db)).rejects.toThrow();
      }
      await expect(sql`select first_name from users`.execute(db)).rejects.toThrow();
      await expect(sql`select last_name from users`.execute(db)).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
