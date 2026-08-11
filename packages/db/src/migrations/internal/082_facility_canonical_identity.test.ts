import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import {
  FACILITY_REGISTER_URI_PREFIX,
  registerUriFor,
  rekey,
} from './082_facility_canonical_identity';

// ⛔ EVERY EXPECTED ID BELOW IS A LITERAL, MEASURED ONCE AND PINNED — never recomputed in the test
// from the same hash the implementation uses. Recomputing it would make the assertion agree with
// whatever the implementation does, including a broken hash, which is the class of
// assertion-that-cannot-fail this slice has already shipped twice. These were produced by
// `'fac-' + sha256('<uri>|<national code>').slice(0,16)` — the SAME shape as `idFor`
// (packages/terminology/src/facility-csv.ts), and `HFR|100` below reproduces the
// `fac-d112c779ad583160` already measured and quoted in that file's doc comment, which is the
// cross-check that this migration's inlined hash really is `idFor`'s.
const HFR_URI = 'urn:openldr:cs:facility-register:hfr';
const ID_HFR_URI_100 = 'fac-5602cc016fd46681'; // sha256('urn:openldr:cs:facility-register:hfr|100')
const ID_HFR_URI_200 = 'fac-7379f42f408a6935'; // sha256('urn:openldr:cs:facility-register:hfr|200')
const ID_TYPED_HFR_100 = 'fac-d112c779ad583160'; // sha256('HFR|100') — the legacy id, quoted in facility-csv.ts
const ID_TYPED_hfr_200 = 'fac-88cbb468f0435372'; // sha256('hfr|200')
const ID_TZ_HFR_100 = 'fac-0eea98ab9108599d'; // sha256('urn:tz:hfr|100')

const REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

async function seedLegacyFacility(
  db: Kysely<any>,
  row: { id: string; nationalSystem: string | null; nationalCode: string | null; name?: string; localCode?: string | null },
): Promise<void> {
  await db.insertInto('facility_registry').values({
    id: row.id,
    name: row.name ?? 'Alpha Hospital',
    local_code: row.localCode ?? null,
    national_system: row.nationalSystem,
    national_code: row.nationalCode,
    source: 'import',
  } as never).execute();
}

describe('082 facility canonical identity', () => {
  it('resolves an existing typed national_system to a source row and rewrites it to the URI', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });

    await rekey(db);

    // 1. A real, selectable register row now exists — `kind` is the column migration 081 added, so
    //    `createFacilityRegisterSourceStore` (which filters on it) can see this register.
    const source = await db.selectFrom('coding_systems').selectAll()
      .where('url', '=', HFR_URI).executeTakeFirstOrThrow();
    expect(source.kind).toBe('facility-register');
    expect(source.system_name).toBe('HFR'); // the operator's original typed value, preserved as the label
    expect(source.system_code).toBe('hfr');
    expect(source.active).toBe(true);

    // 2. The registry row now names the register by URI, not by the typed label.
    const facility = await db.selectFrom('facility_registry').selectAll()
      .where('national_code', '=', '100').executeTakeFirstOrThrow();
    expect(facility.national_system).toBe(HFR_URI);
    // 3. …and its permanent id is re-derived from that URI.
    expect(facility.id).toBe(ID_HFR_URI_100);
    expect(facility.id).not.toBe(ID_TYPED_HFR_100);
  });

  it('exposes the URI it derived, so a caller never re-implements the slug', async () => {
    expect(registerUriFor('HFR')).toBe(HFR_URI);
    expect(registerUriFor('hfr')).toBe(HFR_URI);
    expect(registerUriFor('  MoH Registry ')).toBe(`${FACILITY_REGISTER_URI_PREFIX}moh_registry`);
    // A punctuation-only value slugifies to nothing; it must NOT collapse onto the bare prefix
    // (which would make every such value one register). Mirrors `observedFieldSystem`'s
    // hash fallback (packages/bootstrap/src/facility-controlled-fields.ts).
    expect(registerUriFor('///')).not.toBe(FACILITY_REGISTER_URI_PREFIX);
    expect(registerUriFor('///')).not.toBe(registerUriFor('***'));
  });

  it('⛔ REFUSES when two typed values would collapse into one source', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    // 'HFR' and 'hfr' both slug to `…:hfr`. Silently merging them would fuse two registers'
    // facilities — the failure A2b spent a slice proving is how registers get corrupted.
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });
    await seedLegacyFacility(db, { id: ID_TYPED_hfr_200, nationalSystem: 'hfr', nationalCode: '200', name: 'Beta Clinic' });

    await expect(rekey(db)).rejects.toThrow(/HFR.*hfr|hfr.*HFR/);

    // ⛔ pg-mem does NOT roll back on a thrown error, so "nothing was written" is asserted against
    // the ROWS, never inferred from the throw.
    const rows = await db.selectFrom('facility_registry')
      .select(['id', 'national_system']).orderBy('id').execute();
    // ordered by id: 'fac-88cb…' precedes 'fac-d112…'
    expect(rows).toEqual([
      { id: ID_TYPED_hfr_200, national_system: 'hfr' },
      { id: ID_TYPED_HFR_100, national_system: 'HFR' },
    ]);
    const registers = await db.selectFrom('coding_systems').select('url')
      .where('kind', '=', 'facility-register').execute();
    expect(registers).toEqual([]);
    const jobs = await db.selectFrom('facility_jobs').select('id').execute();
    expect(jobs).toEqual([]);
  });

  it('⛔ REFUSES when a re-keyed id is already held by another facility', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    // The id `HFR|100` re-keys to is already occupied by an unrelated (manual) row. Letting the
    // update run would either raise a raw primary-key violation or — if the occupant happened to
    // move first — silently overwrite it, and which of those happened would depend on scan order.
    await seedLegacyFacility(db, { id: ID_HFR_URI_100, nationalSystem: null, nationalCode: null, localCode: 'L9', name: 'Squatter' });
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });

    await expect(rekey(db)).rejects.toThrow(new RegExp(`${ID_TYPED_HFR_100}.*${ID_HFR_URI_100}`));

    const rows = await db.selectFrom('facility_registry').select(['id', 'national_system']).orderBy('id').execute();
    expect(rows.map((r) => r.id).sort()).toEqual([ID_HFR_URI_100, ID_TYPED_HFR_100].sort());
    expect(rows.find((r) => r.id === ID_TYPED_HFR_100)?.national_system).toBe('HFR');
    // ⛔ pg-mem does not roll back, so "nothing was written" is asserted against the rows: every
    // refusal in this migration fires before the first write, including the register minting.
    expect(await db.selectFrom('coding_systems').select('url')
      .where('kind', '=', 'facility-register').execute()).toEqual([]);
  });

  it('re-keys the facility id and every INTERNAL reference that does not cascade', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    const parked = ID_TYPED_HFR_100;
    const humanCoded = ID_TYPED_hfr_200;
    // Two facilities in ONE register (same typed value), so nothing collapses. `parked` carries the
    // collision fallback (`facility_concept_projection.concept_code` IS its id — see
    // `registryConceptRows` in packages/db/src/facility-observed.ts for where that fallback is
    // produced, and facility-reconcile.ts's `widenToCollidingRows` note for how it is read back).
    // `humanCoded` projects under its national code, which must be left ALONE.
    await seedLegacyFacility(db, { id: parked, nationalSystem: 'HFR', nationalCode: '100' });
    await seedLegacyFacility(db, { id: humanCoded, nationalSystem: 'HFR', nationalCode: '200', name: 'Beta Clinic' });

    await db.insertInto('facility_concept_projection').values([
      { registry_id: parked, concept_code: parked },
      { registry_id: humanCoded, concept_code: '200' },
    ] as never).execute();
    await db.insertInto('terminology_concepts').values([
      { system: REGISTRY_SYSTEM, code: parked, display: 'Alpha Hospital', status: 'ACTIVE' },
      { system: REGISTRY_SYSTEM, code: '200', display: 'Beta Clinic', status: 'ACTIVE' },
    ] as never).execute();
    await db.insertInto('term_mappings').values([
      // registry route: target code IS the parked facility's id
      { id: 'tm-registry', from_system: 'urn:openldr:fac_lis', from_code: 'ALPHA',
        to_system: REGISTRY_SYSTEM, to_code: parked, map_type: 'SAME-AS' },
      // national route: `resolveObservedFacilities` matches `to_system` against a LIVE
      // `facility_registry.national_system` (its `knownNationalSystems` set), so the typed value
      // here stops resolving the moment the registry column is rewritten.
      { id: 'tm-national', from_system: 'urn:openldr:fac_lis', from_code: 'BETA',
        to_system: 'HFR', to_code: '200', map_type: 'SAME-AS' },
      // an unrelated mapping that names the same string in a DIFFERENT column pair — must not move
      { id: 'tm-other', from_system: 'urn:openldr:fac_lis', from_code: 'GAMMA',
        to_system: 'http://loinc.org', to_code: parked, map_type: 'SAME-AS' },
    ] as never).execute();
    await db.insertInto('facility_jobs').values({
      id: 'fj-projection', kind: 'registry-projection', status: 'failed', attempts: 1,
      registry_id: parked, active_key: null,
    } as never).execute();
    await db.insertInto('form_definitions').values({
      id: 'fd-1', name: 'Malaria', schema: JSON.stringify({}), facility_id: parked,
    } as never).execute();
    await db.insertInto('form_versions').values({
      id: 'fv-1', form_id: 'fd-1', version: 1, name: 'Malaria', schema: JSON.stringify({}),
      questionnaire: JSON.stringify({}), facility_id: parked,
    } as never).execute();
    await db.insertInto('dhis2_orgunit_map').values({
      facility_id: parked, orgunit_id: 'OU1', orgunit_name: 'Alpha',
    } as never).execute();
    await db.insertInto('plugin_data').values({
      plugin_id: 'dhis2-sink', collection: 'orgUnitMaps', key: parked,
      doc: JSON.stringify({ facilityId: parked, orgUnitId: 'OU1', orgUnitName: 'Alpha' }),
    } as never).execute();
    await db.insertInto('facility_import_runs').values([
      { id: 'run-1', national_system: 'HFR', source_format: 'csv', file_hash: 'abc',
        byte_size: 10, status: 'done', active_key: null },
      // a LIVE run: `active_key` carries the national system until the run reaches a terminal status
      { id: 'run-2', national_system: 'HFR', source_format: 'csv', file_hash: 'def',
        byte_size: 20, status: 'queued', active_key: 'HFR' },
    ] as never).execute();

    await rekey(db);

    // the row itself
    const ids = await db.selectFrom('facility_registry').select('id').orderBy('id').execute();
    expect(ids.map((r) => r.id).sort()).toEqual([ID_HFR_URI_100, ID_HFR_URI_200].sort());

    // facility_concept_projection.registry_id — ⛔ NOT an automatic FK cascade: migration 077
    // declares `onDelete('cascade')` only, so an id UPDATE is REFUSED by the constraint, not
    // followed. Measured under pg-mem: "update or delete on table facility_registry violates
    // foreign key constraint on table facility_concept_projection_registry_id_fk".
    const links = await db.selectFrom('facility_concept_projection')
      .select(['registry_id', 'concept_code']).orderBy('registry_id').execute();
    expect(links.find((l) => l.registry_id === ID_HFR_URI_100)?.concept_code).toBe(ID_HFR_URI_100);
    // …and a concept_code that is a HUMAN code is left exactly as it was.
    expect(links.find((l) => l.registry_id === ID_HFR_URI_200)?.concept_code).toBe('200');
    expect(links).toHaveLength(2);

    // the concept the parked link names has to move with it, or the link points at nothing
    const concepts = await db.selectFrom('terminology_concepts').select('code')
      .where('system', '=', REGISTRY_SYSTEM).execute();
    expect(concepts.map((c) => c.code).sort()).toEqual([ID_HFR_URI_100, '200'].sort());

    const mappings = await db.selectFrom('term_mappings')
      .select(['id', 'to_system', 'to_code']).orderBy('id').execute();
    expect(mappings.find((m) => m.id === 'tm-registry')).toEqual(
      { id: 'tm-registry', to_system: REGISTRY_SYSTEM, to_code: ID_HFR_URI_100 });
    expect(mappings.find((m) => m.id === 'tm-national')).toEqual(
      { id: 'tm-national', to_system: HFR_URI, to_code: '200' });
    expect(mappings.find((m) => m.id === 'tm-other')).toEqual(
      { id: 'tm-other', to_system: 'http://loinc.org', to_code: parked });

    expect((await db.selectFrom('facility_jobs').select('registry_id')
      .where('id', '=', 'fj-projection').executeTakeFirstOrThrow()).registry_id).toBe(ID_HFR_URI_100);

    expect((await db.selectFrom('form_definitions').select('facility_id')
      .where('id', '=', 'fd-1').executeTakeFirstOrThrow()).facility_id).toBe(ID_HFR_URI_100);
    expect((await db.selectFrom('form_versions').select('facility_id')
      .where('id', '=', 'fv-1').executeTakeFirstOrThrow()).facility_id).toBe(ID_HFR_URI_100);

    const orgUnits = await db.selectFrom('dhis2_orgunit_map').select(['facility_id', 'orgunit_id']).execute();
    expect(orgUnits).toEqual([{ facility_id: ID_HFR_URI_100, orgunit_id: 'OU1' }]);

    // ⚠ The LIVE DHIS2 org-unit map is the `plugin_data` copy migration 036 made, not the 008 table
    // — `apps/server/src/workflows-routes.ts` reads it through `pluginData.list('dhis2-sink',
    // 'orgUnitMaps')`. Both the row KEY and the id inside the jsonb doc carry the facility id.
    const pd = await db.selectFrom('plugin_data').selectAll()
      .where('collection', '=', 'orgUnitMaps').execute();
    expect(pd).toHaveLength(1);
    expect(pd[0].key).toBe(ID_HFR_URI_100);
    const doc = typeof pd[0].doc === 'string' ? JSON.parse(pd[0].doc) : pd[0].doc;
    expect(doc).toEqual({ facilityId: ID_HFR_URI_100, orgUnitId: 'OU1', orgUnitName: 'Alpha' });

    const runs = await db.selectFrom('facility_import_runs')
      .select(['id', 'national_system', 'active_key']).orderBy('id').execute();
    expect(runs).toEqual([
      { id: 'run-1', national_system: HFR_URI, active_key: null },
      // ⛔ `active_key` too, or the live run keeps guarding the old spelling and migration 080's
      // one-active-run-per-register index stops covering the register.
      { id: 'run-2', national_system: HFR_URI, active_key: HFR_URI },
    ]);
  });

  it('re-points the controlled-field namespaces the register name is slugged into', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });
    // `observedFieldSystem(field, nationalSystem)` (packages/bootstrap/src/facility-controlled-
    // fields.ts) slugifies its argument, so a register imported as 'HFR' authored its level/status/
    // country mappings under `…:facility-level:hfr`. Rewriting national_system to the URI changes
    // what that function derives, so the OLD namespace has to be carried across or every mapping an
    // operator authored silently reads as unmapped on the next import.
    await db.insertInto('coding_systems').values({
      id: 'cs-lvl-hfr', system_code: 'FAC-LEVEL-HFR', system_name: 'HFR levels',
      url: 'urn:openldr:cs:facility-level:hfr', kind: null,
    } as never).execute();
    await db.insertInto('terminology_concepts').values({
      system: 'urn:openldr:cs:facility-level:hfr', code: 'DISPENSARY', display: 'Dispensary', status: 'ACTIVE',
    } as never).execute();
    await db.insertInto('term_mappings').values({
      id: 'tm-level', from_system: 'urn:openldr:cs:facility-level:hfr', from_code: 'DISPENSARY',
      to_system: 'urn:openldr:cs:facility-level', to_code: 'dispensary', map_type: 'SAME-AS',
    } as never).execute();

    await rekey(db);

    const expected = 'urn:openldr:cs:facility-level:urn_openldr_cs_facility_register_hfr';
    expect((await db.selectFrom('term_mappings').select('from_system')
      .where('id', '=', 'tm-level').executeTakeFirstOrThrow()).from_system).toBe(expected);
    expect((await db.selectFrom('coding_systems').select('url')
      .where('id', '=', 'cs-lvl-hfr').executeTakeFirstOrThrow()).url).toBe(expected);
    const concepts = await db.selectFrom('terminology_concepts').select('system')
      .where('code', '=', 'DISPENSARY').execute();
    expect(concepts).toEqual([{ system: expected }]);
  });

  it('⛔ marks the facility-map dimension stale and never writes to the warehouse', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });

    await rekey(db);

    const jobs = await db.selectFrom('facility_jobs').selectAll().execute();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('facility-map-rebuild');
    expect(jobs[0].status).toBe('queued');
    // `active_key` is what makes a second request coalesce (migration 079) — a rebuild queued
    // WITHOUT it would be invisible to `enqueue`'s coalescing and could be duplicated at boot.
    expect(jobs[0].active_key).toBe('facility-map-rebuild');

    // Re-running must not raise a 23505 against `facility_jobs_one_active`.
    await rekey(db);
    expect(await db.selectFrom('facility_jobs').select('id').execute()).toHaveLength(1);

    // ⛔ The warehouse is not merely unwritten — it is UNREACHABLE from here. `facility_map` lives
    // in the external schema; the internal database this migration is handed has no such table.
    await expect(db.selectFrom('facility_map').selectAll().execute()).rejects.toThrow();

    // …and the module cannot open one either: its only imports are node's crypto and kysely. Adding
    // an external-db import (or a driver) to the migration breaks this line.
    const src = readFileSync(
      fileURLToPath(new URL('./082_facility_canonical_identity.ts', import.meta.url)), 'utf8');
    const imported = [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]).sort();
    expect(imported).toEqual(['kysely', 'node:crypto']);
  });

  it('leaves a manual row (NULL national_system) untouched', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    await seedLegacyFacility(db, { id: 'fac-manual-null', nationalSystem: null, nationalCode: null, localCode: 'L1', name: 'Manual A' });
    await seedLegacyFacility(db, { id: 'fac-manual-blank', nationalSystem: '', nationalCode: null, localCode: 'L2', name: 'Manual B' });
    // A legacy row alongside them, so the pass genuinely runs rather than returning early.
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });

    await rekey(db);

    const manual = await db.selectFrom('facility_registry').selectAll()
      .where('local_code', 'in', ['L1', 'L2']).orderBy('local_code').execute();
    expect(manual.map((r) => ({ id: r.id, national_system: r.national_system }))).toEqual([
      { id: 'fac-manual-null', national_system: null },
      { id: 'fac-manual-blank', national_system: '' },
    ]);
    // and no register was minted for the blank value
    const registers = await db.selectFrom('coding_systems').select('url')
      .where('kind', '=', 'facility-register').execute();
    expect(registers.map((r) => r.url)).toEqual([HFR_URI]);
  });

  it('leaves a row already keyed on a REGISTERED source URI alone, and re-running changes nothing', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    // Task 3 gated both HTTP import doors on a registered source's canonical URI, so a live install
    // can already hold rows keyed this way. Deriving a URI from a URI would re-key them a second
    // time — a permanent id moving for no reason.
    await db.insertInto('coding_systems').values({
      id: 'cs-freg-tz', system_code: 'TZ-HFR', system_name: 'Tanzania HFR', url: 'urn:tz:hfr',
      kind: 'facility-register', active: true,
    } as never).execute();
    await seedLegacyFacility(db, { id: ID_TZ_HFR_100, nationalSystem: 'urn:tz:hfr', nationalCode: '100' });

    await rekey(db);

    const row = await db.selectFrom('facility_registry').selectAll()
      .where('national_code', '=', '100').executeTakeFirstOrThrow();
    expect(row.id).toBe(ID_TZ_HFR_100);
    expect(row.national_system).toBe('urn:tz:hfr');
    // no second register minted for the same real register
    const registers = await db.selectFrom('coding_systems').select('url')
      .where('kind', '=', 'facility-register').execute();
    expect(registers.map((r) => r.url)).toEqual(['urn:tz:hfr']);
    // nothing changed, so no dimension rebuild was queued
    expect(await db.selectFrom('facility_jobs').select('id').execute()).toEqual([]);
  });

  it('is idempotent: a second pass over already-migrated rows re-keys nothing', async () => {
    const db = (await makeMigratedDb()) as Kysely<any>;
    await seedLegacyFacility(db, { id: ID_TYPED_HFR_100, nationalSystem: 'HFR', nationalCode: '100' });

    await rekey(db);
    const after1 = await db.selectFrom('facility_registry').selectAll().execute();
    await rekey(db);
    const after2 = await db.selectFrom('facility_registry').selectAll().execute();

    expect(after2.map((r) => ({ id: r.id, national_system: r.national_system })))
      .toEqual(after1.map((r) => ({ id: r.id, national_system: r.national_system })));
    expect(after2[0].id).toBe(ID_HFR_URI_100);
    const registers = await db.selectFrom('coding_systems').select('url')
      .where('kind', '=', 'facility-register').execute();
    expect(registers).toHaveLength(1);
  });
});
