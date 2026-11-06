import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up as up041 } from './041_custom_queries';
import { up, down } from './112_custom_query_groups';

describe('112_custom_query_groups', () => {
  it('adds unique-named groups and a nullable group_id on queries, and reverts', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up041(db as unknown as Kysely<unknown>);
      await db.insertInto('custom_queries').values({ id: 'q0', name: 'Old', connector_id: 'c', sql: 'select 1', params: '[]' as never } as never).execute();
      await up(db as unknown as Kysely<unknown>);

      // A query that existed before the migration has no group.
      expect(await db.selectFrom('custom_queries').select('group_id').where('id', '=', 'q0').executeTakeFirstOrThrow()).toEqual({ group_id: null });

      await db.insertInto('custom_query_groups').values({ id: 'g1', name: 'TB' }).execute();
      await expect(db.insertInto('custom_query_groups').values({ id: 'g2', name: 'TB' }).execute()).rejects.toThrow();
      await db.updateTable('custom_queries').set({ group_id: 'g1' }).where('id', '=', 'q0').execute();
      expect(await db.selectFrom('custom_queries').select('group_id').executeTakeFirstOrThrow()).toEqual({ group_id: 'g1' });

      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('custom_query_groups').selectAll().execute()).rejects.toThrow();
      await expect(db.selectFrom('custom_queries').select('group_id' as never).execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
