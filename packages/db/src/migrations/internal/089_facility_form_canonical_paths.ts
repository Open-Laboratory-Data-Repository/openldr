import { type Kysely } from 'kysely';

// Corrects the Facility form's FHIR paths onto the right containment order (migration 087's shape
// otherwise stays in place forever). See
// docs/superpowers/specs/2026-08-21-fhir-path-validation-design.md section 6.
//
// Zone bound `address.district` and District bound `address.city`. FHIR R4 nests
// `country > state > district > city`, so the form had the widest administrative tier on the
// second-narrowest element. A reader of the exported Location would conclude Region contains Zone.
//
// Zone and Council get NO Address element. Only four of the registry's six administrative tiers
// (zone, region, district, council, ward, village) reach the form, and Address has no slot for a
// supra-regional Zone or a local-government Council. Both export properly only through
// `Location.partOf`, out of scope here. `Location.address.city` is left deliberately unmapped,
// reserved for Ward: it is R4's "city, town, suburb, village or other community", which describes
// Ward and Village, not a Council.
//
// Paths also gain their `Location.` resource prefix, the grammar this phase establishes.
//
// TWO prior shapes, not one. `normalize.ts` (Phase 1) upgrades every bare path to its prefixed form
// the next time an operator opens the Facility form in the builder and saves. An install that did
// that carries neither 087's shape nor this migration's corrected one: same paths as 087, but each
// already carrying `Location.`. Matching only 087's shape would silently skip that install, leaving
// Zone on `Location.address.district` forever, and the new `facility-admin-order` lint rule then
// makes that install's form unpublishable.
//
// Field literals are INLINED, not imported from @openldr/forms: packages/db must not depend on it
// (@openldr/forms already depends on packages/db). Same reasoning as 071/073/085/087.

/** 087's shipped shape, copied verbatim, not imported. A migration is a frozen snapshot of one
 *  release and must not live-track another file. */
export const PREV_BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
  {
    id: 'fld-fac-system', fhirPath: null,
    displayLabel: 'System', description: null, fieldType: 'suggest',
    required: true, enabled: true, order: 0, cardinality: { min: 1, max: '1' },
    apiProperty: 'facilitySystem',
  },
  {
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

/** 087's shape after `normalize.ts` prefixes every non-null path with the form's resource type.
 *  Every property other than `fhirPath` is identical to PREV_BOUND_FIELDS_SNAPSHOT above. This is
 *  what an install carries if an operator opened and saved the Facility form in the builder any
 *  time between Phase 1 landing and this migration running. */
export const PREV_CANONICALISED_SNAPSHOT: readonly unknown[] = [
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
    id: 'fld-fac-zone', fhirPath: 'Location.address.district', displayLabel: 'Zone', description: null,
    fieldType: 'suggest', required: true, enabled: true, order: 4,
    cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
  },
  {
    id: 'fld-fac-region', fhirPath: 'Location.address.state', displayLabel: 'Region', description: null,
    fieldType: 'suggest', required: false, enabled: true, order: 5,
    cardinality: { min: 0, max: '1' }, apiProperty: 'region',
  },
  {
    id: 'fld-fac-district', fhirPath: 'Location.address.city', displayLabel: 'District', description: null,
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

/** The corrected Facility form this release ships. Zone and Council carry `fhirPath: null`, on
 *  purpose: no Address element fits either tier, and the `ambiguous-fhir-path` and
 *  `facility-admin-order` lint rules both skip a falsy path. `Location.address.city` stays
 *  unmapped, reserved for Ward. Every property other than `fhirPath` is unchanged from 087's
 *  shape, including `required`, `order`, `cardinality`, `apiProperty`, `valueSetUrl`, and
 *  `fhirDiscriminator`. */
export const BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
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
    // No Address element fits a supra-regional Zone. It exports only through `Location.partOf`,
    // out of scope here.
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
    // A council is a local government authority, not a settlement. `address.city` is reserved for
    // Ward, which is what R4's "city, town, suburb, village or other community" actually describes.
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

/** Mirrors 071/072/073/087's MARKER_KEY discipline. A fresh install seeded after this release
 *  lands on exactly BOUND_FIELDS_SNAPSHOT too, content-identical to a row up() just rewrote, so
 *  down() needs a marker rather than a heuristic to tell them apart. The marker also records
 *  WHICH prior shape up() found, so down() restores that one, not the other. */
const MARKER_KEY = '__migration089';

interface Migration089Marker {
  prevFields: readonly unknown[];
}

async function repointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb
    .selectFrom('form_definitions')
    .select(['id', 'schema'])
    .where('name', '=', 'Facility')
    .execute();
  if (rows.length !== 1) return; // none seeded, or ambiguous: never guess which row is "the" one
  const row = rows[0];

  const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
  const fields = schema?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return;

  // Match against EITHER prior shape. Anything else, already corrected, an operator's own edit,
  // or a row that never reached either shape, is left alone.
  const fieldsStr = stableStringify(fields);
  let matchedPrior: readonly unknown[] | null = null;
  if (fieldsStr === stableStringify(PREV_BOUND_FIELDS_SNAPSHOT)) matchedPrior = PREV_BOUND_FIELDS_SNAPSHOT;
  else if (fieldsStr === stableStringify(PREV_CANONICALISED_SNAPSHOT)) matchedPrior = PREV_CANONICALISED_SNAPSHOT;
  if (!matchedPrior) return;

  const marker: Migration089Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };

  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Facility').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration089Marker | undefined;
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

/** Order-preserving, object-key-order-insensitive deep equality, copied from 071/072/073/087, not
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
