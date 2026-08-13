import { type Kysely } from 'kysely';

// The Facility form collapses onto one code and the system that names it (migration 086).
//
// `fld-fac-national-code`, `fld-fac-national-system` and `fld-fac-local-code` are REMOVED and
// replaced by `fld-fac-system` + `fld-fac-code`. Three boxes become two, and the operator stops
// having to decide which of two code boxes theirs belongs in — the question that sent them into the
// wrong one in the first place.
//
// System comes FIRST: it is what gives the code meaning, and `Location.identifier` orders itself the
// same way (`Identifier{system, value}`).
//
// Field literals are INLINED, not imported from @openldr/forms — packages/db must not depend on it
// (@openldr/forms already depends on packages/db). Same reasoning as 071/073/085.

/** 085's shipped shape, copied verbatim — not imported from that module. Copied for the same reason
 *  085 copied 073's: nothing here may depend on another migration's array staying frozen. */
const PREV_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-fac-national-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'National code', description: null, fieldType: 'identifier',
    required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalCode',
  },
  {
    id: 'fld-fac-national-system', fhirPath: null,
    displayLabel: 'Facility register', description: null, fieldType: 'suggest',
    required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' },
    apiProperty: 'nationalSystem',
  },
  {
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

/** The 10-field Facility form this release ships. Exported so
 *  `packages/forms/src/samples/forms.test.ts` can pin the CURRENT sample against it, as it has for
 *  071/072/073/085. */
export const BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    // The register, by canonical URI. REQUIRED: with the code it is the row's identity, and a
    // facility naming no register cannot be reconciled against one.
    //
    // `suggest`, fed by the install's registered registers and defaulted from `lab.facilitySystem`
    // in Settings, so an operator names their register once rather than once per facility. Free
    // entry is not the gate — POST and PUT both resolve it through
    // `resolveFacilityRegisterForImport` and refuse an unregistered or deactivated one.
    //
    // `fhirPath: null` for the reason council carries one: no standard R4 element fits, and the
    // `ambiguous-fhir-path` lint rule skips falsy paths.
    id: 'fld-fac-system', fhirPath: null,
    displayLabel: 'System', description: null, fieldType: 'suggest',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'facilitySystem',
  },
  {
    // The one code. Was two boxes — "Facility code" bound to `localCode` and "National code" bound
    // to `nationalCode` — which is what let the Facilities table display a code the Edit sheet could
    // not bind. `urn:openldr:facility:national` stays as the discriminator so a Location export
    // keeps naming the same identifier system it did before the columns merged.
    id: 'fld-fac-code', fhirPath: 'identifier.value',
    fhirDiscriminator: { system: 'urn:openldr:facility:national' },
    displayLabel: 'Facility code', description: null, fieldType: 'identifier',
    required: true, enabled: true, order: 1, cardinality: { min: 1, max: '1' },
    apiProperty: 'facilityCode',
  },
  {
    id: 'fld-fac-name', fhirPath: 'name', displayLabel: 'Name', description: null,
    fieldType: 'text', required: true, enabled: true, order: 2,
    cardinality: { min: 1, max: '1' }, apiProperty: 'name',
  },
  {
    id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 3,
    cardinality: { min: 1, max: '1' }, apiProperty: 'country',
    valueSetUrl: 'urn:openldr:valueset:country',
  },
  {
    id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    // Optional since 085: not every register has a tier here. Measured 3788/3788 on the Zambia MFL
    // export, whose list has nothing between Province and District.
    id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 5,
    cardinality: { min: 0, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 6,
    cardinality: { min: 1, max: '1' }, apiProperty: 'district',
  },
  {
    id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 7,
    cardinality: { min: 0, max: '1' }, apiProperty: 'council',
  },
  {
    id: 'fld-fac-status', fhirPath: 'status', displayLabel: 'Status', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 8,
    cardinality: { min: 1, max: '1' }, apiProperty: 'status',
    valueSetUrl: 'urn:openldr:valueset:location-status',
  },
  {
    id: 'fld-fac-level', fhirPath: 'physicalType', displayLabel: 'Level', description: null,
    fieldType: 'reference', required: true, enabled: true, order: 9,
    cardinality: { min: 1, max: '1' }, apiProperty: 'level',
    valueSetUrl: 'urn:openldr:valueset:facility-type',
  },
];

/** Mirrors 071/072/073/085's MARKER_KEY discipline — a fresh install seeded after this release lands
 *  on exactly BOUND_FIELDS_SNAPSHOT too, content-identical to a row up() just rewrote, so down()
 *  needs a marker rather than a heuristic to tell them apart. */
const MARKER_KEY = '__migration087';

interface Migration087Marker {
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

  // Only rewrites a row that exactly matches 085's shipped shape. Anything else — already rewritten
  // by this migration, an operator's own edit, or a row that never reached 085's shape — is left
  // alone. Same discipline as 071/072/073/085.
  if (stableStringify(fields) !== stableStringify(PREV_BOUND_FIELDS_SNAPSHOT)) return;

  const marker: Migration087Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };

  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Facility').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration087Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved

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

/** Order-preserving, object-key-order-insensitive deep equality — copied from 071/072/073/085, not
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
