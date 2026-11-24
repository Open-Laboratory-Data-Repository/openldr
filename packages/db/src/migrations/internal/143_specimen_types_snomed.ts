import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose, VsInclude } from '../../value-set-expander';

// Corlix's specimen types, linked to SNOMED (docs/superpowers/plans/2026-11-24-test-catalog-corlix-parity-a.md,
// task 2).
//
// 1. The 11 specimen types 014 did not seed become local concepts.
// 2. The specimen value set gains each new code it lacks. The four codes 014 seeded are never added
//    back, nothing is removed, and the status stays as the lab left it. A lab that deleted the set
//    gets no set back.
// 3. Each of the 15 codes gets a SAME-AS link to its SNOMED code in the local map, written as the
//    Terminology page writes one (terminology-admin-store.ts, termMappings.create): a term_mappings
//    row and its concept_map_elements mirror. A code that already has any SNOMED link, active or
//    switched off, keeps it as it is.
//
// Like 137 and 140, this writes no fhir.change_log row, so the value set change does not sync.
// Values are inlined, not imported: a migration is a frozen record of one release (see 078).
const LOCAL_CS = 'urn:openldr:cs:local';
const SNOMED = 'http://snomed.info/sct';
const LOCAL_MAP_URL = 'urn:openldr:terminology:local-map';
const SPECIMEN_VALUE_SET = 'urn:openldr:valueset:specimen-type';
/** term_mappings ids this migration writes. down() uses them to find its own rows. */
const MAPPING_ID_PREFIX = 'tm-m143-';

const OLD_CODES = new Set(['BLD', 'UR', 'CSF', 'SPT']);
const SPECIMENS: Array<{ code: string; display: string; snomed: string }> = [
  { code: 'BLD', display: 'Blood', snomed: '119297000' },
  { code: 'UR', display: 'Urine', snomed: '122575003' },
  { code: 'CSF', display: 'CSF', snomed: '258566005' },
  { code: 'SPT', display: 'Sputum', snomed: '119394009' },
  { code: 'PLAS', display: 'Plasma', snomed: '119361006' },
  { code: 'SER', display: 'Serum', snomed: '119364003' },
  { code: 'STL', display: 'Stool', snomed: '119339001' },
  { code: 'PLR', display: 'Pleural fluid', snomed: '418564007' },
  { code: 'ASC', display: 'Ascitic fluid', snomed: '309201001' },
  { code: 'SAL', display: 'Saliva', snomed: '119342007' },
  { code: 'WND', display: 'Wound specimen', snomed: '119295008' },
  { code: 'THRT', display: 'Throat swab', snomed: '258529004' },
  { code: 'NASL', display: 'Nasal swab', snomed: '258603007' },
  { code: 'SYN', display: 'Synovial fluid', snomed: '258580003' },
  { code: 'BM', display: 'Bone marrow', snomed: '122592007' },
];
const NEW_SPECIMENS = SPECIMENS.filter((s) => !OLD_CODES.has(s.code));

function parse<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

async function addToValueSet(db: Kysely<any>): Promise<void> {
  const vs = await db.selectFrom('value_sets').selectAll().where('url', '=', SPECIMEN_VALUE_SET).executeTakeFirst();
  if (!vs) return;
  const compose = parse<VsCompose>(vs.compose) ?? {};
  const include: VsInclude[] = [...(compose.include ?? [])];
  const localIncludes = include.filter((i) => i.system === LOCAL_CS);
  // An include of the whole local system, with no concept list or filter, already holds every code.
  if (localIncludes.some((i) => !i.concept && !i.filter && !i.valueSet)) return;

  // A code the lab excluded counts as present, so it is not added back.
  const excluded = (compose.exclude ?? []).filter((i) => i.system === LOCAL_CS).flatMap((i) => (i.concept ?? []).map((c) => c.code));
  const present = new Set([...localIncludes.flatMap((i) => (i.concept ?? []).map((c) => c.code)), ...excluded]);
  const missing = NEW_SPECIMENS.filter((s) => !present.has(s.code));
  if (missing.length === 0) return;

  const added = missing.map((s) => ({ code: s.code, display: s.display }));
  const target = include.findIndex((i) => i.system === LOCAL_CS && i.concept && !i.filter && !i.valueSet);
  if (target >= 0) include[target] = { ...include[target], concept: [...(include[target]!.concept ?? []), ...added] };
  else include.push({ system: LOCAL_CS, concept: added });
  const nextCompose: VsCompose = { ...compose, include };

  await db.updateTable('value_sets').set({
    compose: JSON.stringify(nextCompose) as never, expanded_at: sql`now()`, updated_at: sql`now()`,
  }).where('id', '=', vs.id).execute();
  for (const s of missing) {
    await db.insertInto('valueset_expansions').values({ value_set_id: vs.id, system_url: LOCAL_CS, code: s.code, display: s.display, inactive: false })
      .onConflict((oc) => oc.columns(['value_set_id', 'system_url', 'code']).doNothing()).execute();
  }

  // Rebuild the stored resource as 014 does, with the expansion in compose order.
  const rows = await db.selectFrom('valueset_expansions').select(['system_url', 'code', 'display']).where('value_set_id', '=', vs.id).execute();
  const order = new Map<string, number>();
  include.forEach((i) => (i.concept ?? []).forEach((c) => {
    const key = `${i.system ?? ''}|${c.code}`;
    if (!order.has(key)) order.set(key, order.size);
  }));
  const rank = (r: { system_url: string; code: string }) => order.get(`${r.system_url}|${r.code}`) ?? Number.MAX_SAFE_INTEGER;
  const expansion = rows
    .map((r) => ({ system_url: r.system_url as string, code: r.code as string, display: (r.display as string | null) ?? null }))
    .sort((a, b) => rank(a) - rank(b) || (a.system_url < b.system_url ? -1 : a.system_url > b.system_url ? 1 : 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((r) => ({ system: r.system_url, code: r.code, display: r.display }));
  const resource = valueSetToFhirResource({
    id: vs.id, url: vs.url, status: vs.status, experimental: vs.experimental, version: vs.version,
    name: vs.name, title: vs.title, description: vs.description, compose: nextCompose,
  }, expansion);
  // Since 130, fhir.fhir_resources is a view. The resource goes in as a new history version, and
  // fhir.fhir_current points at it, as fhir-store.ts writeVersion does, without the change_log row.
  const hi = await db.selectFrom('fhir.resource_history').select(sql<number>`coalesce(max(version), 0)`.as('maxv'))
    .where('resource_type', '=', 'ValueSet').where('id', '=', vs.id).executeTakeFirst();
  const version = Number(hi?.maxv ?? 0) + 1;
  await db.insertInto('fhir.resource_history').values({
    resource_type: 'ValueSet', id: vs.id, version, op: 'upsert', resource: JSON.stringify(resource),
  }).execute();
  await db.insertInto('fhir.fhir_current').values({ resource_type: 'ValueSet', id: vs.id, version, version_id: String(version) })
    .onConflict((oc) => oc.columns(['resource_type', 'id']).doUpdateSet({ version, version_id: String(version), updated_at: sql`now()` }))
    .execute();
  await db.insertInto('terminology_systems').values({ url: vs.url, version: vs.version, kind: 'ValueSet', resource_id: vs.id })
    .onConflict((oc) => oc.column('url').doNothing()).execute();
}

async function linkToSnomed(db: Kysely<any>): Promise<void> {
  for (const s of SPECIMENS) {
    // Any row, active or not, is the lab's choice. A link a person switched off stays off.
    const held = await db.selectFrom('term_mappings').select('id')
      .where('from_system', '=', LOCAL_CS).where('from_code', '=', s.code)
      .where('to_system', '=', SNOMED).executeTakeFirst();
    if (held) continue;
    const id = `${MAPPING_ID_PREFIX}${s.code}`;
    await db.insertInto('term_mappings').values({
      id, from_system: LOCAL_CS, from_code: s.code, to_system: SNOMED, to_code: s.snomed,
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true,
    }).execute();
    await db.deleteFrom('concept_map_elements')
      .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', LOCAL_CS).where('source_code', '=', s.code)
      .where('target_system', '=', SNOMED).where('target_code', '=', s.snomed).execute();
    await db.insertInto('concept_map_elements').values({
      map_url: LOCAL_MAP_URL, source_system: LOCAL_CS, source_code: s.code,
      target_system: SNOMED, target_code: s.snomed, equivalence: 'SAME-AS',
    }).execute();
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  for (const s of NEW_SPECIMENS) {
    await seedDb.insertInto('terminology_concepts').values({ system: LOCAL_CS, code: s.code, display: s.display, status: 'ACTIVE', properties: null })
      .onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }
  await addToValueSet(seedDb);
  await linkToSnomed(seedDb);
}

// down removes only the SNOMED links up wrote, found by their id, and only while they still say what
// up wrote. It leaves the concepts and the value set codes: a lab may have added the same codes
// itself, or used them on tests and orders since, and nothing marks which rows up inserted.
export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  for (const s of SPECIMENS) {
    const id = `${MAPPING_ID_PREFIX}${s.code}`;
    const row = await seedDb.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) continue;
    const unchanged = row.from_system === LOCAL_CS && row.from_code === s.code && row.to_system === SNOMED
      && row.to_code === s.snomed && row.map_type === 'SAME-AS';
    if (!unchanged) continue;
    await seedDb.deleteFrom('term_mappings').where('id', '=', id).execute();
    // Keep the mirror when another active row still makes the same link.
    const other = await seedDb.selectFrom('term_mappings').select('id')
      .where('from_system', '=', LOCAL_CS).where('from_code', '=', s.code)
      .where('to_system', '=', SNOMED).where('to_code', '=', s.snomed).where('is_active', '=', true).executeTakeFirst();
    if (other) continue;
    await seedDb.deleteFrom('concept_map_elements')
      .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', LOCAL_CS).where('source_code', '=', s.code)
      .where('target_system', '=', SNOMED).where('target_code', '=', s.snomed).execute();
  }
}
