import { type Kysely } from 'kysely';

// The shipped Patient and Facility forms gain what the builder needs to draw a FHIR list as named
// slots: a discriminator that says which list entry a field fills, and the value field it writes.
//
// The builder draws a repeat node only for a field with BOTH (apps/studio/src/forms-builder/
// fieldTree.ts, as corlix does). No shipped form had both, so no install ever saw a list drawn as
// slots. The Patient form's first and last name drew as two unrelated rows and, with its phone,
// tripped CE's own fhir-path-cardinality warning three times. The Facility code had the
// discriminator but no value field.
//
// The values are corlix's, from its migration 012_fix_patient_form_fhir_paths: names are the
// `official` entry, the phone is the `phone` entry. CE never reads a discriminator when a record is
// saved (spec 2026-09-14-form-builder-corlix-parity-design.md section 9), so this changes what the
// builder draws and what lint reports, not what any page stores.
//
// The starter packs need no migration. Boot rewrites them from the sample forms on every start
// (`replaceSeeded` in packages/bootstrap/src/index.ts).
//
// Field literals are INLINED, not imported from @openldr/forms: packages/db must not depend on it
// (@openldr/forms already depends on packages/db). Same reasoning as 071/073/085/087/089.

/** The Patient form as it has shipped since 2026-06-19, copied verbatim. */
export const PATIENT_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-pat-first-name', fhirPath: 'Patient.name.given', displayLabel: 'First name',
    description: null, fieldType: 'text', required: true, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, section: 'demographics', apiProperty: 'firstName',
  },
  {
    id: 'fld-pat-last-name', fhirPath: 'Patient.name.family', displayLabel: 'Last name',
    description: null, fieldType: 'text', required: true, enabled: true, order: 1,
    cardinality: { min: 0, max: '1' }, section: 'demographics', apiProperty: 'lastName',
  },
  {
    id: 'fld-pat-dob', fhirPath: 'Patient.birthDate', displayLabel: 'Date of birth',
    description: null, fieldType: 'date', required: true, enabled: true, order: 2,
    cardinality: { min: 0, max: '1' }, section: 'demographics', apiProperty: 'dateOfBirth',
  },
  {
    id: 'fld-pat-sex', fhirPath: 'Patient.gender', displayLabel: 'Sex',
    description: null, fieldType: 'select', required: true, enabled: true, order: 3,
    cardinality: { min: 0, max: '1' }, section: 'demographics', apiProperty: 'sex',
    valueSetOptions: [
      { code: 'male', display: 'Male' },
      { code: 'female', display: 'Female' },
      { code: 'other', display: 'Other' },
      { code: 'unknown', display: 'Unknown' },
    ],
  },
  {
    id: 'fld-pat-phone', fhirPath: 'Patient.telecom.value', displayLabel: 'Phone',
    description: null, fieldType: 'phone', required: false, enabled: true, order: 4,
    cardinality: { min: 0, max: '1' }, section: 'demographics', placeholder: '+254…',
  },
];

/** The Patient form this release ships. Exported so packages/forms/src/samples/forms.test.ts can
 *  pin the CURRENT sample against it, as it does for the Facility form. */
export const PATIENT_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = (PATIENT_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map((f) => {
  if (f.id === 'fld-pat-first-name') return { ...f, fhirDiscriminator: { use: 'official' }, fhirValueField: 'given' };
  if (f.id === 'fld-pat-last-name') return { ...f, fhirDiscriminator: { use: 'official' }, fhirValueField: 'family' };
  if (f.id === 'fld-pat-phone') return { ...f, fhirDiscriminator: { system: 'phone' }, fhirValueField: 'value' };
  return f;
});

/** 089's shipped Facility shape, copied verbatim, not imported. A migration is a frozen snapshot of
 *  one release and must not live-track another file. */
export const FACILITY_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-fac-system', fhirPath: null,
    displayLabel: 'System', description: null, fieldType: 'suggest',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'facilitySystem',
  },
  {
    id: 'fld-fac-code', fhirPath: 'Location.identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'Facility code', description: null, fieldType: 'identifier',
    required: true, enabled: true, order: 1, cardinality: { min: 1, max: '1' },
    apiProperty: 'facilityCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'Location.name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 2,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'Location.address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: null, displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    id: 'fld-fac-region', fhirPath: 'Location.address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 5,
    cardinality: { min: 0, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'Location.address.district', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 6,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 7,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'Location.status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 8,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'Location.physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 9,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** The Facility form this release ships: 089's shape, and the code names `value` as its value field. */
export const FACILITY_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = (FACILITY_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map((f) =>
  f.id === 'fld-fac-code' ? { ...f, fhirValueField: 'value' } : f,
);

/** Mirrors 071/072/073/087/089's MARKER_KEY discipline. A fresh install seeded after this release
 *  lands on exactly the BOUND snapshot too, content-identical to a row up() just rewrote, so down()
 *  needs a marker rather than a heuristic to tell them apart. */
const MARKER_KEY = '__migration100';

interface Migration100Marker {
  prevFields: readonly unknown[];
}

const FORMS = [
  { name: 'Patient', prev: PATIENT_PREV_FIELDS_SNAPSHOT, next: PATIENT_BOUND_FIELDS_SNAPSHOT },
  { name: 'Facility', prev: FACILITY_PREV_FIELDS_SNAPSHOT, next: FACILITY_BOUND_FIELDS_SNAPSHOT },
] as const;

async function giveSlots(seedDb: Kysely<any>, name: string, prev: readonly unknown[], next: readonly unknown[]): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', name).execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches the shipped shape. Anything else, already rewritten,
  // an operator's own edit, or a row that never reached the shipped shape, is left alone.
  if (stableStringify(fields) !== stableStringify(prev)) return;

  const marker: Migration100Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: next, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function takeSlots(seedDb: Kysely<any>, name: string): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', name).execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration100Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const form of FORMS) await giveSlots(db as Kysely<any>, form.name, form.prev, form.next);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const form of FORMS) await takeSlots(db as Kysely<any>, form.name);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071/072/073/085/087/089,
 *  not imported: importing a private helper across migration files would couple two frozen snapshots. */
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
