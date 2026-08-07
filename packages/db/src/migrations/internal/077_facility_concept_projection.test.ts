import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import { internalMigrations } from './index';
import { up } from './077_facility_concept_projection';

// `makeMigratedDb()` applies EVERY registered migration, including THIS ONE, before the test body
// runs (see test-helpers.ts). That's fine for the create/cascade tests below — the table already
// exists and we just use it — but the backfill test needs to observe up()'s own INSERT ... SELECT
// against pre-existing facility_registry/terminology_concepts rows, and a second up() call on an
// already-migrated db would throw "table already exists" (unlike task 2's DELETE-shaped migration,
// this one CREATEs). So: build a db with every migration EXCEPT 077 applied, mirroring
// test-helpers.ts's own loop, seed the pre-migration state, then run 077's up() exactly once.
async function makeDbBefore077(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '077_facility_concept_projection') continue;
    await migration.up(db);
  }
  return db;
}

describe('077 facility_concept_projection', () => {
  it('creates the link table keyed on registry_id', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry').values(
      { id: 'fac-1', name: 'Clinic', local_code: '111317-4', source: 'manual' } as never,
    ).execute();

    await db.insertInto('facility_concept_projection').values(
      { registry_id: 'fac-1', concept_code: '111317-4', updated_at: new Date() } as never,
    ).execute();

    const rows = await db.selectFrom('facility_concept_projection').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ registry_id: 'fac-1', concept_code: '111317-4' });
    await db.destroy();
  });

  it('backfills one row per existing registry facility from its live concept', async () => {
    const db = await makeDbBefore077();
    await db.insertInto('facility_registry').values(
      { id: 'fac-1', name: 'Clinic', local_code: '111317-4', source: 'manual' } as never,
    ).execute();
    await db.insertInto('terminology_concepts').values(
      { system: 'urn:openldr:cs:facility-registry', code: '111317-4', display: 'Clinic', status: 'ACTIVE' } as never,
    ).execute();

    await up(db as never);

    const rows = await db.selectFrom('facility_concept_projection').selectAll().execute();
    expect(rows).toEqual([expect.objectContaining({ registry_id: 'fac-1', concept_code: '111317-4' })]);
    await db.destroy();
  });

  // The subtle case the brief calls out: a row whose LIVE concept is still keyed on its own id (a
  // past collision fallback), even though local_code would recompute to something else. Backfill
  // must record what was actually projected, not the recomputed preferred code — recomputing here
  // would assert a code the concept does not carry, and the next real projection would then
  // "migrate" a mapping that was never broken.
  it('backfills the id it actually carries, not the recomputed preferred code, when the row is in its collision-fallback era', async () => {
    const db = await makeDbBefore077();
    await db.insertInto('facility_registry').values(
      { id: 'fac-1', name: 'Clinic', local_code: '111317-4', source: 'manual' } as never,
    ).execute();
    await db.insertInto('terminology_concepts').values(
      { system: 'urn:openldr:cs:facility-registry', code: 'fac-1', display: 'Clinic', status: 'ACTIVE' } as never,
    ).execute();

    await up(db as never);

    const rows = await db.selectFrom('facility_concept_projection').selectAll().execute();
    expect(rows).toEqual([expect.objectContaining({ registry_id: 'fac-1', concept_code: 'fac-1' })]);
    await db.destroy();
  });

  it('cascades the link away when its facility is deleted', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry').values({ id: 'fac-1', name: 'C', local_code: 'L', source: 'manual' } as never).execute();
    await db.insertInto('facility_concept_projection').values(
      { registry_id: 'fac-1', concept_code: 'L', updated_at: new Date() } as never,
    ).execute();

    await db.deleteFrom('facility_registry').where('id', '=', 'fac-1').execute();

    expect(await db.selectFrom('facility_concept_projection').selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});
