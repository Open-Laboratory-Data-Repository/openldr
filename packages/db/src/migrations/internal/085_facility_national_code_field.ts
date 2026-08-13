import { type Kysely } from 'kysely';

// Facility form: the national code becomes enterable, and the two markers the CSV import path can
// never satisfy stop being required.
//
// `local_code` is OURS and `national_code` is THEIRS (packages/db/src/facility-registry-store.ts's
// own words). A CSV import writes only the national one — `parseFacilityCsv` never produces a local
// code, deliberately, because a national register has no concept of one. So a form that REQUIRED the
// local code, and labelled it with the generic name "Facility code", meant an imported facility
// could not be saved from the Edit sheet at all, while the Facilities table beside it showed a code
// via `localCode ?? nationalCode`. Measured on a live Zambia MFL import: 3788 of 3788 rows have a
// null local code and every one displays a code in the table.
//
// `region` goes the same way for the same reason: Zambia has no tier between Province and District,
// so no row in that register can supply one.
//
// The two NEW fields are what make manual national registration possible at all. `nationalCode` and
// `nationalSystem` were always accepted by POST (both are in CORE_FACILITY_KEYS, so
// `splitFacilityAnswers` writes them) — no form field ever offered them.
//
// Field literals are INLINED, not imported from @openldr/forms — packages/db must not depend on it
// (@openldr/forms already depends on packages/db). Same reasoning as 071's NEW_FIELDS and 073's
// COUNTRY_FIELD.

/** 073's shipped shape, copied verbatim — not imported from that module. Copied for the same reason
 *  073 copied 072's: nothing here may depend on another migration's array staying frozen. */
const PREV_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-fac-local-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Facility code', description: null, fieldType: 'identifier',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'localCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 1,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 2,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 5,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 6,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 7,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 8,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** The 11-field Facility form this release ships. Exported so
 *  `packages/forms/src/samples/forms.test.ts` can pin the sample against it, exactly as it already
 *  does for 071/072/073. */
export const BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    // THEIRS, and the row's key material: `id = fac-sha256(nationalSystem|nationalCode)`
    // (`idFor`, packages/terminology/src/facility-csv.ts). Optional, because a lab-only facility
    // never has one. `urn:openldr:facility:national` is the discriminator 071's MFL ID field
    // already used for this same column, so a Location export stays consistent across eras.
    id: 'fld-fac-national-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'National code', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalCode',
  },
  {
    // `suggest`, fed by the install's registered facility registers (apps/studio wires that fetch
    // off the list the Edit sheet's provenance panel already loads). Free entry is NOT the gate:
    // POST resolves this through `resolveFacilityRegisterForImport` and refuses an unregistered or
    // deactivated register, the same gate every import door applies.
    //
    // `fhirPath: null` for the same reason 073's council field carries one — no standard R4 element
    // fits, and the `ambiguous-fhir-path` lint rule skips falsy paths, so null is valid and clean.
    id: 'fld-fac-national-system', fhirPath: null,
    displayLabel: 'Facility register', description: null, fieldType: 'suggest',
    required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalSystem',
  },
  {
    // Relabelled from "Facility code" and no longer required. The generic label is what made this
    // read as the same thing the Facilities table's CODE column shows — that column falls back
    // `localCode ?? nationalCode`, which is also how `registryPreferredCode`
    // (packages/db/src/facility-observed.ts) derives a row's public code everywhere else.
    id: 'fld-fac-local-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:local' },
    displayLabel: 'Local code', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 2, cardinality: { min: 0, max: '1' },
    apiProperty: 'localCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 5,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    // Optional: a register with no tier between province and district cannot supply one. Measured
    // 3788/3788 on the Zambia MFL export.
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 6,
    cardinality: { min: 0, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 7,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 8,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 9,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 10,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** Mirrors 071/072/073's MARKER_KEY discipline. See 071_facility_form_target.ts's MARKER_KEY doc
 *  comment for why a marker (not a heuristic re-derivation) is required: a fresh install seeded
 *  after this release lands on exactly BOUND_FIELDS_SNAPSHOT too, content-identical to a row up()
 *  just rewrote, and down() must be able to tell those two apart. */
const MARKER_KEY = '__migration085';

interface Migration085Marker {
  prevFields: readonly unknown[];
}

async function repointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb
    .selectFrom('form_definitions')
    .select(['id', 'schema'])
    .where('name', '=', 'Facility')
    .execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous — never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Only rewrites a row that exactly matches 073's shipped shape. Anything else — already rewritten
  // by this migration, an operator's own edit, or a row that never reached 073's shape at all — is
  // left alone. Same discipline as 071/072/073.
  if (stableStringify(fields) !== stableStringify(PREV_BOUND_FIELDS_SNAPSHOT)) return;

  const marker: Migration085Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };

  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Facility').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration085Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved (stripping the marker)

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await repointForm(db as Kysely<any>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await unrepointForm(db as Kysely<any>);
}

/** Order-preserving, object-key-order-insensitive deep equality via stable stringification —
 *  copied from 071/072/073 (not imported: importing a private helper across migration files would
 *  couple two supposedly-frozen snapshots together). */
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
