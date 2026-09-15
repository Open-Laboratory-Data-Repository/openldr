import { type Kysely } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose } from '../../value-set-expander';

// Test catalog S4 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.5). Two changes.
//
// 1. The lab's test list, `urn:openldr:valueset:lab-tests`, seeded the way 069 and 104 seed their
//    sets: the value_sets row, the canonical FHIR row and the terminology_systems registration, and no
//    fhir.change_log row, so it never syncs. Its stored list is empty on purpose. ops works the real
//    list out when it reads this url: the active catalog tests switched on here, under this lab's
//    local names (withLabTestsList, packages/bootstrap/src/test-catalog.ts). `immutable` stops the
//    Terminology page re-saving it through valueSets.save, which would write a change_log row.
//
// 2. The shipped Lab order's Tests field binds that list instead of the whole of LOINC, and its
//    Specimen Type field depends on Tests, so data entry narrows the specimens. Same exact-match,
//    marker and down() discipline as 100 to 103: only a row still carrying 103's shape is rewritten.
//
// Values are inlined, not imported: a migration is a frozen record, and packages/db must not depend
// on @openldr/forms or @openldr/bootstrap. LAB_TESTS_VALUE_SET must stay equal to the constant of the
// same name in packages/bootstrap/src/test-catalog.ts.
export const LAB_TESTS_VALUE_SET = 'urn:openldr:valueset:lab-tests';
const LAB_TESTS_VS_ID = 'vs-lab-tests';
const LAB_TESTS_VS_TITLE = "This lab's tests";
const LAB_TESTS_VS_DESCRIPTION =
  'The catalog tests switched on at this lab, under its local names. Worked out when read, so the stored list is empty.';
const PUBLISHER_ID = 'pub-system';
const EMPTY_COMPOSE: VsCompose = { include: [] };

/** 103's shipped Lab order shape, copied verbatim, not imported. A migration is a frozen snapshot
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
    referenceTarget: "http://loinc.org",
    placeholder: "Search tests…"
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
    placeholder: "Search specimen types…"
  }
];

/** The Lab order this release ships. Exported so packages/forms/src/samples/forms.test.ts can pin the
 *  CURRENT sample against it. */
export const LAB_ORDER_CATALOG_FIELDS_SNAPSHOT: readonly unknown[] = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map(
  (f) => {
    if (f.id === 'tests') {
      const { referenceTarget: _loinc, ...rest } = f;
      return { ...rest, valueSetUrl: LAB_TESTS_VALUE_SET };
    }
    if (f.id === 'fld-ord-specimen-type') return { ...f, referenceDependsOn: 'tests' };
    return f;
  },
);

/** Mirrors 071 to 103's MARKER_KEY discipline. */
const MARKER_KEY = '__migration105';

interface Migration105Marker {
  prevFields: readonly unknown[];
}

async function seedLabTestsList(seedDb: Kysely<any>): Promise<void> {
  // Written the way 104 writes the category set (104_test_catalog.ts:74-91), but immutable.
  await seedDb.insertInto('value_sets').values({
    id: LAB_TESTS_VS_ID, url: LAB_TESTS_VALUE_SET, version: null, name: 'lab-tests',
    title: LAB_TESTS_VS_TITLE, status: 'active', experimental: false, description: LAB_TESTS_VS_DESCRIPTION,
    compose: JSON.stringify(EMPTY_COMPOSE) as never,
    immutable: true, category: null, publisher_id: PUBLISHER_ID, expanded_at: null,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  const resource = valueSetToFhirResource({
    id: LAB_TESTS_VS_ID, url: LAB_TESTS_VALUE_SET, status: 'active', experimental: false, version: null,
    name: 'lab-tests', title: LAB_TESTS_VS_TITLE, description: LAB_TESTS_VS_DESCRIPTION, compose: EMPTY_COMPOSE,
  });
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: LAB_TESTS_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();

  await seedDb.insertInto('terminology_systems').values({
    url: LAB_TESTS_VALUE_SET, version: null, kind: 'ValueSet', resource_id: LAB_TESTS_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

async function rebindLabOrder(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 103's shape. A builder save leaves that shape unchanged
  // (forms.test.ts proves it). Anything else, already rewritten or an operator's own edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration105Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_CATALOG_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unbindLabOrder(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration105Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedLabTestsList(seedDb);
  await rebindLabOrder(seedDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await unbindLabOrder(seedDb);
  await seedDb.deleteFrom('terminology_systems').where('url', '=', LAB_TESTS_VALUE_SET).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', LAB_TESTS_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', LAB_TESTS_VALUE_SET).execute();
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 103, not
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
