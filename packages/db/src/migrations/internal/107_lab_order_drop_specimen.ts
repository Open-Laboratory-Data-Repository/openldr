import { type Kysely } from 'kysely';

// Bench result entry follow-up (2026-09-16). The Lab order asked for a specimen twice: once per test
// inside the results sheet, and once in its own Specimen Collection section, which was required. The
// operator chose to keep the per-test one, so this migration drops the order-level field.
//
// Same exact-match, marker and down() discipline as 100 to 106: only a row still carrying 106's shape
// is rewritten. The field was last in the list, so no other field's order moves.
//
// Values are inlined, not imported: a migration is a frozen record of one release.

/** 106's shipped Lab order shape, copied verbatim, not imported. */
export const LAB_ORDER_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
    {
      "id": "patient",
      "fhirPath": "ServiceRequest.subject",
      "displayLabel": "Patient",
      "description": null,
      "fieldType": "reference",
      "required": true,
      "enabled": true,
      "order": 0,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "patient",
      "referenceTarget": "Patient",
      "placeholder": "Search by name, ID, or phone\u2026"
    },
    {
      "id": "tests",
      "fhirPath": "ServiceRequest.code",
      "displayLabel": "Tests",
      "description": null,
      "fieldType": "reference",
      "required": true,
      "enabled": true,
      "order": 1,
      "cardinality": {
        "min": 1,
        "max": "*"
      },
      "referenceMultiple": true,
      "section": "order",
      "placeholder": "Search tests\u2026",
      "valueSetUrl": "urn:openldr:valueset:lab-tests"
    },
    {
      "id": "fld-ord-results",
      "fhirPath": null,
      "displayLabel": "Results",
      "description": null,
      "fieldType": "testDetails",
      "required": false,
      "enabled": true,
      "order": 2,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "referenceDependsOn": "tests"
    },
    {
      "id": "fld-ord-priority",
      "fhirPath": "ServiceRequest.priority",
      "displayLabel": "Priority",
      "description": null,
      "fieldType": "select",
      "required": true,
      "enabled": true,
      "order": 3,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetOptions": [
        {
          "code": "routine",
          "display": "Routine"
        },
        {
          "code": "urgent",
          "display": "Urgent"
        },
        {
          "code": "asap",
          "display": "ASAP"
        },
        {
          "code": "stat",
          "display": "STAT"
        }
      ]
    },
    {
      "id": "fld-ord-ward",
      "fhirPath": "ServiceRequest.locationCode.0",
      "displayLabel": "Ward / Department",
      "description": null,
      "fieldType": "select",
      "required": false,
      "enabled": true,
      "order": 4,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetOptions": [
        {
          "code": "opd",
          "display": "OPD"
        },
        {
          "code": "ipd",
          "display": "IPD"
        },
        {
          "code": "icu",
          "display": "ICU"
        }
      ]
    },
    {
      "id": "fld-ord-clinician",
      "fhirPath": "ServiceRequest.requester",
      "displayLabel": "Requesting Clinician",
      "description": null,
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 5,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "placeholder": "Dr. \u2026"
    },
    {
      "id": "fld-ord-ref-number",
      "fhirPath": "ServiceRequest.identifier.value",
      "fhirDiscriminator": {
        "system": "urn:openldr:order:requisition"
      },
      "fhirValueField": "value",
      "displayLabel": "Reference Number",
      "description": "External requisition number",
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 6,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "placeholder": "REF-\u2026"
    },
    {
      "id": "fld-ord-notes",
      "fhirPath": "ServiceRequest.note.0.text",
      "displayLabel": "Clinical Notes",
      "description": "Clinical context, suspected diagnosis\u2026",
      "fieldType": "text",
      "required": false,
      "enabled": true,
      "order": 7,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order"
    },
    {
      "id": "fld-ord-ref-facility",
      "fhirPath": "ServiceRequest.performer",
      "displayLabel": "Referring Facility",
      "description": null,
      "fieldType": "facility",
      "required": false,
      "enabled": true,
      "order": 8,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "placeholder": "Search facilities by name or MFL ID\u2026"
    },
    {
      "id": "fld-ord-specimen-type",
      "fhirPath": "Specimen.type",
      "displayLabel": "Specimen Type",
      "description": null,
      "fieldType": "reference",
      "required": true,
      "enabled": true,
      "order": 9,
      "cardinality": {
        "min": 1,
        "max": "1"
      },
      "section": "specimen",
      "valueSetUrl": "urn:openldr:valueset:specimen-type",
      "referenceDependsOn": "tests",
      "placeholder": "Search specimen types\u2026"
    }
  ];

/** The Lab order this release ships: 106's shape without the order-level specimen field. Exported so
 *  packages/forms/src/samples/forms.test.ts can pin the CURRENT sample against it. */
export const LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT: readonly unknown[] =
  (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).filter((f) => f.id !== 'fld-ord-specimen-type');

/** Mirrors 071 to 106's MARKER_KEY discipline. */
const MARKER_KEY = '__migration107';

interface Migration107Marker {
  prevFields: readonly unknown[];
}

async function dropOrderSpecimen(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 106's shape. Anything else, already rewritten or an
  // operator's own edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration107Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_NO_ORDER_SPECIMEN_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function restoreOrderSpecimen(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration107Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await dropOrderSpecimen(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await restoreOrderSpecimen(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 106, not
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
