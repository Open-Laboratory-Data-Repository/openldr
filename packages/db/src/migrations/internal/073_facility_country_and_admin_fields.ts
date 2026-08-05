import { createHash } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import { BOUND_FIELDS_SNAPSHOT as PREV_BOUND_FIELDS_SNAPSHOT } from './072_facility_level_status_valuesets';

// Facility registry slice 3 (country + admin-hierarchy fields): seeds a Country ValueSet over all
// 249 ISO 3166-1 alpha-3 codes and repoints an already-migrated install's Facility form's
// country/zone/region/district fields (see migrations 071/072) to the bound/suggest field shapes
// the CURRENT sample ships (packages/forms/src/samples/forms.ts), adding a new optional `council`
// field that 071/072 never had. See
// docs/superpowers/specs/2026-08-05-facility-country-and-admin-hierarchy-design.md.
//
// ⛔ Every seeded concept's `status` is written UPPERCASE 'ACTIVE'. Downstream `filterConcepts`/
// `listSystemConcepts` compare status case-SENSITIVELY — a lowercase 'active' would not error, it
// would just silently exclude the concept from every activeOnly query. See 072's file comment and
// packages/db/src/terminology-admin-store.ts's `listSystemConcepts`.
//
// ⛔ `compose` never uses a FHIR `filter` clause — `value-set-expander.ts`'s `collectClause` ignores
// the filter `op` entirely (only ever compares `op === '='`), so an `is-a`/`regex`-style filter would
// silently match nothing. This is exactly why HL7's own published
// `http://hl7.org/fhir/ValueSet/iso3166-1-3` (which composes iso3166 with a `regex` filter) expands
// to zero concepts under this codebase's expander, and why this migration seeds its OWN enumerated
// ValueSet (`urn:openldr:valueset:country`) rather than trying to fix or reuse HL7's — see this
// file's test for the "does NOT overwrite iso3166-1-3" guard.

// ---------------------------------------------------------------------------------------------
// Country ValueSet — all 249 ISO 3166-1 alpha-3 codes, over ISO's own CodeSystem URN.
// ---------------------------------------------------------------------------------------------
const COUNTRY_SYSTEM = 'urn:iso:std:iso:3166';
const COUNTRY_VS_URL = 'urn:openldr:valueset:country';
const COUNTRY_VS_ID = 'vs-country';
const COUNTRY_PUBLISHER = 'pub-system';

// A real install could plausibly have imported ISO 3166 separately (e.g. through a future
// terminology import), landing a coding_systems row for this URL before this migration ever ran —
// the same possibility 072 accounts for with STATUS_SYSTEM (http://hl7.org/fhir/location-status).
// up() flips an existing INACTIVE row's `active` to true rather than inserting a duplicate; a bare
// test/CI database with no such row falls back to inserting a minimal one at THIS deterministic id.
const COUNTRY_CS_FALLBACK_ID = 'cs-openldr-iso3166-seed';

// 249 [alpha3, name] pairs, IDENTICAL to packages/db/src/iso3166.ts's ISO3166_COUNTRIES — pinned by
// this migration's own test file (073_facility_country_and_admin_fields.test.ts) rather than
// imported, mirroring 071/072's NEW_FIELDS_SNAPSHOT/BOUND_FIELDS_SNAPSHOT precedent: a migration is
// a frozen snapshot of one release and must not live-track a moving export, even one that lives in
// this same package — a future edit to iso3166.ts (a fixture regeneration, say) must not silently
// change what an ALREADY-RELEASED migration seeds on a fresh install. Six names carry diacritics
// (Åland Islands, Côte d'Ivoire, Curaçao, Réunion, Saint Barthélemy, Türkiye) — this file is UTF-8;
// keep it that way.
export const COUNTRY_CONCEPTS: [string, string][] = [
  ["AFG", "Afghanistan"],
  ["ALA", "Åland Islands"],
  ["ALB", "Albania"],
  ["DZA", "Algeria"],
  ["ASM", "American Samoa"],
  ["AND", "Andorra"],
  ["AGO", "Angola"],
  ["AIA", "Anguilla"],
  ["ATA", "Antarctica"],
  ["ATG", "Antigua and Barbuda"],
  ["ARG", "Argentina"],
  ["ARM", "Armenia"],
  ["ABW", "Aruba"],
  ["AUS", "Australia"],
  ["AUT", "Austria"],
  ["AZE", "Azerbaijan"],
  ["BHS", "Bahamas"],
  ["BHR", "Bahrain"],
  ["BGD", "Bangladesh"],
  ["BRB", "Barbados"],
  ["BLR", "Belarus"],
  ["BEL", "Belgium"],
  ["BLZ", "Belize"],
  ["BEN", "Benin"],
  ["BMU", "Bermuda"],
  ["BTN", "Bhutan"],
  ["BOL", "Bolivia, Plurinational State of"],
  ["BES", "Bonaire, Sint Eustatius and Saba"],
  ["BIH", "Bosnia and Herzegovina"],
  ["BWA", "Botswana"],
  ["BVT", "Bouvet Island"],
  ["BRA", "Brazil"],
  ["IOT", "British Indian Ocean Territory"],
  ["BRN", "Brunei Darussalam"],
  ["BGR", "Bulgaria"],
  ["BFA", "Burkina Faso"],
  ["BDI", "Burundi"],
  ["CPV", "Cabo Verde"],
  ["KHM", "Cambodia"],
  ["CMR", "Cameroon"],
  ["CAN", "Canada"],
  ["CYM", "Cayman Islands"],
  ["CAF", "Central African Republic"],
  ["TCD", "Chad"],
  ["CHL", "Chile"],
  ["CHN", "China"],
  ["CXR", "Christmas Island"],
  ["CCK", "Cocos (Keeling) Islands"],
  ["COL", "Colombia"],
  ["COM", "Comoros"],
  ["COG", "Congo"],
  ["COD", "Congo, Democratic Republic of the"],
  ["COK", "Cook Islands"],
  ["CRI", "Costa Rica"],
  ["CIV", "Côte d'Ivoire"],
  ["HRV", "Croatia"],
  ["CUB", "Cuba"],
  ["CUW", "Curaçao"],
  ["CYP", "Cyprus"],
  ["CZE", "Czechia"],
  ["DNK", "Denmark"],
  ["DJI", "Djibouti"],
  ["DMA", "Dominica"],
  ["DOM", "Dominican Republic"],
  ["ECU", "Ecuador"],
  ["EGY", "Egypt"],
  ["SLV", "El Salvador"],
  ["GNQ", "Equatorial Guinea"],
  ["ERI", "Eritrea"],
  ["EST", "Estonia"],
  ["SWZ", "Eswatini"],
  ["ETH", "Ethiopia"],
  ["FLK", "Falkland Islands (Malvinas)"],
  ["FRO", "Faroe Islands"],
  ["FJI", "Fiji"],
  ["FIN", "Finland"],
  ["FRA", "France"],
  ["GUF", "French Guiana"],
  ["PYF", "French Polynesia"],
  ["ATF", "French Southern Territories"],
  ["GAB", "Gabon"],
  ["GMB", "Gambia"],
  ["GEO", "Georgia"],
  ["DEU", "Germany"],
  ["GHA", "Ghana"],
  ["GIB", "Gibraltar"],
  ["GRC", "Greece"],
  ["GRL", "Greenland"],
  ["GRD", "Grenada"],
  ["GLP", "Guadeloupe"],
  ["GUM", "Guam"],
  ["GTM", "Guatemala"],
  ["GGY", "Guernsey"],
  ["GIN", "Guinea"],
  ["GNB", "Guinea-Bissau"],
  ["GUY", "Guyana"],
  ["HTI", "Haiti"],
  ["HMD", "Heard Island and McDonald Islands"],
  ["VAT", "Holy See"],
  ["HND", "Honduras"],
  ["HKG", "Hong Kong"],
  ["HUN", "Hungary"],
  ["ISL", "Iceland"],
  ["IND", "India"],
  ["IDN", "Indonesia"],
  ["IRN", "Iran, Islamic Republic of"],
  ["IRQ", "Iraq"],
  ["IRL", "Ireland"],
  ["IMN", "Isle of Man"],
  ["ISR", "Israel"],
  ["ITA", "Italy"],
  ["JAM", "Jamaica"],
  ["JPN", "Japan"],
  ["JEY", "Jersey"],
  ["JOR", "Jordan"],
  ["KAZ", "Kazakhstan"],
  ["KEN", "Kenya"],
  ["KIR", "Kiribati"],
  ["PRK", "Korea, Democratic People's Republic of"],
  ["KOR", "Korea, Republic of"],
  ["KWT", "Kuwait"],
  ["KGZ", "Kyrgyzstan"],
  ["LAO", "Lao People's Democratic Republic"],
  ["LVA", "Latvia"],
  ["LBN", "Lebanon"],
  ["LSO", "Lesotho"],
  ["LBR", "Liberia"],
  ["LBY", "Libya"],
  ["LIE", "Liechtenstein"],
  ["LTU", "Lithuania"],
  ["LUX", "Luxembourg"],
  ["MAC", "Macao"],
  ["MDG", "Madagascar"],
  ["MWI", "Malawi"],
  ["MYS", "Malaysia"],
  ["MDV", "Maldives"],
  ["MLI", "Mali"],
  ["MLT", "Malta"],
  ["MHL", "Marshall Islands"],
  ["MTQ", "Martinique"],
  ["MRT", "Mauritania"],
  ["MUS", "Mauritius"],
  ["MYT", "Mayotte"],
  ["MEX", "Mexico"],
  ["FSM", "Micronesia, Federated States of"],
  ["MDA", "Moldova, Republic of"],
  ["MCO", "Monaco"],
  ["MNG", "Mongolia"],
  ["MNE", "Montenegro"],
  ["MSR", "Montserrat"],
  ["MAR", "Morocco"],
  ["MOZ", "Mozambique"],
  ["MMR", "Myanmar"],
  ["NAM", "Namibia"],
  ["NRU", "Nauru"],
  ["NPL", "Nepal"],
  ["NLD", "Netherlands, Kingdom of the"],
  ["NCL", "New Caledonia"],
  ["NZL", "New Zealand"],
  ["NIC", "Nicaragua"],
  ["NER", "Niger"],
  ["NGA", "Nigeria"],
  ["NIU", "Niue"],
  ["NFK", "Norfolk Island"],
  ["MKD", "North Macedonia"],
  ["MNP", "Northern Mariana Islands"],
  ["NOR", "Norway"],
  ["OMN", "Oman"],
  ["PAK", "Pakistan"],
  ["PLW", "Palau"],
  ["PSE", "Palestine, State of"],
  ["PAN", "Panama"],
  ["PNG", "Papua New Guinea"],
  ["PRY", "Paraguay"],
  ["PER", "Peru"],
  ["PHL", "Philippines"],
  ["PCN", "Pitcairn"],
  ["POL", "Poland"],
  ["PRT", "Portugal"],
  ["PRI", "Puerto Rico"],
  ["QAT", "Qatar"],
  ["REU", "Réunion"],
  ["ROU", "Romania"],
  ["RUS", "Russian Federation"],
  ["RWA", "Rwanda"],
  ["BLM", "Saint Barthélemy"],
  ["SHN", "Saint Helena, Ascension and Tristan da Cunha"],
  ["KNA", "Saint Kitts and Nevis"],
  ["LCA", "Saint Lucia"],
  ["MAF", "Saint Martin (French part)"],
  ["SPM", "Saint Pierre and Miquelon"],
  ["VCT", "Saint Vincent and the Grenadines"],
  ["WSM", "Samoa"],
  ["SMR", "San Marino"],
  ["STP", "Sao Tome and Principe"],
  ["SAU", "Saudi Arabia"],
  ["SEN", "Senegal"],
  ["SRB", "Serbia"],
  ["SYC", "Seychelles"],
  ["SLE", "Sierra Leone"],
  ["SGP", "Singapore"],
  ["SXM", "Sint Maarten (Dutch part)"],
  ["SVK", "Slovakia"],
  ["SVN", "Slovenia"],
  ["SLB", "Solomon Islands"],
  ["SOM", "Somalia"],
  ["ZAF", "South Africa"],
  ["SGS", "South Georgia and the South Sandwich Islands"],
  ["SSD", "South Sudan"],
  ["ESP", "Spain"],
  ["LKA", "Sri Lanka"],
  ["SDN", "Sudan"],
  ["SUR", "Suriname"],
  ["SJM", "Svalbard and Jan Mayen"],
  ["SWE", "Sweden"],
  ["CHE", "Switzerland"],
  ["SYR", "Syrian Arab Republic"],
  ["TWN", "Taiwan, Province of China"],
  ["TJK", "Tajikistan"],
  ["TZA", "Tanzania, United Republic of"],
  ["THA", "Thailand"],
  ["TLS", "Timor-Leste"],
  ["TGO", "Togo"],
  ["TKL", "Tokelau"],
  ["TON", "Tonga"],
  ["TTO", "Trinidad and Tobago"],
  ["TUN", "Tunisia"],
  ["TUR", "Türkiye"],
  ["TKM", "Turkmenistan"],
  ["TCA", "Turks and Caicos Islands"],
  ["TUV", "Tuvalu"],
  ["UGA", "Uganda"],
  ["UKR", "Ukraine"],
  ["ARE", "United Arab Emirates"],
  ["GBR", "United Kingdom of Great Britain and Northern Ireland"],
  ["USA", "United States of America"],
  ["UMI", "United States Minor Outlying Islands"],
  ["URY", "Uruguay"],
  ["UZB", "Uzbekistan"],
  ["VUT", "Vanuatu"],
  ["VEN", "Venezuela, Bolivarian Republic of"],
  ["VNM", "Viet Nam"],
  ["VGB", "Virgin Islands (British)"],
  ["VIR", "Virgin Islands (U.S.)"],
  ["WLF", "Wallis and Futuna"],
  ["ESH", "Western Sahara"],
  ["YEM", "Yemen"],
  ["ZMB", "Zambia"],
  ["ZWE", "Zimbabwe"],
];

async function insertCountryConcepts(seedDb: Kysely<any>): Promise<void> {
  // Batched as ONE multi-row insert rather than looping an awaited insert per concept — see 072's
  // insertConcepts() comment: a 249-row sequential loop across every table in this migration was
  // measurably slow enough to tip otherwise-unrelated tests over their timeout when running the
  // whole migrations directory (every test in it calls makeMigratedDb(), which runs every migration
  // including this one).
  await seedDb.insertInto('terminology_concepts').values(
    COUNTRY_CONCEPTS.map(([code, display]) => ({ system: COUNTRY_SYSTEM, code, display, status: 'ACTIVE', properties: null })) as never,
  ).onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
}

// Duplicated from 072_facility_level_status_valuesets.ts's own seedHistoryAndChangeLog() (a private,
// unexported helper there) rather than imported — this migration's behaviour must not depend on
// another migration file's internals ever changing. See that file's comment for the full
// version-reuse rationale: without a `fhir.resource_history` row, a LATER edit through
// fhirStore.save() derives its next version from `coalesce(max(resource_history.version), 0) + 1`,
// landing back on 1 and creating a second change_log row at version 1 with a different content_hash.
async function seedHistoryAndChangeLog(seedDb: Kysely<any>, id: string, resource: unknown): Promise<void> {
  const serialized = JSON.stringify(resource);
  const contentHashHex = createHash('sha256').update(serialized).digest('hex');

  await seedDb.insertInto('fhir.resource_history').values({
    resource_type: 'ValueSet', id, version: 1, op: 'upsert', resource: serialized,
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id', 'version']).doNothing()).execute();

  const already = await seedDb
    .selectFrom('fhir.change_log')
    .select('seq')
    .where('resource_type', '=', 'ValueSet')
    .where('resource_id', '=', id)
    .executeTakeFirst();
  if (already) return;

  // site_id: null is deliberate — terminology travels the ValueSet/CodeSystem sync channel, never
  // the FHIR change_log a lab pushes from. See 072's identical comment on this same shape.
  await seedDb.insertInto('fhir.change_log').values({
    resource_type: 'ValueSet', resource_id: id, version: 1, op: 'upsert', content_hash: contentHashHex, site_id: null,
  } as never).execute();
}

async function seedCountryValueSet(seedDb: Kysely<any>): Promise<void> {
  const existing = await seedDb
    .selectFrom('coding_systems')
    .select(['id', 'active'])
    .where('url', '=', COUNTRY_SYSTEM)
    .executeTakeFirst();

  if (existing) {
    if (!existing.active) {
      await seedDb.updateTable('coding_systems').set({ active: true } as never).where('url', '=', COUNTRY_SYSTEM).execute();
    }
    // else: already active — up() has nothing to do, and therefore nothing for down() to reverse.
  } else {
    await seedDb.insertInto('coding_systems').values({
      id: COUNTRY_CS_FALLBACK_ID, system_code: 'ISO-3166', system_name: 'ISO 3166-1 Countries',
      url: COUNTRY_SYSTEM, system_version: null, description: 'ISO 3166-1 alpha-3 country codes.',
      active: true, publisher_id: COUNTRY_PUBLISHER, seeded: true,
    } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
  }

  await insertCountryConcepts(seedDb);

  const compose = { include: [{ system: COUNTRY_SYSTEM, concept: COUNTRY_CONCEPTS.map(([code, display]) => ({ code, display })) }] };
  await seedDb.insertInto('value_sets').values({
    id: COUNTRY_VS_ID, url: COUNTRY_VS_URL, version: null, name: 'country', title: 'Country',
    status: 'active', experimental: false, description: null, compose: JSON.stringify(compose) as never,
    immutable: false, category: null, publisher_id: COUNTRY_PUBLISHER, expanded_at: sql`now()`,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();

  await seedDb.insertInto('valueset_expansions').values(
    COUNTRY_CONCEPTS.map(([code, display]) => ({ value_set_id: COUNTRY_VS_ID, system_url: COUNTRY_SYSTEM, code, display, inactive: false })) as never,
  ).onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing()).execute();

  const resource = valueSetToFhirResource(
    { id: COUNTRY_VS_ID, url: COUNTRY_VS_URL, status: 'active', experimental: false, version: null, name: 'country', title: 'Country', description: null, compose },
    COUNTRY_CONCEPTS.map(([code, display]) => ({ system: COUNTRY_SYSTEM, code, display })),
  );
  // `fhir_resources` lives in the `fhir` schema since migration 045 — see 072's identical comment.
  await seedDb.insertInto('fhir.fhir_resources').values({
    id: COUNTRY_VS_ID, resource_type: 'ValueSet', resource: JSON.stringify(resource),
  } as never).onConflict((oc) => oc.columns(['resource_type', 'id']).doNothing()).execute();
  await seedHistoryAndChangeLog(seedDb, COUNTRY_VS_ID, resource);

  await seedDb.insertInto('terminology_systems').values({
    url: COUNTRY_VS_URL, version: null, kind: 'ValueSet', resource_id: COUNTRY_VS_ID,
  } as never).onConflict((oc) => oc.column('url').doNothing()).execute();
}

// ---------------------------------------------------------------------------------------------
// Form repoint: country -> bound reference field; zone/region/district -> suggest (no longer free
// text); council -> a NEW optional suggest field with no FHIR path (071/072 never had one). Inlined
// literals, not imported from @openldr/forms (packages/db must not depend on @openldr/forms, which
// already depends on packages/db) — same reasoning as 071's NEW_FIELDS / 072's STATUS_FIELD/
// LEVEL_FIELD.
// ---------------------------------------------------------------------------------------------
const COUNTRY_FIELD = {
  id: 'fld-fac-country', fhirPath: 'address.country', displayLabel: 'Country', description: null,
  fieldType: 'reference', required: true, enabled: true, order: 2,
  cardinality: { min: 1, max: '1' }, apiProperty: 'country',
  valueSetUrl: COUNTRY_VS_URL,
} as const;

const ZONE_FIELD = {
  id: 'fld-fac-zone', fhirPath: 'address.district', displayLabel: 'Zone', description: null,
  fieldType: 'suggest', required: true, enabled: true, order: 3,
  cardinality: { min: 1, max: '1' }, apiProperty: 'zone',
} as const;

const REGION_FIELD = {
  id: 'fld-fac-region', fhirPath: 'address.state', displayLabel: 'Region', description: null,
  fieldType: 'suggest', required: true, enabled: true, order: 4,
  cardinality: { min: 1, max: '1' }, apiProperty: 'region',
} as const;

const DISTRICT_FIELD = {
  id: 'fld-fac-district', fhirPath: 'address.city', displayLabel: 'District', description: null,
  fieldType: 'suggest', required: true, enabled: true, order: 5,
  cardinality: { min: 1, max: '1' }, apiProperty: 'district',
} as const;

// Optional — nobody may be blocked from saving a facility when council data is unknown.
// `fhirPath: null` (not `address.line`): no standard R4 Address element remains for a fourth admin
// tier once country/state/city/district are already bound above, and `address.line` is the
// STREET-ADDRESS element — binding an administrative tier to it would corrupt any future Location
// export. `FormField.fhirPath` is `z.string().nullable()`, and the `ambiguous-fhir-path` lint rule
// skips falsy paths (`if (!field.enabled || !field.fhirPath) continue`), so `null` is valid and
// lint-clean. See packages/forms/src/samples/forms.ts's matching comment on this same field.
const COUNCIL_FIELD = {
  id: 'fld-fac-council', fhirPath: null, displayLabel: 'Council', description: null,
  fieldType: 'suggest', required: false, enabled: true, order: 6,
  cardinality: { min: 0, max: '1' }, apiProperty: 'council',
} as const;

// The full 9-field Facility snapshot this release ships — copied, not derived from
// PREV_BOUND_FIELDS_SNAPSHOT, so nothing here depends on that array's element order ever staying
// the same. localCode/name and the status/level ValueSet bindings are UNCHANGED from 072 except for
// status/level's `order`, which shifts from 6/7 to 7/8 now that council occupies 6. Exported so
// packages/forms/src/samples/forms.test.ts can pin the CURRENT sample against this migration's idea
// of "bound", the same way it already pins against 071's and 072's snapshots.
export const BOUND_FIELDS_SNAPSHOT: readonly unknown[] = [
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
  COUNTRY_FIELD,
  ZONE_FIELD,
  REGION_FIELD,
  DISTRICT_FIELD,
  COUNCIL_FIELD,
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

/** Mirrors 072's MARKER_KEY discipline. See 071_facility_form_target.ts's MARKER_KEY doc comment
 *  for why a marker (not a heuristic re-derivation) is required: a fresh install seeded after this
 *  release lands on exactly BOUND_FIELDS_SNAPSHOT too, content-identical to a row up() just
 *  repointed. */
const MARKER_KEY = '__migration073';

interface Migration073Marker {
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

  // Only rewrites a row that exactly matches 072's BOUND_FIELDS_SNAPSHOT — anything else (already
  // rewritten by this migration, an operator's own edit, or a row that never reached 072's shape at
  // all) is left alone. Same discipline as 071/072's own guards.
  if (stableStringify(fields) !== stableStringify(PREV_BOUND_FIELDS_SNAPSHOT)) return;

  const marker: Migration073Marker = { prevFields: fields };
  const nextSchema = { ...(schema ?? {}), fields: BOUND_FIELDS_SNAPSHOT, [MARKER_KEY]: marker };

  await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(nextSchema) } as never).where('id', '=', row.id).execute();
}

async function unrepointForm(seedDb: Kysely<any>): Promise<void> {
  const rows = await seedDb.selectFrom('form_definitions').select(['id', 'schema']).where('name', '=', 'Facility').execute();
  for (const row of rows) {
    const schema = (typeof row.schema === 'string' ? JSON.parse(row.schema) : row.schema) as Record<string, unknown> | null;
    const marker = schema?.[MARKER_KEY] as Migration073Marker | undefined;
    if (!marker) continue; // never touched by up(), or an operator has since re-saved (stripping the marker)

    const { [MARKER_KEY]: _drop, ...rest } = schema as Record<string, unknown>;
    const prevSchema = { ...rest, fields: marker.prevFields };
    await seedDb.updateTable('form_definitions').set({ schema: JSON.stringify(prevSchema) } as never).where('id', '=', row.id).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await seedCountryValueSet(seedDb);
  await repointForm(seedDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  await unrepointForm(seedDb);

  await seedDb.deleteFrom('terminology_systems').where('url', '=', COUNTRY_VS_URL).execute();
  await seedDb.deleteFrom('fhir.fhir_resources').where('resource_type', '=', 'ValueSet').where('id', '=', COUNTRY_VS_ID).execute();
  await seedDb.deleteFrom('valueset_expansions').where('value_set_id', '=', COUNTRY_VS_ID).execute();
  await seedDb.deleteFrom('value_sets').where('url', '=', COUNTRY_VS_URL).execute();

  // COUNTRY_SYSTEM (urn:iso:std:iso:3166) is a real ISO standard, not a namespace this migration
  // created outright — a site could plausibly have imported it separately, landing some of these 249
  // codes before this migration ever ran, and up()'s `onConflict().doNothing()` would have silently
  // skipped inserting over them. There is no way to prove, row by row, which codes under this system
  // are "ours" — so down() does not delete ANY terminology_concepts row under COUNTRY_SYSTEM. Same
  // reasoning as 072's STATUS_SYSTEM down() comment.
  await seedDb.deleteFrom('coding_systems').where('id', '=', COUNTRY_CS_FALLBACK_ID).execute();
}

/** Order-preserving, object-key-order-insensitive deep equality via stable stringification —
 *  copied from 071/072 (not imported: importing a private helper across migration files would
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
