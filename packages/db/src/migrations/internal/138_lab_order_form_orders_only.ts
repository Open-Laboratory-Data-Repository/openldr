import { type Kysely } from 'kysely';

// The Lab order orders tests and no longer enters results (lab module slice 1b, 2026-11-22).
//
// Since 106 the Lab order carried a Results field (fld-ord-results, fieldType testDetails), so
// whoever placed the order could also type final results for it. Results now come from the lab's
// own result entry, round authorisation. This migration drops that one field. The order rejection
// field stays until the lab's rejection page ships (slice 3). The testDetails field type keeps
// working on any other form that has it.
//
// Same exact-match, marker and down() discipline as 100 to 115: only a row still carrying 115's
// shape is rewritten. Later fields move up one place, so the order numbers stay 0 to 8 with no gap.
//
// Values are inlined, not imported: a migration is a frozen record of one release.

/** 115's shipped Lab order shape, copied verbatim, not imported. */
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
      "placeholder": "Dr. \u2026",
      "fhirDiscriminator": {
        "type": "Practitioner"
      }
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
      "fhirPath": "ServiceRequest.requester",
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
      "fhirDiscriminator": {
        "type": "Organization"
      },
      "referenceTarget": "urn:openldr:cs:facility-registry",
      "placeholder": "Search facilities by name or MFL ID\u2026"
    },
    {
      "id": "fld-ord-rejection",
      "fhirPath": "ServiceRequest.extension",
      "fhirDiscriminator": {
        "url": "urn:openldr:ext:rejection"
      },
      "displayLabel": "Order rejection",
      "description": null,
      "fieldType": "reference",
      "required": false,
      "enabled": true,
      "order": 9,
      "cardinality": {
        "min": 0,
        "max": "1"
      },
      "section": "order",
      "valueSetUrl": "urn:openldr:valueset:order-reject-reason"
    }
  ];

/** The Lab order this release ships: 115's shape without the Results field. Exported so
 *  packages/forms/src/samples/forms.test.ts can pin the CURRENT sample against it. */
export const LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT: readonly unknown[] =
  (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[])
    .filter((f) => f.id !== 'fld-ord-results')
    .map((f, order) => ({ ...f, order }));

/** Mirrors 071 to 115's MARKER_KEY discipline. */
const MARKER_KEY = '__migration138';

interface Migration138Marker {
  prevFields: readonly unknown[];
}

/** Says why the Lab order was left alone, so an operator who edited it knows to remove Results by hand. */
function leftAlone(reason: string): void {
  console.warn(`migration 138: the Lab order form keeps its Results field: ${reason}`);
}

async function dropResultsField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length === 0) return; // none seeded yet: the seed ships the form without Results
  if (rows.length > 1) {
    leftAlone(`${rows.length} forms are named "Lab order", and this migration will not guess which one is the shipped form.`);
    return;
  }
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    leftAlone('the form has no fields.');
    return;
  }

  // Already rewritten: a second run changes nothing and says nothing.
  if (stableStringify(fields) === stableStringify(LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT)) return;

  // Only rewrites a row that exactly matches 115's shape. Anything else is an edit by the lab, and
  // is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) {
    if (fields.some((f) => (f as Record<string, unknown> | null)?.id === 'fld-ord-results')) {
      leftAlone('the form was edited after it shipped. Remove the Results field in the form builder.');
    }
    return;
  }

  const marker: Migration138Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_ORDERS_ONLY_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function restoreResultsField(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration138Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await dropResultsField(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await restoreResultsField(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 115, not
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
