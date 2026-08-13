import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
// ⛔ Migrated only as far as this migration's own era. Migration 088 drops `local_code`,
// `national_code` and `national_system`; this migration predates that and reads them. Running
// the FULL list first would test it against a schema that never existed when it shipped.
import { makeMigratedDbUpTo } from './test-helpers';
import { internalMigrations } from './index';
import { up } from './077_facility_concept_projection';

// `makeMigratedDbUpTo('077_facility_concept_projection')` applies EVERY registered migration, including THIS ONE, before the test body
// runs (see test-helpers.ts). That's fine for the create/cascade tests below — the table already
// exists and we just use it — but the backfill test needs to observe up()'s own INSERT ... SELECT
// against pre-existing facility_registry/terminology_concepts rows, and a second up() call on an
// already-migrated db would throw "table already exists" (unlike task 2's DELETE-shaped migration,
// this one CREATEs). So: build a db with every migration EXCEPT 077 applied, mirroring
// test-helpers.ts's own loop, seed the pre-migration state, then run 077's up() exactly once.
async function makeDbBefore077(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  // ⛔ STOPS before 077 rather than SKIPPING it. Skipping ran every LATER migration too — including
  // 088, which drops `local_code`/`national_code` — so the "before 077" schema was really "after
  // 088 minus 077", a state that never existed. The seeds below insert `local_code` and failed with
  // `column "local_code" does not exist`, which reads like a pg-mem quirk and is not one.
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '077_facility_concept_projection') break;
    await migration.up(db);
  }
  return db;
}

describe('077 facility_concept_projection', () => {
  it('creates the link table keyed on registry_id', async () => {
    const db = await makeMigratedDbUpTo('077_facility_concept_projection');
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

  // ⛔ THE state that must never be created: two facilities linked to ONE concept_code. Reachable on
  // exactly the installs this migration targets — fac-A owns 'X', fac-B is imported carrying
  // `national_code = 'X'`, a Scan parks both onto their ids and leaves the unowned 'X' concept
  // behind — so BOTH rows match the backfill join twice (their id AND 'X'). Nothing conflicts on
  // insert (different registry_ids), so an unordered pick can link both to 'X', and
  // `reprojectRegistryRows` then has two facilities' mappings hanging off one code with no way to
  // tell whose they are. Measured: the pre-fix SQL produced exactly that under pg-mem, so this test
  // fails without the `distinct on`/`order by`.
  it('never links two facilities to the same concept_code when both match a leftover shared concept', async () => {
    const db = await makeDbBefore077();
    await db.insertInto('facility_registry').values([
      { id: 'fac-A', name: 'Alpha', local_code: 'X', source: 'manual' },
      { id: 'fac-B', name: 'Beta', national_code: 'X', national_system: 'urn:nat', source: 'manual' },
    ] as never).execute();
    // Insertion ORDER mirrors the history and is load-bearing for the mutation check: 'X' was
    // written first, when fac-A owned the code alone; the two id-keyed concepts came later, when
    // fac-B's arrival parked both rows and the upsert-only write left 'X' behind unowned. pg-mem
    // scans this table in insertion order, so under the pre-fix SQL 'X' is the first match for BOTH
    // facilities — which is precisely how the duplicate link gets created.
    await db.insertInto('terminology_concepts').values([
      { system: 'urn:openldr:cs:facility-registry', code: 'X', display: 'Alpha', status: 'ACTIVE' },
      { system: 'urn:openldr:cs:facility-registry', code: 'fac-A', display: 'Alpha', status: 'ACTIVE' },
      { system: 'urn:openldr:cs:facility-registry', code: 'fac-B', display: 'Beta', status: 'ACTIVE' },
    ] as never).execute();

    await up(db as never);

    const rows = await db.selectFrom('facility_concept_projection').selectAll().orderBy('registry_id').execute();
    // Each row keeps its OWN id — the one candidate no other facility can ever claim.
    expect(rows.map((r) => ({ registry_id: r.registry_id, concept_code: r.concept_code }))).toEqual([
      { registry_id: 'fac-A', concept_code: 'fac-A' },
      { registry_id: 'fac-B', concept_code: 'fac-B' },
    ]);
    // Stated separately from the equality above: the equality happens to imply it, but THIS is the
    // invariant, and it must keep being asserted if the expected codes above ever change.
    expect(new Set(rows.map((r) => r.concept_code)).size).toBe(rows.length);
    await db.destroy();
  });

  it('cascades the link away when its facility is deleted', async () => {
    const db = await makeMigratedDbUpTo('077_facility_concept_projection');
    await db.insertInto('facility_registry').values({ id: 'fac-1', name: 'C', local_code: 'L', source: 'manual' } as never).execute();
    await db.insertInto('facility_concept_projection').values(
      { registry_id: 'fac-1', concept_code: 'L', updated_at: new Date() } as never,
    ).execute();

    await db.deleteFrom('facility_registry').where('id', '=', 'fac-1').execute();

    expect(await db.selectFrom('facility_concept_projection').selectAll().execute()).toEqual([]);
    await db.destroy();
  });
});
