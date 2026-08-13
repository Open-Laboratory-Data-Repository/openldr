import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { backfill } from './086_facility_one_code';

// pg-mem hands jsonb back already parsed — same guard 072/073/085's tests carry.
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

/**
 * Insert a row in its PRE-086 shape, then run the backfill over it.
 *
 * `makeMigratedDb()` has already run 086 in full against an empty table, so `up()` cannot be called
 * again — `addColumn` would throw on the second run. `backfill` is exported precisely so the data
 * half can be exercised on rows that exist, which is the only interesting half.
 */
async function seedAndBackfill(db: any, id: string, values: Record<string, unknown>) {
  await db.insertInto('facility_registry').values({ id, name: 'A', source: 'manual', ...values } as never).execute();
  await backfill(db);
  return db.selectFrom('facility_registry').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

describe('086_facility_one_code', () => {
  it('backfills the national pair when there is one', async () => {
    const db = await makeMigratedDb();
    const r: any = await seedAndBackfill(db, 'f-nat', { national_system: 'urn:zm:mfl', national_code: '2445' });
    expect(r.facility_code).toBe('2445');
    expect(r.facility_system).toBe('urn:zm:mfl');
    await db.destroy();
  });

  it('gives a local-only row its CODE but leaves the system NULL', async () => {
    // ⛔ CE must not ship a facility register as a product default — the same rule
    // DEFAULT_OBSERVED_FACILITY_SYSTEM states about itself. The system arrives in a later stage, from
    // the operator's own Settings choice. Until then `local_code`'s UNIQUE constraint (migration 070,
    // still present) guards these rows exactly as it does today.
    const db = await makeMigratedDb();
    const r: any = await seedAndBackfill(db, 'f-loc', { local_code: '111317-4' });
    expect(r.facility_code).toBe('111317-4');
    expect(r.facility_system).toBeNull();
    await db.destroy();
  });

  it('⛔ keeps the NATIONAL pair when a row carries both, parking the local code in extras', async () => {
    // Measured 0 such rows on the dev install, but the importer preserves a hand-assigned local code
    // through re-import (facility-classify.ts:38-41), so a live deployment can have them. Losing one
    // silently would be worse than refusing to migrate.
    const db = await makeMigratedDb();
    const r: any = await seedAndBackfill(db, 'f-both', {
      local_code: 'LAB01', national_system: 'urn:zm:mfl', national_code: '2445',
    });
    expect(r.facility_code).toBe('2445');
    expect(r.facility_system).toBe('urn:zm:mfl');
    expect((parseJson(r.extras) as Record<string, unknown>).__localCode).toBe('LAB01');
    await db.destroy();
  });

  it('⛔ ships NO facility register of its own', async () => {
    // A seeded register would appear in every operator's import picklist and register list. Measured:
    // trying it broke nine tests across two files that assert a fresh install lists exactly the
    // registers its operator created.
    const db = await makeMigratedDb();
    const regs: any[] = await (db as any).selectFrom('coding_systems').selectAll()
      .where('kind', '=', 'facility-register').execute();
    expect(regs).toEqual([]);
    await db.destroy();
  });

  it('leaves the old columns in place — this migration only ADDS', async () => {
    const db = await makeMigratedDb();
    const r: any = await seedAndBackfill(db, 'f-keep', { national_system: 'urn:zm:mfl', national_code: '9' });
    expect(r.national_code).toBe('9');
    expect(r.local_code).toBeNull();
    await db.destroy();
  });

  it('is idempotent — a second backfill neither re-parks nor changes a code', async () => {
    const db = await makeMigratedDb();
    const first: any = await seedAndBackfill(db, 'f-idem', {
      local_code: 'LAB01', national_system: 'urn:zm:mfl', national_code: '2445',
    });
    await backfill(db);
    const second: any = await (db as any).selectFrom('facility_registry').selectAll()
      .where('id', '=', 'f-idem').executeTakeFirstOrThrow();
    expect(second.facility_code).toBe(first.facility_code);
    expect((parseJson(second.extras) as Record<string, unknown>).__localCode).toBe('LAB01');
    await db.destroy();
  });

  it('leaves a row that already has a facility_code alone', async () => {
    // The backfill must never overwrite a value a writer already set — stage 2 starts producing
    // these directly, and a re-run of this migration on a partly-migrated install must not clobber
    // them with a value derived from the deprecated columns.
    const db = await makeMigratedDb();
    const r: any = await seedAndBackfill(db, 'f-set', {
      facility_system: 'urn:zm:mfl', facility_code: 'ALREADY',
      national_system: 'urn:zm:mfl', national_code: '2445',
    });
    expect(r.facility_code).toBe('ALREADY');
    await db.destroy();
  });
});
