import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { up, down } from './111_patient_duplicate_dismissals';

describe('111_patient_duplicate_dismissals', () => {
  it('stores one row per pair and rejects the same pair twice', async () => {
    const db = newDb().adapters.createKysely() as Kysely<InternalSchema>;
    try {
      await up(db as unknown as Kysely<unknown>);
      await db.insertInto('patient_duplicate_dismissals').values({ patient_a: 'p1', patient_b: 'p2', reason: 'twins', dismissed_by: 'dev-admin' }).execute();
      await expect(db.insertInto('patient_duplicate_dismissals').values({ patient_a: 'p1', patient_b: 'p2', reason: null, dismissed_by: 'x' }).execute()).rejects.toThrow();
      const rows = await db.selectFrom('patient_duplicate_dismissals').select(['patient_a', 'patient_b', 'reason', 'dismissed_by']).execute();
      expect(rows).toEqual([{ patient_a: 'p1', patient_b: 'p2', reason: 'twins', dismissed_by: 'dev-admin' }]);
      const at = await db.selectFrom('patient_duplicate_dismissals').select('dismissed_at').executeTakeFirstOrThrow();
      expect(at.dismissed_at).toBeInstanceOf(Date);
      await down(db as unknown as Kysely<unknown>);
      await expect(db.selectFrom('patient_duplicate_dismissals').selectAll().execute()).rejects.toThrow();
    } finally { await db.destroy(); }
  });
});
