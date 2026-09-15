import { type Kysely } from 'kysely';

// The shipped Lab order form's Reference Number fills the `urn:openldr:order:requisition` entry of
// ServiceRequest.identifier, the system the operator chose on 2026-09-15.
//
// It bound `ServiceRequest.identifier`, a list of Identifiers, from a text box, so it tripped
// fhir-path-cardinality and fhir-path-type-mismatch. It now binds
// `ServiceRequest.identifier.value`, with a discriminator naming the entry and `value` as its value
// field, so the builder draws it as a slot of ServiceRequest.identifier.
//
// The ServiceRequest extractor matched the old path exactly (packages/forms/src/extract/extract.ts)
// and now reads the new one too. Since 2026-09-15 it also writes the `system` the discriminator
// names, at the operator's request; every CE reader of an order identifier reads its value only.
// packages/forms/src/samples/forms.test.ts proves the same answers extract to the same order apart
// from that system. The old path stays readable because an install whose operator edited
// the form keeps it: this migration leaves such a form alone.
//
// Field literals are INLINED, not imported from @openldr/forms: packages/db must not depend on it.

/** 102's shipped Lab order shape, copied verbatim, not imported. A migration is a frozen snapshot
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
    fhirPath: "ServiceRequest.locationCode.0",
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
    fhirPath: "ServiceRequest.note.0.text",
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

/** The Lab order form this release ships. Exported so packages/forms/src/samples/forms.test.ts can
 *  pin the CURRENT sample against it. */
export const LAB_ORDER_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = (LAB_ORDER_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map(
  (f) =>
    f.id === 'fld-ord-ref-number'
      ? {
          ...f,
          fhirPath: 'ServiceRequest.identifier.value',
          fhirDiscriminator: { system: 'urn:openldr:order:requisition' },
          fhirValueField: 'value',
        }
      : f,
);

/** Mirrors 071 to 102's MARKER_KEY discipline. */
const MARKER_KEY = '__migration103';

interface Migration103Marker {
  prevFields: readonly unknown[];
}

async function giveSlot(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 102's shape. A builder save leaves that shape
  // unchanged (forms.test.ts proves it). Anything else, already rewritten or an operator's own
  // edit, is left alone.
  if (stableStringify(fields) !== stableStringify(LAB_ORDER_PREV_FIELDS_SNAPSHOT)) return;

  const marker: Migration103Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: LAB_ORDER_BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function takeSlot(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Lab order').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration103Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await giveSlot(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await takeSlot(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 102, not
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
