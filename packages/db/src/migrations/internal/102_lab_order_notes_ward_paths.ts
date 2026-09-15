import { type Kysely } from 'kysely';

// The shipped Lab order form's Clinical Notes and Ward / Department fields point at the first
// entry of their FHIR lists: `ServiceRequest.note.0.text` and `ServiceRequest.locationCode.0`.
//
// Both bound a whole list. Notes bound `ServiceRequest.note`, a list of Annotations, from a text
// box, so it tripped fhir-path-cardinality and fhir-path-type-mismatch. Ward bound
// `ServiceRequest.locationCode`, a list of CodeableConcepts, and tripped fhir-path-cardinality. An
// index is the grammar the 2026-08-21 FHIR path spec accepts for "which entry".
//
// Nothing reads either path when an order is submitted. The ServiceRequest extractor reads only the
// tests, the requisition number and the priority (packages/forms/src/extract/extract.ts), and
// packages/forms/src/samples/forms.test.ts proves the same answers extract to the same order before
// and after. The Questionnaire export carries a path verbatim in an extension.
//
// The clinician, the requisition number and the referring facility keep their warnings. Each needs
// a decision this migration does not make.
//
// Field literals are INLINED, not imported from @openldr/forms: packages/db must not depend on it.

/** The Lab order form as it ships today, copied verbatim. */
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
    cardinality: {
      min: 0,
      max: "1"
    },
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
    cardinality: {
      min: 1,
      max: "*"
    },
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
    cardinality: {
      min: 0,
      max: "1"
    },
    section: "order",
    valueSetOptions: [
      {
        code: "routine",
        display: "Routine"
      },
      {
        code: "urgent",
        display: "Urgent"
      },
      {
        code: "asap",
        display: "ASAP"
      },
      {
        code: "stat",
        display: "STAT"
      }
    ]
  },
  {
    id: "fld-ord-ward",
    fhirPath: "ServiceRequest.locationCode",
    displayLabel: "Ward / Department",
    description: null,
    fieldType: "select",
    required: false,
    enabled: true,
    order: 3,
    cardinality: {
      min: 0,
      max: "1"
    },
    section: "order",
    valueSetOptions: [
      {
        code: "opd",
        display: "OPD"
      },
      {
        code: "ipd",
        display: "IPD"
      },
      {
        code: "icu",
        display: "ICU"
      }
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
    cardinality: {
      min: 0,
      max: "1"
    },
    section: "order",
    placeholder: "Dr. …"
  },
  {
    id: "fld-ord-ref-number",
    fhirPath: "ServiceRequest.identifier",
    displayLabel: "Reference Number",
    description: "External requisition number",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 5,
    cardinality: {
      min: 0,
      max: "1"
    },
    section: "order",
    placeholder: "REF-…"
  },
  {
    id: "fld-ord-notes",
    fhirPath: "ServiceRequest.note",
    displayLabel: "Clinical Notes",
    description: "Clinical context, suspected diagnosis…",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 6,
    cardinality: {
      min: 0,
      max: "1"
    },
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
    cardinality: {
      min: 0,
      max: "1"
    },
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
    cardinality: {
      min: 1,
      max: "1"
    },
    section: "specimen",
    valueSetUrl: "urn:openldr:valueset:specimen-type",
    placeholder: "Search specimen types…"
  }
];

const PATHS: Record<string, string> = {
  'fld-ord-notes': 'ServiceRequest.note.0.text',
  'fld-ord-ward': 'ServiceRequest.locationCode.0',
};

/** The Lab order form this release ships. Exported so packages/forms/src/samples/forms.test.ts can
 *  pin the CURRENT sample against it. */
export const LAB_ORDER_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map(
  (f) => (PATHS[f.id as string] ? { ...f, fhirPath: PATHS[f.id as string] } : f),
);

/** Mirrors 071 to 101's MARKER_KEY discipline. */
const MARKER_KEY = '__migration102';

interface Migration102Marker {
  prevFields: readonly unknown[];
}

async function repoint(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches the shipped shape. A builder save leaves that shape
  // unchanged (forms.test.ts proves it), so one prior shape is enough. Anything else, already
  // rewritten or an operator's own edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration102Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepoint(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration102Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await repoint(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await unrepoint(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 101, not
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
