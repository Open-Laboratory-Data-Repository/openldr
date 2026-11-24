import { describe, it, expect } from 'vitest';
import { parseObservedQuery } from './test-mapping';
import { TEST_CATALOG_SYSTEM, TEST_CODE_SYSTEM } from './test-catalog';
import { buildMapping, seedCatalogTest, seedMapping, seedRequest } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const NO_RESULTS = { mapped: 0, ambiguous: [], targetMissing: [] };

describe('test mapping: read side and rebuild', () => {
  it('publishes one test_map row per mapped code, with the catalog name, category and LOINC', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { category: 'MOL', loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'POCVR', 'VL');

    const result = await mapping.publish({ apply: true });

    expect(result).toEqual({ mapped: 2, ambiguous: [], targetMissing: [], results: NO_RESULTS, selfRows: 2, written: 4 });
    const rows = await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).orderBy('source_code').execute();
    expect(rows.map((r) => [r.id, r.level, r.source_system, r.source_code, r.catalog_code, r.catalog_name, r.category, r.loinc])).toEqual([
      [`test|${DISA}|HIVVL`, 'test', DISA, 'HIVVL', 'VL', 'HIV viral load', 'MOL', '25836-8'],
      [`test|${DISA}|POCVR`, 'test', DISA, 'POCVR', 'VL', 'HIV viral load', 'MOL', '25836-8'],
    ]);
  });

  it('publishes the Test code as catalog_code, never the id, and stores the id in the mapping', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'tst-0a1b2c3d4e5f6a7b', 'HIV viral load', { loinc: '25836-8', testCode: 'VL' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'tst-0a1b2c3d4e5f6a7b');

    await mapping.publish({ apply: true });

    const rows = await externalDb.selectFrom('test_map').select(['source_system', 'source_code', 'catalog_code', 'loinc'])
      .orderBy('source_system').orderBy('source_code').execute();
    expect(rows).toEqual([
      // Orders saved before Test codes carry the id in the catalog system, so that self row stays.
      { source_system: TEST_CATALOG_SYSTEM, source_code: 'tst-0a1b2c3d4e5f6a7b', catalog_code: 'VL', loinc: '25836-8' },
      // New orders lead with the Test code when the test has no LOINC link.
      { source_system: TEST_CODE_SYSTEM, source_code: 'VL', catalog_code: 'VL', loinc: '25836-8' },
      { source_system: DISA, source_code: 'HIVVL', catalog_code: 'VL', loinc: '25836-8' },
    ]);
  });

  it('joins a new order that leads with the Test code, and an order saved before, to the same test', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count', { testCode: 'CD4C' });
    await seedRequest(externalDb, 'r-old', TEST_CATALOG_SYSTEM, 'CD4', 'CD4 count', '2026-11-01');
    await seedRequest(externalDb, 'r-new', TEST_CODE_SYSTEM, 'CD4C', 'CD4 count', '2026-11-24');
    await mapping.publish({ apply: true });

    const joined = await externalDb.selectFrom('lab_requests as lr')
      .innerJoin('test_map as tm', (j) => j.on('tm.level', '=', 'test').onRef('tm.source_system', '=', 'lr.panel_system').onRef('tm.source_code', '=', 'lr.panel_code'))
      .select(['lr.id', 'tm.catalog_code']).orderBy('lr.id').execute();
    expect(joined).toEqual([{ id: 'r-new', catalog_code: 'CD4C' }, { id: 'r-old', catalog_code: 'CD4C' }]);
    // CE's own orders are not lab codes to map.
    expect((await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 })).rows).toEqual([]);
  });

  it('names a mapped target by id and Test code in the Observed list and the target list', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'tst-0a1b2c3d4e5f6a7b', 'HIV viral load', { loinc: '25836-8', testCode: 'VL' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'tst-0a1b2c3d4e5f6a7b');

    const { rows } = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });
    expect(rows.map((r) => r.catalog)).toEqual([{ code: 'tst-0a1b2c3d4e5f6a7b', testCode: 'VL', name: 'HIV viral load', loinc: '25836-8' }]);
    expect(await mapping.targets()).toEqual([{ code: 'tst-0a1b2c3d4e5f6a7b', testCode: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false }]);
  });

  it('ignores a mapping from the Test code system, so it cannot collide with the self row', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'bad', TEST_CODE_SYSTEM, 'VL', 'VL');

    expect(await mapping.rebuildNow()).toMatchObject({ ok: true, result: { mapped: 0, selfRows: 2, written: 2 } });
  });

  it('leaves out an ambiguous code and a code whose catalog test is gone, and reports both', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'EID', { mapType: 'NARROWER-THAN' });
    await seedMapping(internalDb, 'm3', DISA, 'OLD', 'GONE');

    const result = await mapping.publish({ apply: true });

    expect(result.ambiguous).toEqual([{ system: DISA, code: 'HIVVL', catalogCodes: ['EID', 'VL'] }]);
    expect(result.targetMissing).toEqual([{ system: DISA, code: 'OLD', catalogCode: 'GONE' }]);
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toEqual([]);
  });

  it('maps to a retired catalog test, because old results still belong to it', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { status: 'DEPRECATED' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    expect((await mapping.publish({ apply: true })).mapped).toBe(1);
  });

  it('counts two rows naming the same target once, not as ambiguous', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'VL', { mapType: 'RELATED-TO' });
    expect((await mapping.publish({ apply: true })).ambiguous).toEqual([]);
  });

  it('lets central win over a lab row for the same code', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'lab1', DISA, 'HIVVL', 'EID');
    await seedMapping(internalDb, 'central1', DISA, 'HIVVL', 'VL', { central: true });

    const result = await mapping.publish({ apply: true });

    expect(result.ambiguous).toEqual([]);
    expect(result.mapped).toBe(1);
    expect((await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code']).where('source_system', '=', DISA).execute())).toEqual([{ source_code: 'HIVVL', catalog_code: 'VL' }]);
    const row = (await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 })).rows.find((r) => r.code === 'HIVVL')!;
    expect(row.status).toBe('mapped');
    expect(row.catalog?.code).toBe('VL');
    expect(row.centralManaged).toBe(true);
  });

  it('still calls a code ambiguous when two central rows name different tests', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'c1', DISA, 'HIVVL', 'VL', { central: true });
    await seedMapping(internalDb, 'c2', DISA, 'HIVVL', 'EID', { central: true });
    await seedMapping(internalDb, 'lab1', DISA, 'HIVVL', 'VL');

    const result = await mapping.publish({ apply: false });

    expect(result.ambiguous).toEqual([{ system: DISA, code: 'HIVVL', catalogCodes: ['EID', 'VL'] }]);
    expect(result.mapped).toBe(0);
  });

  it('ignores inactive mappings', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { active: false });
    expect((await mapping.publish({ apply: true })).mapped).toBe(0);
  });

  it('replaces every test-level row on each rebuild and writes nothing without apply', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await mapping.publish({ apply: true });
    await internalDb.updateTable('term_mappings').set({ is_active: false }).where('id', '=', 'm1').execute();

    expect((await mapping.publish({ apply: false })).mapped).toBe(0);
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toHaveLength(1);
    await mapping.publish({ apply: true });
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toHaveLength(0);
  });

  it('lists observed codes with counts, newest date and status, ordered by system then code', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', 'HIV Viral Load', '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'HIVVL', 'HIV Viral Load', '2026-05-03T08:00:00Z');
    await seedRequest(externalDb, 'r3', DISA, 'CD4', 'CD4 count', '2026-05-02T08:00:00Z');

    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });

    expect(out.total).toBe(2);
    expect(out.rows.map((r) => [r.code, r.requests, r.status, r.catalog?.code ?? null, r.catalog?.loinc ?? null, r.centralManaged])).toEqual([
      ['CD4', 1, 'unmapped', null, null, false],
      ['HIVVL', 2, 'mapped', 'VL', '25836-8', true],
    ]);
    expect(out.rows[1].lastSeen?.startsWith('2026-05-03')).toBe(true);
    expect(out.warehouse).toEqual({ stale: false, error: null });
  });

  // Review focus 2.
  it('lists a mapped code the warehouse has not seen yet, with 0 requests', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'POHVL', 'VL');
    const out = await mapping.observed({ status: 'mapped', q: '', limit: 25, offset: 0 });
    expect(out.rows.map((r) => [r.code, r.requests, r.lastSeen])).toEqual([['POHVL', 0, null]]);
  });

  // Review focus 3.
  it('reads the warehouse scan once a minute, and the mappings fresh each time', async () => {
    let clock = 1_000_000;
    const { internalDb, externalDb, mapping, counter } = await buildMapping({ now: () => clock });
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', 'HIV VL', '2026-01-01T00:00:00Z');
    const query = { status: 'all' as const, q: '', limit: 25, offset: 0 };

    const first = await mapping.observed(query);
    expect(first.rows.map((r) => r.status)).toEqual(['unmapped']);
    expect(counter.groupQueries).toBe(1);

    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    clock += 59_000;
    expect((await mapping.observed(query)).rows.map((r) => r.status)).toEqual(['mapped']);
    expect(counter.groupQueries).toBe(1);

    clock += 2_000;
    await mapping.observed(query);
    expect(counter.groupQueries).toBe(2);
  });

  it('leaves out warehouse rows with no code system or no code', async () => {
    const { externalDb, mapping } = await buildMapping();
    await seedRequest(externalDb, 'r1', null, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, null, null, '2026-05-01T08:00:00Z');
    expect((await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 })).total).toBe(0);
  });

  it('matches codes exactly: a trailing space is a different code', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL ', null, '2026-05-01T08:00:00Z');
    const out = await mapping.observed({ status: 'unmapped', q: '', limit: 25, offset: 0 });
    expect(out.rows.map((r) => r.code)).toEqual(['HIVVL ']);
  });

  it('filters by status and searches code, description and catalog name', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', null, '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'CD4', 'CD4 count', '2026-05-01T08:00:00Z');
    expect((await mapping.observed({ status: 'unmapped', q: '', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['CD4']);
    expect((await mapping.observed({ status: 'all', q: 'viral', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['HIVVL']);
    expect((await mapping.observed({ status: 'all', q: 'cd4 COUNT', limit: 25, offset: 0 })).rows.map((r) => r.code)).toEqual(['CD4']);
  });

  it('pages after sorting', async () => {
    const { externalDb, mapping } = await buildMapping();
    for (const c of ['C', 'A', 'B']) await seedRequest(externalDb, `r${c}`, DISA, c, null, '2026-05-01T08:00:00Z');
    const page = await mapping.observed({ status: 'all', q: '', limit: 2, offset: 1 });
    expect([page.total, page.rows.map((r) => r.code)]).toEqual([3, ['B', 'C']]);
  });

  it('lists catalog targets with their LOINC, sorted by code', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count', { status: 'DEPRECATED' });
    expect(await mapping.targets()).toEqual([
      { code: 'CD4', testCode: 'CD4', name: 'CD4 count', loinc: null, retired: true },
      { code: 'VL', testCode: 'VL', name: 'HIV viral load', loinc: '25836-8', retired: false },
    ]);
  });

  it('rebuildNow records a failure, warns, and the next observed read reports the copy stale', async () => {
    const { internalDb, externalDb, mapping, warnings } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await externalDb.schema.dropTable('test_map').execute();

    const outcome = await mapping.rebuildNow();

    expect(outcome.ok).toBe(false);
    expect(warnings).toEqual(['test_map rebuild failed']);
    const out = await mapping.observed({ status: 'all', q: '', limit: 25, offset: 0 });
    expect(out.warehouse.stale).toBe(true);
    expect(out.warehouse.error).not.toBeNull();
  });
});

describe('parseObservedQuery', () => {
  it('defaults to all, no search, 25 rows from 0', () => {
    expect(parseObservedQuery({})).toEqual({ ok: true, query: { status: 'all', q: '', limit: 25, offset: 0 } });
  });
  it('refuses an unknown status and a limit out of range', () => {
    expect(parseObservedQuery({ status: 'gone' })).toEqual({ ok: false, error: 'status must be unmapped, mapped, ambiguous or all' });
    expect(parseObservedQuery({ limit: '0' })).toEqual({ ok: false, error: 'limit must be a whole number from 1 to 200' });
    expect(parseObservedQuery({ offset: '-1' })).toEqual({ ok: false, error: 'offset must be a whole number from 0' });
  });
});
