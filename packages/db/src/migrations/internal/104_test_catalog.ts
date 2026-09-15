import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// The national test catalog and its categories (docs/superpowers/specs/2026-09-15-test-catalog-design.md,
// 4.2), seeded on every install so a lab has both before it ever pulls from central.
//
// These values are inlined, not imported, because a migration is a frozen record of what it wrote
// (see 075_facility_registry_coding_system.ts). They must stay equal to the constants in
// packages/bootstrap/src/test-catalog.ts:
//   CATALOG_SYSTEM     = TEST_CATALOG_SYSTEM
//   CATEGORY_SYSTEM    = TEST_CATEGORY_SYSTEM
//   CATEGORY_VALUE_SET = TEST_CATEGORY_VALUE_SET
export const CATALOG_SYSTEM = 'urn:openldr:codesystem:test-catalog';
export const CATEGORY_SYSTEM = 'urn:openldr:codesystem:test-category';
export const CATEGORY_VALUE_SET = 'urn:openldr:valueset:test-category';
const PUBLISHER_ID = 'pub-system';

// Ids follow `codingSystems.upsertByUrl`'s `cs-url-${systemCode}`, so a later upsert by url lands on
// these rows instead of creating competing ones. `seeded: true` stops the Terminology page deleting them.
const SYSTEMS = [
  { id: 'cs-url-TEST-CATALOG', system_code: 'TEST-CATALOG', system_name: 'Test catalog', url: CATALOG_SYSTEM },
  { id: 'cs-url-TEST-CATEGORY', system_code: 'TEST-CATEGORY', system_name: 'Test categories', url: CATEGORY_SYSTEM },
];

// The starting categories the spec names. Operators edit them on the Terminology page. Central's
// edits reach labs as concepts through the terminology pull.
const CATEGORIES = [
  { code: 'CHEM', display: 'Chemistry' },
  { code: 'HAEM', display: 'Haematology' },
  { code: 'MICRO', display: 'Microbiology' },
  { code: 'SERO', display: 'Serology' },
  { code: 'MOL', display: 'Molecular' },
];

const CATEGORY_VS_ID = 'vs-test-category';
const CATEGORY_VS_TITLE = 'Test categories';
const CATEGORY_VS_DESCRIPTION = 'The national list of test categories the test catalog uses.';
const CATEGORY_COMPOSE: VsCompose = { include: [{ system: CATEGORY_SYSTEM }] };

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;

  // One row per catalog test this install has touched. Sync never writes it: central's catalog
  // arrives as terminology concepts, and this table is the lab's own answer to it.
  await seedDb.schema.createTable('test_catalog_lab_settings')
    .addColumn('code', 'text', (c) => c.primaryKey())
    .addColumn('enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    // null means the lab uses the catalog's own specimen list. A list is the lab's narrower choice.
    .addColumn('specimen_types', 'jsonb')
    .addColumn('local_display', 'text')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  for (const s of SYSTEMS) {
    // ON CONFLICT (url) DO NOTHING: an install that already holds a system at this url keeps it.
    await seedDb.insertInto('coding_systems').values({
      ...s, active: true, publisher_id: PUBLISHER_ID, seeded: true,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }

  for (const c of CATEGORIES) {
    await seedDb.insertInto('terminology_concepts').values({
      system: CATEGORY_SYSTEM, code: c.code, display: c.display, status: 'ACTIVE', properties: null,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  // The category ValueSet, written the way 069 writes its sets: the value_sets row, the canonical
  // FHIR row and the terminology_systems registration, and deliberately no fhir.change_log row. It is
  // a whole-system include with no expansion, so the warehouse projection has nothing to lose. A
  // change_log row stamped with a lab's site_id would also be pushed to central, because the push
  // sends every change_log row (packages/db/src/projection/fetch.ts). ops.expand computes the set
  // live from the category concepts.
  await seedDb.insertInto('value_sets').values({
    id: CATEGORY_VS_ID, url: CATEGORY_VALUE_SET, version: null, name: 'test-category',
    title: CATEGORY_VS_TITLE, status: 'active', experimental: false, description: CATEGORY_VS_DESCRIPTION,
    compose: JSON.stringify(CATEGORY_COMPOSE) as never,
    immutable: false, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const resource = valueSetToFhirResource({
    id: CATEGORY_VS_ID, url: CATEGORY_VALUE_SET, status: 'active', experimental: false, version: null,
    name: 'test-category', title: CATEGORY_VS_TITLE, description: CATEGORY_VS_DESCRIPTION, compose: CATEGORY_COMPOSE,
  });
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: CATEGORY_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

  await seedDb.insertInto('terminology_systems').values({
    url: CATEGORY_VALUE_SET, version: null, kind: 'ValueSet', resource_id: CATEGORY_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedDb.deleteFrom('terminology_systems').where('url', '=', CATEGORY_VALUE_SET).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', CATEGORY_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', CATEGORY_VALUE_SET).execute();
  // This migration created the category system outright, so its concepts go with it. Catalog tests
  // are operator data written after this migration ran, so they stay.
  await seedDb.deleteFrom('terminology_concepts').where('system', '=', CATEGORY_SYSTEM).execute();
  await seedDb.deleteFrom('coding_systems').where('id', 'in', SYSTEMS.map((s) => s.id)).execute();
  await seedDb.schema.dropTable('test_catalog_lab_settings').ifExists().execute();
}
