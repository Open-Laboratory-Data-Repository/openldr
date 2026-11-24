import { type Kysely, sql } from 'kysely';
import { valueSetToFhirResource } from '../../fhir-value-set';
import type { VsCompose, VsInclude } from '../../value-set-expander';

// Fixes a wrong SNOMED link from 143. Checked on 2026-11-24 against the operator's loaded SNOMED:
// 122592007 is "Acellular blood (serum or plasma) specimen", and Bone marrow specimen is 119359002.
// 143 (copied from Corlix) linked local BM to 122592007, so every serum or plasma test suggested Bone
// marrow.
//
// 1. BM's link moves to 119359002, but only while it is still the row 143 wrote: its id, still pointing
//    at 122592007, still active and otherwise unchanged. Its concept_map_elements mirror moves with it.
//    A link a person made or changed is left alone.
// 2. A local specimen type SERPL "Serum or plasma" is added, and the specimen value set gains it as 143
//    adds codes. It gets a SAME-AS link to 122592007, written as 143 writes one, unless SERPL already
//    has any SNOMED link, active or switched off.
//
// Like 143, this writes no fhir.change_log row, so the value set change does not sync.
// Values are inlined, not imported: a migration is a frozen record of one release (see 078).
const LOCAL_CS = 'urn:openldr:cs:local';
const SNOMED = 'http://snomed.info/sct';
const LOCAL_MAP_URL = 'urn:openldr:terminology:local-map';
const SPECIMEN_VALUE_SET = 'urn:openldr:valueset:specimen-type';

/** The row 143 wrote for BM, what it says, and where 144 moves it. */
const BM = { id: 'tm-m143-BM', code: 'BM', wrong: '122592007', right: '119359002' };
/** term_mappings ids this migration writes. down() uses them to find its own rows. */
const MAPPING_ID_PREFIX = 'tm-m144-';
const SPECIMENS: Array<{ code: string; display: string; snomed: string }> = [
  { code: 'SERPL', display: 'Serum or plasma', snomed: '122592007' },
];

function parse<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** True when the row still says what `toCode` and the rest of a seeded SAME-AS link say. */
function isSeededLink(row: Record<string, unknown> | undefined, code: string, toCode: string): boolean {
  return !!row && row.from_system === LOCAL_CS && row.from_code === code && row.to_system === SNOMED
    && row.to_code === toCode && row.map_type === 'SAME-AS' && row.is_active === true
    && row.to_display === null && row.relationship === null && row.owner === null;
}

/** Point the mirror of `code`'s link at `to` instead of `from`. The old mirror stays while another
 *  active row still makes that link. */
async function moveMirror(db: Kysely<any>, code: string, from: string, to: string): Promise<void> {
  const other = await db.selectFrom('term_mappings').select('id')
    .where('from_system', '=', LOCAL_CS).where('from_code', '=', code)
    .where('to_system', '=', SNOMED).where('to_code', '=', from).where('is_active', '=', true).executeTakeFirst();
  if (!other) {
    await db.deleteFrom('concept_map_elements')
      .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', LOCAL_CS).where('source_code', '=', code)
      .where('target_system', '=', SNOMED).where('target_code', '=', from).execute();
  }
  await db.deleteFrom('concept_map_elements')
    .where('map_url', '=', LOCAL_MAP_URL).where('source_system', '=', LOCAL_CS).where('source_code', '=', code)
    .where('target_system', '=', SNOMED).where('target_code', '=', to).execute();
  await db.insertInto('concept_map_elements').values({
    map_url: LOCAL_MAP_URL, source_system: LOCAL_CS, source_code: code,
    target_system: SNOMED, target_code: to, equivalence: 'SAME-AS',
  }).execute();
}

async function relinkBoneMarrow(db: Kysely<any>): Promise<void> {
  const row = await db.selectFrom('term_mappings').selectAll().where('id', '=', BM.id).executeTakeFirst();
  if (!isSeededLink(row, BM.code, BM.wrong)) return;
  await db.updateTable('term_mappings').set({ to_code: BM.right, updated_at: sql`now()` }).where('id', '=', BM.id).execute();
  await moveMirror(db, BM.code, BM.wrong, BM.right);
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
  const missing = SPECIMENS.filter((s) => !present.has(s.code));
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
  await relinkBoneMarrow(seedDb);
  for (const s of SPECIMENS) {
    await seedDb.insertInto('terminology_concepts').values({ system: LOCAL_CS, code: s.code, display: s.display, status: 'ACTIVE', properties: null })
      .onConflict((oc) => oc.columns(['system', 'code']).doNothing()).execute();
  }
  await addToValueSet(seedDb);
  await linkToSnomed(seedDb);
}

// down undoes only what up wrote, found by id, and only while it still says what up wrote. BM's row
// goes back to 122592007. SERPL's link is removed while it is still active and unchanged. As in 143,
// the concept and the value set code stay:
// a lab may have used SERPL on tests and orders since, and nothing marks which rows up inserted.
export async function down(db: Kysely<unknown>): Promise<void> {
  const seedDb = db as Kysely<any>;
  const bm = await seedDb.selectFrom('term_mappings').selectAll().where('id', '=', BM.id).executeTakeFirst();
  if (isSeededLink(bm, BM.code, BM.right)) {
    await seedDb.updateTable('term_mappings').set({ to_code: BM.wrong, updated_at: sql`now()` }).where('id', '=', BM.id).execute();
    await moveMirror(seedDb, BM.code, BM.right, BM.wrong);
  }

  for (const s of SPECIMENS) {
    const id = `${MAPPING_ID_PREFIX}${s.code}`;
    const row = await seedDb.selectFrom('term_mappings').selectAll().where('id', '=', id).executeTakeFirst();
    // A row the lab switched off or edited is the lab's now, so it stays.
    if (!isSeededLink(row, s.code, s.snomed)) continue;
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
