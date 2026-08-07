import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import type { Kysely } from 'kysely';
import { internalMigrations } from './index';
import { up } from './078_one_active_facility_resolution';

const REGISTRY = 'urn:openldr:cs:facility-registry';
const LOCAL_MAP = 'urn:openldr:terminology:local-map';

// `makeMigratedDb()` applies EVERY registered migration, including THIS one, before the test body
// runs (see test-helpers.ts). This migration CREATEs a table and an index, so a second up() on an
// already-migrated db throws. Same shape as 077's test: build a db with every migration EXCEPT 078,
// seed the pre-migration state, then run 078's up() exactly once.
async function makeDbBefore078(mem = newDb()): Promise<Kysely<any>> {
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const [name, migration] of Object.entries(internalMigrations)) {
    if (name === '078_one_active_facility_resolution') continue;
    await migration.up(db);
  }
  return db;
}

// The post-migration db — every migration applied, 078 included — for the tests that exercise the
// index rather than the backfill.
async function makeDbAfter078(): Promise<Kysely<any>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<any>;
  for (const migration of Object.values(internalMigrations)) await migration.up(db);
  return db;
}

function mapping(over: Record<string, unknown>) {
  return {
    id: 'tm-x', from_system: 'S', from_code: 'BALAB', to_system: REGISTRY, to_code: 'L-1',
    map_type: 'SAME-AS', is_active: true, ...over,
  };
}

function element(over: Record<string, unknown>) {
  return {
    map_url: LOCAL_MAP, source_system: 'S', source_code: 'BALAB',
    target_system: REGISTRY, target_code: 'L-1', equivalence: 'SAME-AS', ...over,
  };
}

describe('078 one active facility resolution', () => {
  it('records a conflicting set and deactivates every member', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-2' }),
    ] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute()).toEqual([]);
    const conflicts = await db.selectFrom('facility_mapping_conflicts').selectAll().execute();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ from_system: 'S', from_code: 'BALAB', kind: 'duplicate' });
    expect(conflicts[0].mapping_ids).toEqual(['tm-1', 'tm-2']);
    expect(conflicts[0].resolved_at).toBeNull();
    await db.destroy();
  });

  // ⛔ The carry-forward from Task 10, restated at the storage layer: ambiguity is about DISTINCT
  // TARGETS, not row count. Two mappings naming the SAME facility do not compete — the resolver
  // already resolves them correctly — so recording them as a conflict and deactivating both copies
  // would blank a perfectly good facility out of official reports. They are still two active
  // SAME-AS rows on one observed key, though, so the unique index below would reject them: they
  // must be DEDUPED (one survivor kept active) rather than either ignored or condemned.
  it('dedupes an identical pair to one active row without calling it a conflict', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-1' }),
    ] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute())
      .toEqual([{ id: 'tm-1' }]);
    expect(await db.selectFrom('facility_mapping_conflicts').selectAll().execute()).toEqual([]);
    await db.destroy();
  });

  it('deletes the concept_map_elements mirror rows for the mappings it deactivated', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-2' }),
    ] as never).execute();
    await db.insertInto('concept_map_elements').values([
      element({ target_code: 'L-1' }),
      element({ target_code: 'L-2' }),
    ] as never).execute();

    await up(db as never);

    // A deactivated mapping must not keep appearing in the exported FHIR ConceptMap.
    expect(await db.selectFrom('concept_map_elements').selectAll().execute()).toEqual([]);
    await db.destroy();
  });

  // The identical pair shares ONE mirror row (the mirror is keyed on the four coordinates, which are
  // identical by definition). Deleting it for the deactivated copy would strip the SURVIVING
  // mapping out of the exported ConceptMap.
  it('keeps the mirror row when it merely dedupes identical copies', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-1' }),
    ] as never).execute();
    await db.insertInto('concept_map_elements').values([element({ target_code: 'L-1' })] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('concept_map_elements').selectAll().execute()).toHaveLength(1);
    await db.destroy();
  });

  // Only CE's own mirror of `term_mappings` is CE's to rewrite. An element that arrived inside some
  // other ConceptMap happens to sit at the same coordinates; deleting it would silently edit an
  // imported resource.
  it('scopes the mirror deletion to CE’s own local map', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-2' }),
    ] as never).execute();
    await db.insertInto('concept_map_elements').values([
      element({ target_code: 'L-1' }),
      element({ target_code: 'L-1', map_url: 'http://example.org/fhir/ConceptMap/imported' }),
    ] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('concept_map_elements').select('map_url').execute())
      .toEqual([{ map_url: 'http://example.org/fhir/ConceptMap/imported' }]);
    await db.destroy();
  });

  // ⛔ `map_type` has no CHECK constraint and `reference-apply.ts` round-trips whatever central
  // sends, so detection must be `<> 'SAME-AS'` and never an enumeration of the five MapType values:
  // 'equivalent' is a FHIR equivalence value that is live in existing tests.
  it('records unsupported map types WITHOUT deactivating them', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-3', from_code: 'X', map_type: 'RELATED-TO' }),
      mapping({ id: 'tm-4', from_code: 'Y', map_type: 'equivalent' }),
    ] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).orderBy('id').execute())
      .toEqual([{ id: 'tm-3' }, { id: 'tm-4' }]);
    const conflicts = await db.selectFrom('facility_mapping_conflicts').selectAll().orderBy('from_code').execute();
    expect(conflicts.map((c) => c.kind)).toEqual(['unsupported_map_type', 'unsupported_map_type']);
    expect(conflicts.map((c) => c.detail.mapType)).toEqual(['RELATED-TO', 'equivalent']);
    expect(conflicts.map((c) => c.mapping_ids)).toEqual([['tm-3'], ['tm-4']]);
    await db.destroy();
  });

  it('leaves an inactive mapping out of detection entirely', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-2', is_active: false }),
      mapping({ id: 'tm-3', from_code: 'X', map_type: 'RELATED-TO', is_active: false }),
    ] as never).execute();

    await up(db as never);

    expect(await db.selectFrom('facility_mapping_conflicts').selectAll().execute()).toEqual([]);
    expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute())
      .toEqual([{ id: 'tm-1' }]);
    await db.destroy();
  });

  it('the index rejects a second active SAME-AS mapping for the same observed key', async () => {
    const db = await makeDbAfter078();
    await db.insertInto('term_mappings').values(mapping({ id: 'tm-1', from_code: 'K', to_code: 'L-1' }) as never).execute();

    await expect(
      db.insertInto('term_mappings').values(mapping({ id: 'tm-2', from_code: 'K', to_code: 'L-2' }) as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('leaves a non-facility duplicate alone — the index is scoped to the registry system', async () => {
    const db = await makeDbAfter078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', from_code: 'K', to_system: 'http://loinc.org', to_code: 'A' }),
      mapping({ id: 'tm-2', from_code: 'K', to_system: 'http://loinc.org', to_code: 'B' }),
    ] as never).execute();

    expect(await db.selectFrom('term_mappings').select('id').where('is_active', '=', true).execute()).toHaveLength(2);
    await db.destroy();
  });

  // The index predicate is `is_active AND to_system = registry AND map_type = 'SAME-AS'`. Anything
  // outside it is unconstrained: a superseded row and a non-SAME-AS row are both allowed to sit
  // alongside the one active resolution.
  it('the index admits an inactive row and a non-SAME-AS row on the same observed key', async () => {
    const db = await makeDbAfter078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', from_code: 'K', to_code: 'L-1' }),
      mapping({ id: 'tm-2', from_code: 'K', to_code: 'L-2', is_active: false }),
      mapping({ id: 'tm-3', from_code: 'K', to_code: 'L-3', map_type: 'RELATED-TO' }),
    ] as never).execute();

    expect(await db.selectFrom('term_mappings').select('id').execute()).toHaveLength(3);
    await db.destroy();
  });

  // ⛔ The one real-Postgres rule pg-mem cannot enforce for us. pg-mem substitutes bound parameters
  // before it parses, so it happily accepts `where to_system = $1` inside an index predicate;
  // PostgreSQL rejects parameters in a `CREATE INDEX` outright. Only the emitted SQL shows the
  // difference, so that is what this asserts.
  it('emits the index predicate as literals, not bound parameters', async () => {
    const mem = newDb();
    await makeDbBefore078(mem);
    // A SECOND Kysely over the SAME in-memory database, this one configured to report every
    // COMPILED query. `mem.on('query')` is no use here: pg-mem substitutes parameters before it
    // parses, so what that event carries has already lost the distinction being tested.
    const compiled: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const logged = mem.adapters.createKysely(undefined, {
      log: (e: { level: string; query: { sql: string; parameters: readonly unknown[] } }) => {
        if (e.level === 'query') compiled.push(e.query);
      },
    }) as Kysely<any>;

    await up(logged as never);

    const createIndex = compiled.find((q) => q.sql.includes('create unique index'));
    expect(createIndex?.parameters).toEqual([]);
    expect(createIndex?.sql).toContain(`'${REGISTRY}'`);
    expect(createIndex?.sql).toContain(`'SAME-AS'`);
    await logged.destroy();
  });

  it('creates the index over a database whose violations it has just cleared', async () => {
    const db = await makeDbBefore078();
    await db.insertInto('term_mappings').values([
      mapping({ id: 'tm-1', to_code: 'L-1' }),
      mapping({ id: 'tm-2', to_code: 'L-2' }),
      mapping({ id: 'tm-3', from_code: 'DUP', to_code: 'L-9' }),
      mapping({ id: 'tm-4', from_code: 'DUP', to_code: 'L-9' }),
    ] as never).execute();

    await up(db as never);

    // The index now exists and is enforcing — proven by a fresh violation being refused.
    await expect(
      db.insertInto('term_mappings').values(mapping({ id: 'tm-5', from_code: 'DUP', to_code: 'L-8' }) as never).execute(),
    ).rejects.toThrow();
    await db.destroy();
  });
});
