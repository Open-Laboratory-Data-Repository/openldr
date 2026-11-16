import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './119_import_check_held';

// Layer: the migration's DDL on pg-mem. Not covered: real Postgres.
// The column `check` is a reserved word. Kysely double-quotes every identifier, which is what this
// file exercises by inserting and selecting it.
describe('119_import_check_held', () => {
  it('keys a row by copy and key, quotes the check column, and drops cleanly', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      const one = {
        copy_id: 'c1', key: 'A', run_id: 'r1', reason: 'held', label: null, error: null,
        findings: JSON.stringify([{ n: 1 }]), check: JSON.stringify({ ok: false }),
      };
      await db.insertInto('import_check_held').values(one).execute();
      await expect(db.insertInto('import_check_held').values(one).execute()).rejects.toThrow();
      await db.insertInto('import_check_held').values({ ...one, key: 'B' }).execute();
      await db.insertInto('import_check_held').values({ ...one, copy_id: 'c2' }).execute();
      const got = await db.selectFrom('import_check_held').selectAll().where('copy_id', '=', 'c1').orderBy('key').execute();
      expect(got).toHaveLength(2);
      expect(got[0]!.check).toEqual({ ok: false });
      expect(got[0]!.findings).toEqual([{ n: 1 }]);
      expect(got[0]!.held_at).toBeInstanceOf(Date);
      // Not null: run_id, reason, findings, check.
      await expect(db.insertInto('import_check_held').values({ ...one, key: 'C', run_id: null as never }).execute()).rejects.toThrow();
      await expect(db.insertInto('import_check_held').values({ ...one, key: 'D', check: null as never }).execute()).rejects.toThrow();
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('import_check_held').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
