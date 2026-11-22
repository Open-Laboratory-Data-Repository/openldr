import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Lab module slice 1a (docs/superpowers/specs/2026-11-22-lab-module-design.md, 5.2, 5.3, 5.4 and 5.9).
// Two changes.
//
// 1. Each lab's row in test_catalog_lab_settings gains `section` (a code from the lab's own section
//    list, or null) and `needs_review` (true unless the lab says otherwise).
//
// 2. Three lists, each a code system and a ValueSet that includes it, seeded the way 106 seeds the
//    rejection reasons, with no fhir.change_log row, so none syncs:
//    - the lab's sections, empty: the lab adds its own;
//    - why reception returns an order to its site;
//    - a sample's condition, from HL7 v2 table 0493. The set includes that whole system, so a lab
//      adds a condition of its own by adding a concept to it, or by including its own system.
//
// Since 130, fhir.fhir_resources is a view, so each ValueSet goes into fhir.fhir_current and
// fhir.resource_history (as register-fhir-catalog.ts writes them).
//
// Values are inlined, not imported: a migration is a frozen record. The urls must stay equal to the
// constants of the same name in packages/bootstrap/src/test-catalog.ts.
export const LAB_SECTION_SYSTEM = 'urn:openldr:cs:lab-section';
export const LAB_SECTION_VALUE_SET = 'urn:openldr:valueset:lab-section';
export const ORDER_RETURN_SYSTEM = 'urn:openldr:cs:order-return-reason';
export const ORDER_RETURN_VALUE_SET = 'urn:openldr:valueset:order-return-reason';
export const SAMPLE_CONDITION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0493';
export const SAMPLE_CONDITION_VALUE_SET = 'urn:openldr:valueset:sample-condition';
const PUBLISHER_ID = 'pub-system';
/** The seeded publisher whose prefixes cover terminology.hl7.org (packages/db/src/seed-publishers.ts). */
const HL7_PUBLISHER_ID = 'pub-hl7-fhir';

// Ids follow `codingSystems.upsertByUrl`'s `cs-url-${systemCode}`, as 104's and 106's do.
const SYSTEMS = [
  { id: 'cs-url-LAB-SECTION', system_code: 'LAB-SECTION', system_name: 'Lab sections', url: LAB_SECTION_SYSTEM, publisher_id: PUBLISHER_ID },
  { id: 'cs-url-ORDER-RETURN-REASON', system_code: 'ORDER-RETURN-REASON', system_name: 'Order return reasons', url: ORDER_RETURN_SYSTEM, publisher_id: PUBLISHER_ID },
  { id: 'cs-url-V2-0493', system_code: 'V2-0493', system_name: 'Specimen condition (HL7 v2 table 0493)', url: SAMPLE_CONDITION_SYSTEM, publisher_id: HL7_PUBLISHER_ID },
];

/** Starting reasons. A lab adds its own on the Terminology page. */
const RETURN_REASONS = [
  { code: 'clerical-mistake', display: 'Clerical mistake' },
  { code: 'form-incomplete', display: 'Form incomplete' },
  { code: 'form-unreadable', display: 'Form not readable' },
  { code: 'wrong-patient-details', display: 'Wrong patient details' },
];

/** Every code of HL7 v2 table 0493, Specimen Condition (terminology.hl7.org CodeSystem v2-0493, 3.0.0). */
const SAMPLE_CONDITIONS = [
  { code: 'AUT', display: 'Autolyzed' },
  { code: 'CLOT', display: 'Clotted' },
  { code: 'CON', display: 'Contaminated' },
  { code: 'COOL', display: 'Cool' },
  { code: 'FROZ', display: 'Frozen' },
  { code: 'HEM', display: 'Hemolyzed' },
  { code: 'LIVE', display: 'Live' },
  { code: 'ROOM', display: 'Room temperature' },
  { code: 'SNR', display: 'Sample not received' },
  { code: 'CFU', display: 'Centrifuged' },
];

const CONCEPTS = [
  ...RETURN_REASONS.map((r) => ({ system: ORDER_RETURN_SYSTEM, ...r })),
  ...SAMPLE_CONDITIONS.map((c) => ({ system: SAMPLE_CONDITION_SYSTEM, ...c })),
];

const VALUE_SETS = [
  {
    id: 'vs-lab-section', url: LAB_SECTION_VALUE_SET, name: 'lab-section',
    title: 'Lab sections', description: "The lab's own sections, such as haematology or chemistry.",
    compose: { include: [{ system: LAB_SECTION_SYSTEM }] } as VsCompose,
  },
  {
    id: 'vs-order-return-reason', url: ORDER_RETURN_VALUE_SET, name: 'order-return-reason',
    title: 'Order return reasons', description: 'Why reception returned a lab order to its site.',
    compose: { include: [{ system: ORDER_RETURN_SYSTEM }] } as VsCompose,
  },
  {
    id: 'vs-sample-condition', url: SAMPLE_CONDITION_VALUE_SET, name: 'sample-condition',
    title: 'Sample conditions', description: 'The condition of a sample when the lab received it.',
    compose: { include: [{ system: SAMPLE_CONDITION_SYSTEM }] } as VsCompose,
  },
];

async function seedLists(seedDb: Kysely<any>): Promise<void> {
  for (const s of SYSTEMS) {
    await seedDb.insertInto('coding_systems').values({
      ...s, active: true, seeded: true, origin: 'core',
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }
  for (const c of CONCEPTS) {
    await seedDb.insertInto('terminology_concepts').values({
      system: c.system, code: c.code, display: c.display, status: 'ACTIVE', properties: null,
    } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }

  for (const vs of VALUE_SETS) {
    await seedDb.insertInto('value_sets').values({
      id: vs.id, url: vs.url, version: null, name: vs.name, title: vs.title, status: 'active',
      experimental: false, description: vs.description, compose: JSON.stringify(vs.compose) as never,
      immutable: false, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

    const resource = valueSetToFhirResource({
      id: vs.id, url: vs.url, status: 'active', experimental: false, version: null,
      name: vs.name, title: vs.title, description: vs.description, compose: vs.compose,
    });
    await seedDb.insertInto('fhir.resource_history').values({
      resource_type: 'ValueSet', id: vs.id, version: 1, op: 'upsert', resource: JSON.stringify(resource),
    } as never).onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing()).execute();
    await seedDb.insertInto('fhir.fhir_current').values({
      resource_type: 'ValueSet', id: vs.id, version: 1, version_id: '1',
    } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

    await seedDb.insertInto('terminology_systems').values({
      url: vs.url, version: null, kind: 'ValueSet', resource_id: vs.id,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  // `if not exists`, so a second run changes nothing, as the seeds' onConflict does for them.
  await sql`alter table test_catalog_lab_settings add column if not exists section text`.execute(db);
  await sql`alter table test_catalog_lab_settings add column if not exists needs_review boolean not null default true`.execute(db);
  await seedLists(seedDb);
}

// Removes the rows up() writes, by the exact ids and codes it writes. A system's seeded concepts go
// only when coding_systems holds that system's url under 137's id, so up() created the system. A
// system already there under another id was skipped by up(), and its concepts stay. A row already
// there under the same id, or a concept under the same code in a system 137 created, cannot be told
// apart from one up() made, and goes too. Concepts a lab added later are not touched.
export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  for (const vs of VALUE_SETS) {
    await seedDb.deleteFrom('terminology_systems').where('url', '=', vs.url).where('resource_id', '=', vs.id).execute();
    await seedDb.deleteFrom('fhir.fhir_current').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute();
    await seedDb.deleteFrom('fhir.resource_history').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute();
    await seedDb.deleteFrom('value_sets').where('id', '=', vs.id).execute();
  }
  const held = await seedDb.selectFrom('coding_systems').select(['id', 'url'])
    .where('id', 'in', SYSTEMS.map((s) => s.id)).execute() as Array<{ id: string; url: string | null }>;
  const created = new Set(held.filter((r) => SYSTEMS.some((s) => s.id === r.id && s.url === r.url)).map((r) => r.url));
  for (const c of CONCEPTS) {
    if (!created.has(c.system)) continue;
    await seedDb.deleteFrom('terminology_concepts').where('system', '=', c.system).where('code', '=', c.code).execute();
  }
  for (const s of SYSTEMS) {
    await seedDb.deleteFrom('coding_systems').where('id', '=', s.id).execute();
  }
  await seedDb.schema.alterTable('test_catalog_lab_settings').dropColumn('needs_review').dropColumn('section').execute();
}
