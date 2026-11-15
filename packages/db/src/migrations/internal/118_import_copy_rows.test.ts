import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './118_import_copy_rows';

// Layer: the migration's DDL on pg-mem. Not covered: real Postgres.
describe('118_import_copy_rows', () => {
  it('keys a row by copy, set, key, detail and seq, and drops cleanly', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      const one = { copy_id: 'c1', set_name: 's', detail_name: 'd', key: 'A', seq: 0, row: JSON.stringify({ v: 1 }) };
      await db.insertInto('import_copy_rows').values(one).execute();
      // The same five names twice is refused.
      await expect(db.insertInto('import_copy_rows').values(one).execute()).rejects.toThrow();
      // Changing any one of them is a different row.
      await db.insertInto('import_copy_rows').values({ ...one, seq: 1 }).execute();
      await db.insertInto('import_copy_rows').values({ ...one, detail_name: 'e' }).execute();
      const got = await db.selectFrom('import_copy_rows').selectAll().orderBy('detail_name').orderBy('seq').execute();
      expect(got).toHaveLength(3);
      expect(got[0]!.row).toEqual({ v: 1 });
      expect(got[0]!.read_at).toBeInstanceOf(Date);
      // A null row is refused. The other columns' not null is not tried here.
      await expect(db.insertInto('import_copy_rows').values({ ...one, seq: 9, row: null as never }).execute()).rejects.toThrow();
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('import_copy_rows').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
