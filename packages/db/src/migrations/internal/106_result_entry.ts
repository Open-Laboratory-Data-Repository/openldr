import { type Kysely } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 4). Two changes.
//
// 1. Two reason lists, one for a whole order and one for a single test, each a small code system plus
//    a ValueSet that includes it. Seeded the way 104 seeds the test categories, and with no
//    fhir.change_log row, so neither syncs. They are not immutable: a lab adds its own reasons on the
//    Terminology page, and central's reach it as concepts through the terminology pull.
//
// 2. The shipped Lab order gains the field that holds what the bench typed for each test. Same
//    exact-match, marker and down() discipline as 100 to 105: only a row still carrying 105's shape is
//    rewritten.
//
// Values are inlined, not imported: a migration is a frozen record, and packages/db must not depend
// on @openldr/forms or @openldr/bootstrap. These urls must stay equal to the constants of the same
// name in apps/server/src/test-catalog-routes.ts.
export const ORDER_REJECT_SYSTEM = 'urn:openldr:cs:reject-order';
export const TEST_REJECT_SYSTEM = 'urn:openldr:cs:reject-test';
export const ORDER_REJECT_VALUE_SET = 'urn:openldr:valueset:order-reject-reason';
export const TEST_REJECT_VALUE_SET = 'urn:openldr:valueset:test-reject-reason';
const PUBLISHER_ID = 'pub-system';

// Ids follow `codingSystems.upsertByUrl`'s `cs-url-${systemCode}`, as 104's do.
const SYSTEMS = [
  { id: 'cs-url-REJECT-ORDER', system_code: 'REJECT-ORDER', system_name: 'Order rejection reasons', url: ORDER_REJECT_SYSTEM },
  { id: 'cs-url-REJECT-TEST', system_code: 'REJECT-TEST', system_name: 'Test rejection reasons', url: TEST_REJECT_SYSTEM },
];

/** Starting reasons. A lab adds its own on the Terminology page. */
const ORDER_REASONS = [
  { code: 'WRONGPT', display: 'Wrong patient' },
  { code: 'UNLABELLED', display: 'Unlabelled specimen' },
  { code: 'DUPLICATE', display: 'Duplicate request' },
];
const TEST_REASONS = [
  { code: 'HAEM', display: 'Haemolysed' },
  { code: 'QNS', display: 'Insufficient volume' },
  { code: 'CLOTTED', display: 'Clotted' },
  { code: 'CONTAINER', display: 'Wrong container' },
];

const VALUE_SETS = [
  {
    id: 'vs-order-reject-reason', url: ORDER_REJECT_VALUE_SET, name: 'order-reject-reason',
    title: 'Order rejection reasons', description: 'Why a whole lab order was rejected.',
    compose: { include: [{ system: ORDER_REJECT_SYSTEM }] } as VsCompose,
  },
  {
    id: 'vs-test-reject-reason', url: TEST_REJECT_VALUE_SET, name: 'test-reject-reason',
    title: 'Test rejection reasons', description: 'Why one test on a lab order was rejected.',
    compose: { include: [{ system: TEST_REJECT_SYSTEM }] } as VsCompose,
  },
];

/** 105's shipped Lab order shape, copied verbatim, not imported. A migration is a frozen snapshot
 *  of one release and must not live-track another file. */
export const LAB_ORDER_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: "patient",
    fhirPath: "ServiceRequest.subject",
    displayLabel: "Patient",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 0,
    cardinality: { min: 0, max: "1" },
    section: "patient",
    referenceTarget: "Patient",
    placeholder: "Search by name, ID, or phone…"
  },
  {
    id: "tests",
    fhirPath: "ServiceRequest.code",
    displayLabel: "Tests",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 1,
    cardinality: { min: 1, max: "*" },
    referenceMultiple: true,
    section: "order",
    placeholder: "Search tests…",
    valueSetUrl: "urn:openldr:valueset:lab-tests"
  },
  {
    id: "fld-ord-priority",
    fhirPath: "ServiceRequest.priority",
    displayLabel: "Priority",
    description: null,
    fieldType: "select",
    required: true,
    enabled: true,
    order: 2,
    cardinality: { min: 0, max: "1" },
    section: "order",
    valueSetOptions: [
      { code: "routine", display: "Routine" },
      { code: "urgent", display: "Urgent" },
      { code: "asap", display: "ASAP" },
      { code: "stat", display: "STAT" }
    ]
  },
  {
    id: "fld-ord-ward",
    fhirPath: "ServiceRequest.locationCode.0",
    displayLabel: "Ward / Department",
    description: null,
    fieldType: "select",
    required: false,
    enabled: true,
    order: 3,
    cardinality: { min: 0, max: "1" },
    section: "order",
    valueSetOptions: [
      { code: "opd", display: "OPD" },
      { code: "ipd", display: "IPD" },
      { code: "icu", display: "ICU" }
    ]
  },
  {
    id: "fld-ord-clinician",
    fhirPath: "ServiceRequest.requester",
    displayLabel: "Requesting Clinician",
    description: null,
    fieldType: "text",
    required: false,
    enabled: true,
    order: 4,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "Dr. …"
  },
  {
    id: "fld-ord-ref-number",
    fhirPath: "ServiceRequest.identifier.value",
    fhirDiscriminator: { system: "urn:openldr:order:requisition" },
    fhirValueField: "value",
    displayLabel: "Reference Number",
    description: "External requisition number",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 5,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "REF-…"
  },
  {
    id: "fld-ord-notes",
    fhirPath: "ServiceRequest.note.0.text",
    displayLabel: "Clinical Notes",
    description: "Clinical context, suspected diagnosis…",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 6,
    cardinality: { min: 0, max: "1" },
    section: "order"
  },
  {
    id: "fld-ord-ref-facility",
    fhirPath: "ServiceRequest.performer",
    displayLabel: "Referring Facility",
    description: null,
    fieldType: "facility",
    required: false,
    enabled: true,
    order: 7,
    cardinality: { min: 0, max: "1" },
    section: "order",
    placeholder: "Search facilities by name or MFL ID…"
  },
  {
    id: "fld-ord-specimen-type",
    fhirPath: "Specimen.type",
    displayLabel: "Specimen Type",
    description: null,
    fieldType: "reference",
    required: true,
    enabled: true,
    order: 8,
    cardinality: { min: 1, max: "1" },
    section: "specimen",
    valueSetUrl: "urn:openldr:valueset:specimen-type",
    referenceDependsOn: "tests",
    placeholder: "Search specimen types…"
  }
];

/** The Lab order this release ships: 105's shape plus the results field, directly after Tests, with
 *  every later field's order shifted by one. Exported so packages/forms/src/samples/forms.test.ts can
 *  pin the CURRENT sample against it. */
export const LAB_ORDER_RESULTS_FIELDS_SNAPSHOT: readonly unknown[] = (() => {
  const prev = LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[];
  const results = {
    id: 'fld-ord-results',
    fhirPath: null,
    displayLabel: 'Results',
    description: null,
    fieldType: 'testDetails',
    required: false,
    enabled: true,
    order: 2,
    cardinality: { min: 0, max: '1' },
    section: 'order',
    referenceDependsOn: 'tests',
  };
  const out: Record<string, unknown>[] = [];
  for (const field of prev) {
    const order = field.order as number;
    out.push(order <= 1 ? field : { ...field, order: order + 1 });
    if (field.id === 'tests') out.push(results);
  }
  return out;
})();

/** Mirrors 071 to 105's MARKER_KEY discipline. */
const MARKER_KEY = '__migration106';

interface Migration106Marker {
  prevFields: readonly unknown[];
}

async function seedReasons(seedDb: Kysely<any>): Promise<void> {
  for (const s of SYSTEMS) {
    await seedDb.insertInto('coding_systems').values({
      ...s, active: true, publisher_id: PUBLISHER_ID, seeded: true,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }
  for (const [system, reasons] of [[ORDER_REJECT_SYSTEM, ORDER_REASONS], [TEST_REJECT_SYSTEM, TEST_REASONS]] as const) {
    for (const r of reasons) {
      await seedDb.insertInto('terminology_concepts').values({
        system, code: r.code, display: r.display, status: 'ACTIVE', properties: null,
      } as never).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
    }
  }

  // Written the way 104 writes the category set: the value_sets row, the canonical FHIR row and the
  // terminology_systems registration, and no fhir.change_log row, so neither set ever syncs.
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
    await seedDb.insertInto('fhir.fhir_resources').values({
      id: vs.id, resource_type: 'ValueSet', resource: JSON.stringify(resource),
    } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

    await seedDb.insertInto('terminology_systems').values({
      url: vs.url, version: null, kind: 'ValueSet', resource_id: vs.id,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }
}

async function addResultsField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 105's shape. A builder save leaves that shape unchanged
  // (forms.test.ts proves it). Anything else, already rewritten or an operator's own edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration106Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_RESULTS_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function removeResultsField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration106Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedReasons(seedDb);
  await addResultsField(seedDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await removeResultsField(seedDb);
  for (const vs of VALUE_SETS) {
    await seedDb.deleteFrom('terminology_systems').where('url', '=', vs.url).execute();
    await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).execute();
    await seedDb.deleteFrom('value_sets').where('url', '=', vs.url).execute();
  }
  // This migration created both reason systems outright, so their concepts go with them.
  for (const system of [ORDER_REJECT_SYSTEM, TEST_REJECT_SYSTEM]) {
    await seedDb.deleteFrom('terminology_concepts').where('system', '=', system).execute();
    await seedDb.deleteFrom('coding_systems').where('url', '=', system).execute();
  }
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 105, not
 *  imported: importing a private helper across migration files would couple two frozen snapshots. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}
