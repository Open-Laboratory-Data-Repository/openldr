import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb, makeMigratedDbUpTo } from './test-helpers';
import { createFhirStore } from '../../fhir-store';
import { createTerminologyStore } from '../../terminology-store';
import { up, down } from './143_specimen_types_snomed';

const LOCAL = 'urn:openldr:cs:local';
const SNOMED = 'http://snomed.info/sct';
const LOCAL_MAP = 'urn:openldr:terminology:local-map';
const VS_URL = 'urn:openldr:valueset:specimen-type';
const ALL = ['BLD', 'UR', 'CSF', 'SPT', 'PLAS', 'SER', 'STL', 'PLR', 'ASC', 'SAL', 'WND', 'THRT', 'NASL', 'SYN', 'BM'];

async function vsId(db: Kysely<any>): Promise<string> {
  const row = await db.selectFrom('value_sets').select('id').where('url', '=', VS_URL).executeTakeFirstOrThrow();
  return row.id as string;
}

async function expansionCodes(db: Kysely<any>): Promise<string[]> {
  const rows = await db.selectFrom('valueset_expansions').select('code').where('value_set_id', '=', await vsId(db)).execute();
  return rows.map((r) => r.code as string).sort();
}

async function composeCodes(db: Kysely<any>): Promise<string[]> {
  const row = await db.selectFrom('value_sets').select('compose').where('url', '=', VS_URL).executeTakeFirstOrThrow();
  const compose = typeof row.compose === 'string' ? JSON.parse(row.compose) : row.compose;
  return (compose.include ?? []).filter((i: any) => i.system === LOCAL).flatMap((i: any) => (i.concept ?? []).map((c: any) => c.code)).sort();
}

async function snomedLinks(db: Kysely<any>, code: string) {
  const mappings = await db.selectFrom('term_mappings').select(['to_code', 'map_type', 'is_active'])
    .where('from_system', '=', LOCAL).where('from_code', '=', code).where('to_system', '=', SNOMED).execute();
  const elements = await db.selectFrom('concept_map_elements').select(['target_code', 'equivalence'])
    .where('map_url', '=', LOCAL_MAP).where('source_system', '=', LOCAL).where('source_code', '=', code).where('target_system', '=', SNOMED).execute();
  return { mappings, elements };
}

describe('143_specimen_types_snomed', () => {
  it('gives the specimen value set 15 codes, and the local map translates SER to SNOMED 119364003', async () => {
    const db = await makeMigratedDb();
    expect(await expansionCodes(db)).toEqual([...ALL].sort());
    expect(await composeCodes(db)).toEqual([...ALL].sort());

    const res = await db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'ValueSet').where('id', '=', await vsId(db)).executeTakeFirstOrThrow();
    const resource = typeof res.resource === 'string' ? JSON.parse(res.resource) : res.resource;
    expect(resource.expansion.total).toBe(15);
    expect(resource.status).toBe('draft');

    const store = createTerminologyStore(db, createFhirStore(db));
    const hits = await store.translate({ mapUrl: LOCAL_MAP, system: LOCAL, code: 'SER', targetSystem: SNOMED });
    expect(hits.map((h) => [h.targetCode, h.equivalence])).toEqual([['119364003', 'SAME-AS']]);

    const ser = await db.selectFrom('terminology_concepts').select(['display', 'status']).where('system', '=', LOCAL).where('code', '=', 'SER').executeTakeFirst();
    expect(ser).toEqual({ display: 'Serum', status: 'ACTIVE' });
  });

  it('leaves 15 codes and one link per code when it runs twice', async () => {
    const db = await makeMigratedDb();
    await up(db);
    expect(await expansionCodes(db)).toEqual([...ALL].sort());
    expect(await composeCodes(db)).toEqual([...ALL].sort());
    for (const code of ALL) {
      const { mappings, elements } = await snomedLinks(db, code);
      expect(mappings).toHaveLength(1);
      expect(elements).toHaveLength(1);
    }
  });

  it('keeps a lab\'s own choices: BLD stays out of the set, UR keeps its own SNOMED link', async () => {
    const db = await makeMigratedDbUpTo('142_plugin_permission_groups');
    const id = await vsId(db);
    const compose = { include: [{ system: LOCAL, concept: [{ code: 'UR', display: 'Urine' }, { code: 'CSF', display: 'CSF' }, { code: 'SPT', display: 'Sputum' }] }] };
    await db.updateTable('value_sets').set({ compose: JSON.stringify(compose) as never, status: 'active' }).where('id', '=', id).execute();
    await db.deleteFrom('valueset_expansions').where('value_set_id', '=', id).where('code', '=', 'BLD').execute();
    await db.insertInto('term_mappings').values({
      id: 'tm-lab-ur', from_system: LOCAL, from_code: 'UR', to_system: SNOMED, to_code: '78014005',
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true,
    }).execute();
    await db.insertInto('concept_map_elements').values({
      map_url: LOCAL_MAP, source_system: LOCAL, source_code: 'UR', target_system: SNOMED, target_code: '78014005', equivalence: 'SAME-AS',
    }).execute();

    await up(db);

    const withoutBld = ALL.filter((c) => c !== 'BLD').sort();
    expect(await composeCodes(db)).toEqual(withoutBld);
    expect(await expansionCodes(db)).toEqual(withoutBld);
    const vs = await db.selectFrom('value_sets').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(vs.status).toBe('active');

    const ur = await snomedLinks(db, 'UR');
    expect(ur.mappings).toEqual([{ to_code: '78014005', map_type: 'SAME-AS', is_active: true }]);
    expect(ur.elements).toEqual([{ target_code: '78014005', equivalence: 'SAME-AS' }]);
    // BLD is out of the set, but its concept still gets its link.
    expect((await snomedLinks(db, 'BLD')).mappings).toEqual([{ to_code: '119297000', map_type: 'SAME-AS', is_active: true }]);
  });

  it('adds no expansion rows and does not fail when the value set is gone', async () => {
    const db = await makeMigratedDbUpTo('142_plugin_permission_groups');
    await db.deleteFrom('value_sets').where('url', '=', VS_URL).execute();
    await expect(up(db)).resolves.toBeUndefined();
    const rows = await db.selectFrom('valueset_expansions').select('code').where('value_set_id', '=', 'vs-seed-specimen-type').execute();
    expect(rows).toEqual([]);
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', VS_URL).execute()).toEqual([]);
  });

  it('down removes only the links it wrote that nobody has changed', async () => {
    const db = await makeMigratedDb();
    // A person repoints SER's link. down must leave it.
    await db.updateTable('term_mappings').set({ to_code: '999' }).where('from_code', '=', 'SER').where('to_system', '=', SNOMED).execute();
    await down(db);
    expect((await snomedLinks(db, 'PLAS')).mappings).toEqual([]);
    expect((await snomedLinks(db, 'PLAS')).elements).toEqual([]);
    expect((await snomedLinks(db, 'SER')).mappings).toEqual([{ to_code: '999', map_type: 'SAME-AS', is_active: true }]);
  });
});
