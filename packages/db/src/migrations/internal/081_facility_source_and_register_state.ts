import { createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';

// Facility registry slice — canonical identity, schema half (B1+B4 task 1). Two independent additions:
//
// 1. `coding_systems.kind`/`jurisdiction`/`contact` make "this coding system IS a national facility
//    register" a REAL COLUMN on the row, never a URL-prefix convention. Sniffing
//    `urn:openldr:cs:facility-*` to decide what a row means would replace one string-derived identity
//    with another, which is the defect this slice exists to remove.
//
// 2. `facility_registry.register_state` separates REGISTER MEMBERSHIP from OPERATIONAL STATUS. The
//    existing `status` column (070) answers "is this facility open" — HL7's own `location-status`
//    vocabulary (active/suspended/inactive, seeded by 072). HL7 has no membership concept, so carrying
//    "the register dropped this row" there would mean inventing a non-conformant code — see
//    facility-import.ts's retirement comment, which is correct about why it writes `inactive` rather
//    than a `retired` code. But today that write is the ONLY signal for "the register stopped listing
//    this row" — `status` currently carries both facts at once, which is exactly the conflation this
//    slice exists to remove. Task 5 moves that fact onto `register_state`, so `status` goes back to
//    meaning operational status only. register_state is OpenLDR's own membership vocabulary, seeded
//    below as its own ValueSet over its own CodeSystem.
export const FACILITY_REGISTER_STATE_VS = 'urn:openldr:valueset:facility-register-state';

/** Marks a `coding_systems` row as a facility register.
 *
 *  ⛔ A REAL COLUMN (`coding_systems.kind`), never a URL-prefix convention. */
export const FACILITY_REGISTER_KIND = 'facility-register';

// A brand-new dedicated CodeSystem, same reasoning as 072_facility_level_status_valuesets.ts's
// LEVEL_SYSTEM: never reused from `urn:openldr:cs:local` (014's flat shared system dedups on code
// alone), and unlike STATUS_SYSTEM these codes are not a standard HL7 vocabulary, so there is no
// pre-existing external system to project onto.
const REGISTER_STATE_SYSTEM = 'urn:openldr:cs:facility-register-state';
const REGISTER_STATE_VS_ID = 'vs-facility-register-state';
const REGISTER_STATE_CS_ID = 'cs-openldr-facility-register-state';
const PUBLISHER = 'pub-system';

// The `facility_registry.register_state` column values, as named constants — not a vocabulary
// inlined into logic (the vocabulary itself is the seeded ValueSet below, over its own CodeSystem;
// that seeding is unchanged). This is the one spelling of each code value, so a later task writing
// `register_state: FACILITY_REGISTER_STATE_DROPPED` in another package never re-types the literal.
export const FACILITY_REGISTER_STATE_IN_REGISTER = 'in_register';
export const FACILITY_REGISTER_STATE_DROPPED = 'dropped';
export const FACILITY_REGISTER_STATE_NOT_REGISTERED = 'not_registered';

const REGISTER_STATE_CONCEPTS: [string, string][] = [
  [FACILITY_REGISTER_STATE_IN_REGISTER, 'In register'],
  [FACILITY_REGISTER_STATE_DROPPED, 'Dropped by register'],
  [FACILITY_REGISTER_STATE_NOT_REGISTERED, 'Not from a register'],
];

// Same batching rationale as 072's insertConcepts: one multi-row insert, not an awaited insert per
// concept — this migration also runs inside every test that calls makeMigratedDb().
async function insertConcepts(seedDb: Kysely<any>, system: string, concepts: [string, string][]): Promise<void> {
  await seedDb.insertInto('terminology_concepts').values(
    concepts.map(([code, display]) => ({ system, code, display, status: 'ACTIVE', properties: null })) as never,
  ).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
}

// Copied from 072_facility_level_status_valuesets.ts's seedHistoryAndChangeLog (not imported — a
// migration is a frozen snapshot; importing a private helper across migration files would couple two
// supposedly-frozen snapshots together). Same reasoning applies here: this ValueSet DOES carry an
// expansion (REGISTER_STATE_CONCEPTS), so — unlike 069's intensional sets — a canonical
// `fhir.fhir_resources` row with no accompanying `change_log` entry would be invisible to the
// incremental projection.
async function seedHistoryAndChangeLog(seedDb: Kysely<any>, id: string, resource: unknown): Promise<void> {
  const serialized = JSON.stringify(resource);
  const contentHashHex = createHash('sha256').update(serialized).digest('hex');

  await seedDb.insertInto('fhir.resource_history').values({
    resource_type: 'ValueSet', id, version: 1, op: 'upsert', resource: serialized,
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing()).execute();

  const already = await seedDb
    .selectFrom('fhir.change_log')
    .select('seq')
    .where('resource_type', '=', 'ValueSet')
    .where('resource_id', '=', id)
    .executeTakeFirst();
  if (already) return;

  // site_id: null is deliberate — terminology travels the ValueSet/CodeSystem sync channel, never the
  // FHIR change_log a lab pushes from. See 072's identical comment for the push-worker M1 guard this
  // trips (expected, not a bug).
  await seedDb.insertInto('fhir.change_log').values({
    resource_type: 'ValueSet', resource_id: id, version: 1, op: 'upsert', content_hash: contentHashHex, site_id: null,
  } as never).execute();
}

async function seedRegisterStateValueSet(seedDb: Kysely<any>): Promise<void> {
  await seedDb.insertInto('coding_systems').values({
    id: REGISTER_STATE_CS_ID, system_code: 'FACILITY-REGISTER-STATE', system_name: 'OpenLDR Facility Register State Codes',
    url: REGISTER_STATE_SYSTEM, system_version: null,
    description: "Registry-membership state of a facility_registry row — whether a national register currently lists it.",
    active: true, publisher_id: PUBLISHER, seeded: true,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  await insertConcepts(seedDb, REGISTER_STATE_SYSTEM, REGISTER_STATE_CONCEPTS);

  const compose = { include: [{ system: REGISTER_STATE_SYSTEM, concept: REGISTER_STATE_CONCEPTS.map(([code, display]) => ({ code, display })) }] };
  await seedDb.insertInto('value_sets').values({
    id: REGISTER_STATE_VS_ID, url: FACILITY_REGISTER_STATE_VS, version: null, name: 'facility-register-state', title: 'Facility Register State',
    status: 'active', experimental: false, description: null, compose: JSON.stringify(compose) as never,
    immutable: false, category: null, publisher_id: PUBLISHER, expanded_at: sql`now()`,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  await seedDb.insertInto('valueset_expansions').values(
    REGISTER_STATE_CONCEPTS.map(([code, display]) => (
      { value_set_id: REGISTER_STATE_VS_ID, system_url: REGISTER_STATE_SYSTEM, code, display, inactive: false }
    )) as never,
  ).onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing()).execute();

  const resource = valueSetToFhirResource(
    {
      id: REGISTER_STATE_VS_ID, url: FACILITY_REGISTER_STATE_VS, status: 'active', experimental: false, version: null,
      name: 'facility-register-state', title: 'Facility Register State', description: null, compose,
    },
    REGISTER_STATE_CONCEPTS.map(([code, display]) => ({ system: REGISTER_STATE_SYSTEM, code, display })),
  );
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: REGISTER_STATE_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();
  await seedHistoryAndChangeLog(seedDb, REGISTER_STATE_VS_ID, resource);

  await seedDb.insertInto('terminology_systems').values({
    url: FACILITY_REGISTER_STATE_VS, version: null, kind: 'ValueSet', resource_id: REGISTER_STATE_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

/** The backfill half of up(), exported so the test can invoke it directly against rows seeded AFTER
 *  the full migration set has already run (see this migration's test file for why: `makeMigratedDb()`
 *  runs every migration first, so any row a test inserts afterward already carries the column
 *  DEFAULT and never meets an inline `up()`-only backfill).
 *
 *  A row that came from a register IS in one until an import says otherwise. A row with no
 *  national_system never came from one, and `not_registered` is the column default — this only
 *  ever needs to move rows the OTHER way, to `in_register`. */
export async function backfillRegisterState<DB>(db: Kysely<DB>): Promise<void> {
  await sql`
    update facility_registry set register_state = ${FACILITY_REGISTER_STATE_IN_REGISTER}
    where national_system is not null and national_system <> ''
  `.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('coding_systems').addColumn('kind', 'text').execute();
  await db.schema.alterTable('coding_systems').addColumn('jurisdiction', 'text').execute();
  await db.schema.alterTable('coding_systems').addColumn('contact', 'text').execute();

  await db.schema.alterTable('facility_registry')
    .addColumn('register_state', 'text', (c) => c.notNull().defaultTo(FACILITY_REGISTER_STATE_NOT_REGISTERED))
    .execute();

  await backfillRegisterState(db);

  await seedRegisterStateValueSet(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;

  await seedDb.deleteFrom('terminology_systems').where('url', '=', FACILITY_REGISTER_STATE_VS).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', REGISTER_STATE_VS_ID).execute();
  await seedDb.deleteFrom('valueset_expansions').where('value_set_id', '=', REGISTER_STATE_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', FACILITY_REGISTER_STATE_VS).execute();
  // REGISTER_STATE_SYSTEM is a namespace THIS migration created outright — same reasoning as 072's
  // LEVEL_SYSTEM, unambiguous to delete by system.
  await seedDb.deleteFrom('terminology_concepts').where('system', '=', REGISTER_STATE_SYSTEM).execute();
  await seedDb.deleteFrom('coding_systems').where('id', '=', REGISTER_STATE_CS_ID).execute();

  await db.schema.alterTable('facility_registry').dropColumn('register_state').execute();
  await db.schema.alterTable('coding_systems').dropColumn('contact').execute();
  await db.schema.alterTable('coding_systems').dropColumn('jurisdiction').execute();
  await db.schema.alterTable('coding_systems').dropColumn('kind').execute();
}
