import { type Kysely } from 'kysely';

// The shipped Users form gains the same slot fields migration 100 gave the Patient form: first
// and last name fill the `official` entry of Practitioner.name, and the email fills the `email`
// entry of Practitioner.telecom. Corlix's values, from its seeded forms.
//
// Without them all three fields tripped CE's fhir-path-cardinality warning, and the builder drew
// them as loose rows rather than slots of one list. The Users page saves by apiProperty
// (packages/forms/src/page-targets.ts), and nothing reads a discriminator when a record is saved,
// so this changes what the builder draws and what lint reports, not what the page stores.
//
// The paths also gain their `Practitioner.` resource prefix, the grammar the 2026-08-21 FHIR path
// spec established and the other shipped forms already use.
//
// TWO prior shapes, not one, for the reason 089 gives: `normalize.ts` prefixes every bare path the
// next time an operator saves the form in the builder. An install that did that carries the
// prefixed shape. Matching only the bare one would skip it and leave its warnings in place.
//
// An install seeded before 2026-07-24 still carries the old Roles field (`8c0d6d44` removed it
// from the sample). It matches neither shape and is left alone, as an operator's edit would be.
//
// Field literals are INLINED, not imported from @openldr/forms: packages/db must not depend on it.

/** The Users form as it has shipped since 2026-07-24, copied verbatim. */
export const USERS_PREV_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-usr-first-name', fhirPath: 'name.given', displayLabel: 'First name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, apiProperty: 'firstName',
  },
  {
    id: 'fld-usr-last-name', fhirPath: 'name.family', displayLabel: 'Last name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 1,
    cardinality: { min: 0, max: '1' }, apiProperty: 'lastName',
  },
  {
    id: 'fld-usr-email', fhirPath: 'telecom.value', displayLabel: 'Email', description: null,
    fieldType: 'email', required: true, enabled: true, order: 2,
    cardinality: { min: 0, max: '1' }, apiProperty: 'email',
  },
];

const PREFIX: Record<string, string> = {
  'name.given': 'Practitioner.name.given',
  'name.family': 'Practitioner.name.family',
  'telecom.value': 'Practitioner.telecom.value',
};

/** The same form after a builder save has prefixed its paths. packages/forms/src/samples/
 *  forms.test.ts proves this is what the real normaliser produces. */
export const USERS_PREV_CANONICALISED_SNAPSHOT: readonly unknown[] = (USERS_PREV_FIELDS_SNAPSHOT as Record<string, unknown>[]).map(
  (f) => ({ ...f, fhirPath: PREFIX[f.fhirPath as string] }),
);

const SLOTS: Record<string, { fhirDiscriminator: Record<string, string>; fhirValueField: string }> = {
  'fld-usr-first-name': { fhirDiscriminator: { use: 'official' }, fhirValueField: 'given' },
  'fld-usr-last-name': { fhirDiscriminator: { use: 'official' }, fhirValueField: 'family' },
  'fld-usr-email': { fhirDiscriminator: { system: 'email' }, fhirValueField: 'value' },
};

/** The Users form this release ships. Exported so packages/forms/src/samples/forms.test.ts can pin
 *  the CURRENT sample against it. */
export const USERS_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = (USERS_PREV_CANONICALISED_SNAPSHOT as Record<string, unknown>[]).map(
  (f) => ({ ...f, ...SLOTS[f.id as string] }),
);

/** Mirrors 071/072/073/087/089/100's MARKER_KEY discipline. The marker also records WHICH prior
 *  shape up() found, so down() restores that one, not the other. */
const MARKER_KEY = '__migration101';

interface Migration101Marker {
  prevFields: readonly unknown[];
}

async function giveSlots(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Users').execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Match against EITHER prior shape. Anything else, already rewritten, an operator's own edit,
  // or a pre-2026-07-24 form still carrying Roles, is left alone.
  const fieldsStr = stableStringify(fields);
  const matched =
    fieldsStr === stableStringify(USERS_PREV_FIELDS_SNAPSHOT) ||
    fieldsStr === stableStringify(USERS_PREV_CANONICALISED_SNAPSHOT);
  if (!matched) return;

  const marker: Migration101Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: USERS_BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };
  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function takeSlots(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Users').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration101Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await giveSlots(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await takeSlots(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071 to 100, not
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
