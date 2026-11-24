import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb, makeMigratedDbUpTo } from './test-helpers';
import { createFhirStore } from '../../fhir-store';
import { createTerminologyStore } from '../../terminology-store';
import { up, down } from './144_specimen_type_snomed_fix';

const LOCAL = 'urn:openldr:cs:local';
const SNOMED = 'http://snomed.info/sct';
const LOCAL_MAP = 'urn:openldr:terminology:local-map';
const VS_URL = 'urn:openldr:valueset:specimen-type';
const AFTER_143 = ['BLD', 'UR', 'CSF', 'SPT', 'PLAS', 'SER', 'STL', 'PLR', 'ASC', 'SAL', 'WND', 'THRT', 'NASL', 'SYN', 'BM'];
const ALL = [...AFTER_143, 'SERPL'];

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
  const mappings = await db.selectFrom('term_mappings').select(['id', 'to_code', 'map_type', 'is_active'])
    .where('from_system', '=', LOCAL).where('from_code', '=', code).where('to_system', '=', SNOMED).orderBy('id').execute();
  const elements = await db.selectFrom('concept_map_elements').select(['target_code', 'equivalence'])
    .where('map_url', '=', LOCAL_MAP).where('source_system', '=', LOCAL).where('source_code', '=', code).where('target_system', '=', SNOMED)
    .orderBy('target_code').execute();
  return { mappings, elements };
}

async function translate(db: Kysely<any>, code: string): Promise<Array<Array<string | null>>> {
  const store = createTerminologyStore(db, createFhirStore(db));
  const hits = await store.translate({ mapUrl: LOCAL_MAP, system: LOCAL, code, targetSystem: SNOMED });
  return hits.map((h) => [h.targetCode, h.equivalence]);
}

describe('144_specimen_type_snomed_fix', () => {
  it('after 143 and 144, BM translates to 119359002 and SERPL to 122592007', async () => {
    const db = await makeMigratedDb();
    expect(await translate(db, 'BM')).toEqual([['119359002', 'SAME-AS']]);
    expect(await translate(db, 'SERPL')).toEqual([['122592007', 'SAME-AS']]);
    expect(await snomedLinks(db, 'BM')).toEqual({
      mappings: [{ id: 'tm-m143-BM', to_code: '119359002', map_type: 'SAME-AS', is_active: true }],
      elements: [{ target_code: '119359002', equivalence: 'SAME-AS' }],
    });
    expect((await snomedLinks(db, 'SERPL')).mappings).toEqual([{ id: 'tm-m144-SERPL', to_code: '122592007', map_type: 'SAME-AS', is_active: true }]);

    const serpl = await db.selectFrom('terminology_concepts').select(['display', 'status']).where('system', '=', LOCAL).where('code', '=', 'SERPL').executeTakeFirst();
    expect(serpl).toEqual({ display: 'Serum or plasma', status: 'ACTIVE' });
    expect(await expansionCodes(db)).toEqual([...ALL].sort());
    expect(await composeCodes(db)).toEqual([...ALL].sort());
    const res = await db.selectFrom('fhir.fhir_resources').select('resource').where('resource_type', '=', 'ValueSet').where('id', '=', await vsId(db)).executeTakeFirstOrThrow();
    const resource = typeof res.resource === 'string' ? JSON.parse(res.resource) : res.resource;
    expect(resource.expansion.total).toBe(16);
    expect(resource.expansion.contains.at(-1)).toMatchObject({ system: LOCAL, code: 'SERPL', display: 'Serum or plasma' });
  });

  it('changes nothing when it runs twice', async () => {
    const db = await makeMigratedDb();
    await up(db);
    expect(await expansionCodes(db)).toEqual([...ALL].sort());
    expect(await composeCodes(db)).toEqual([...ALL].sort());
    for (const code of ALL) {
      const { mappings, elements } = await snomedLinks(db, code);
      expect(mappings).toHaveLength(1);
      expect(elements).toHaveLength(1);
    }
    expect(await translate(db, 'BM')).toEqual([['119359002', 'SAME-AS']]);
  });

  it('leaves a BM link the lab edited as it is', async () => {
    const db = await makeMigratedDbUpTo('143_specimen_types_snomed');
    // A person gave 143's BM row a display on the Terminology page. It is no longer the row 143 wrote.
    await db.updateTable('term_mappings').set({ to_display: 'Kept by the lab' }).where('id', '=', 'tm-m143-BM').execute();
    await up(db);
    expect(await snomedLinks(db, 'BM')).toEqual({
      mappings: [{ id: 'tm-m143-BM', to_code: '122592007', map_type: 'SAME-AS', is_active: true }],
      elements: [{ target_code: '122592007', equivalence: 'SAME-AS' }],
    });
  });

  it('leaves a BM link the lab switched off, and one the lab made itself', async () => {
    const off = await makeMigratedDbUpTo('143_specimen_types_snomed');
    await off.updateTable('term_mappings').set({ is_active: false }).where('id', '=', 'tm-m143-BM').execute();
    await up(off);
    expect((await snomedLinks(off, 'BM')).mappings).toEqual([{ id: 'tm-m143-BM', to_code: '122592007', map_type: 'SAME-AS', is_active: false }]);

    const own = await makeMigratedDbUpTo('142_plugin_permission_groups');
    await own.insertInto('term_mappings').values({
      id: 'tm-lab-bm', from_system: LOCAL, from_code: 'BM', to_system: SNOMED, to_code: '122592007',
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: true,
    }).execute();
    await own.insertInto('concept_map_elements').values({
      map_url: LOCAL_MAP, source_system: LOCAL, source_code: 'BM', target_system: SNOMED, target_code: '122592007', equivalence: 'SAME-AS',
    }).execute();
    const m143 = await import('./143_specimen_types_snomed');
    await m143.up(own);
    await up(own);
    expect(await snomedLinks(own, 'BM')).toEqual({
      mappings: [{ id: 'tm-lab-bm', to_code: '122592007', map_type: 'SAME-AS', is_active: true }],
      elements: [{ target_code: '122592007', equivalence: 'SAME-AS' }],
    });
  });

  it('keeps a SERPL link the lab already made, active or not, and adds none beside it', async () => {
    const db = await makeMigratedDbUpTo('143_specimen_types_snomed');
    await db.insertInto('term_mappings').values({
      id: 'tm-lab-serpl', from_system: LOCAL, from_code: 'SERPL', to_system: SNOMED, to_code: '122592007',
      to_display: null, map_type: 'SAME-AS', relationship: null, owner: null, is_active: false,
    }).execute();
    await up(db);
    expect(await snomedLinks(db, 'SERPL')).toEqual({
      mappings: [{ id: 'tm-lab-serpl', to_code: '122592007', map_type: 'SAME-AS', is_active: false }],
      elements: [],
    });
  });

  it('does not add SERPL back when the lab excluded it', async () => {
    const db = await makeMigratedDbUpTo('143_specimen_types_snomed');
    const id = await vsId(db);
    const row = await db.selectFrom('value_sets').select('compose').where('id', '=', id).executeTakeFirstOrThrow();
    const compose = typeof row.compose === 'string' ? JSON.parse(row.compose) : row.compose;
    compose.exclude = [{ system: LOCAL, concept: [{ code: 'SERPL' }] }];
    await db.updateTable('value_sets').set({ compose: JSON.stringify(compose) as never }).where('id', '=', id).execute();
    await up(db);
    expect(await composeCodes(db)).toEqual([...AFTER_143].sort());
    expect(await expansionCodes(db)).toEqual([...AFTER_143].sort());
  });

  it('does not fail when the value set is gone, and still fixes the links', async () => {
    const db = await makeMigratedDbUpTo('143_specimen_types_snomed');
    await db.deleteFrom('value_sets').where('url', '=', VS_URL).execute();
    await expect(up(db)).resolves.toBeUndefined();
    expect(await db.selectFrom('value_sets').select('id').where('url', '=', VS_URL).execute()).toEqual([]);
    expect(await translate(db, 'BM')).toEqual([['119359002', 'SAME-AS']]);
    expect(await translate(db, 'SERPL')).toEqual([['122592007', 'SAME-AS']]);
  });

  it('down puts BM back and removes SERPL\'s link, and only what it wrote', async () => {
    const db = await makeMigratedDb();
    await down(db);
    expect(await snomedLinks(db, 'BM')).toEqual({
      mappings: [{ id: 'tm-m143-BM', to_code: '122592007', map_type: 'SAME-AS', is_active: true }],
      elements: [{ target_code: '122592007', equivalence: 'SAME-AS' }],
    });
    expect(await snomedLinks(db, 'SERPL')).toEqual({ mappings: [], elements: [] });

    // A link a person changed after 144 stays as it is.
    const edited = await makeMigratedDb();
    await edited.updateTable('term_mappings').set({ to_code: '999' }).where('id', '=', 'tm-m144-SERPL').execute();
    await edited.updateTable('term_mappings').set({ to_display: 'Kept' }).where('id', '=', 'tm-m143-BM').execute();
    await down(edited);
    expect((await snomedLinks(edited, 'SERPL')).mappings).toEqual([{ id: 'tm-m144-SERPL', to_code: '999', map_type: 'SAME-AS', is_active: true }]);
    expect((await snomedLinks(edited, 'BM')).mappings).toEqual([{ id: 'tm-m143-BM', to_code: '119359002', map_type: 'SAME-AS', is_active: true }]);
  });

  it('down keeps a SERPL link the lab switched off or edited', async () => {
    const off = await makeMigratedDb();
    await off.updateTable('term_mappings').set({ is_active: false }).where('id', '=', 'tm-m144-SERPL').execute();
    await down(off);
    expect((await snomedLinks(off, 'SERPL')).mappings).toEqual([{ id: 'tm-m144-SERPL', to_code: '122592007', map_type: 'SAME-AS', is_active: false }]);

    const edited = await makeMigratedDb();
    await edited.updateTable('term_mappings').set({ to_display: 'Kept by the lab' }).where('id', '=', 'tm-m144-SERPL').execute();
    await down(edited);
    expect(await snomedLinks(edited, 'SERPL')).toEqual({
      mappings: [{ id: 'tm-m144-SERPL', to_code: '122592007', map_type: 'SAME-AS', is_active: true }],
      elements: [{ target_code: '122592007', equivalence: 'SAME-AS' }],
    });
  });
});
