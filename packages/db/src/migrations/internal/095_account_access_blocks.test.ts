import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './095_account_access_blocks';

describe('account access blocks migration', () => {
  it('stores blocks without a user record and rejects duplicate subjects', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('account_access_blocks').values({ subject: 'never-signed-in' }).execute();
      await expect(db.insertInto('account_access_blocks').values({ subject: 'never-signed-in' }).execute()).rejects.toThrow();
      expect(await db.selectFrom('account_access_blocks').selectAll().execute()).toEqual([{ subject: 'never-signed-in' }]);
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('account_access_blocks').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
