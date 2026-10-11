import { describe, it, expect } from 'vitest';
import { LOINC_SYSTEM, RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { isTestMapRelevantRecord, mappingTouchesTestMap, parseMapLevel } from './test-mapping';
import { buildMapping, seedCatalogTest, seedMapping, seedParam, seedResultMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const PARAMS = RESULT_PARAM_SYSTEM;
const NO_RESULTS = { mapped: 0, ambiguous: [], targetMissing: [] };
const cols = (r: Record<string, unknown>) => [r.id, r.level, r.source_system, r.source_code, r.catalog_code, r.catalog_name, r.category, r.loinc];

describe('test mapping: result level rebuild', () => {
  it('publishes a result mapping and the self row of its field', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedResultMapping(internalDb, 'r1', DISA, 'HIVVL', 'VLC');

    const result = await mapping.publish({ apply: true });

    expect(result).toEqual({ ...NO_RESULTS, results: { mapped: 1, ambiguous: [], targetMissing: [] }, selfRows: 1, written: 2 });
    const rows = await externalDb.selectFrom('test_map').selectAll().orderBy('id').execute();
    expect(rows.map(cols)).toEqual([
      [`result|${PARAMS}|VLC`, 'result', PARAMS, 'VLC', 'VLC', 'HIV VL copies', null, '20447-9'],
      [`result|${DISA}|HIVVL`, 'result', DISA, 'HIVVL', 'VLC', 'HIV VL copies', null, '20447-9'],
    ]);
  });

  it('writes a self row for every catalog test and every result field', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { category: 'MOL', loinc: '25836-8' });
    await seedParam(internalDb, 'CD4', 'CD4 count');

    const result = await mapping.publish({ apply: true });

    expect([result.selfRows, result.written]).toEqual([2, 2]);
    const rows = await externalDb.selectFrom('test_map').selectAll().orderBy('id').execute();
    expect(rows.map(cols)).toEqual([
      [`result|${PARAMS}|CD4`, 'result', PARAMS, 'CD4', 'CD4', 'CD4 count', null, null],
      [`test|${TEST_CATALOG_SYSTEM}|VL`, 'test', TEST_CATALOG_SYSTEM, 'VL', 'VL', 'HIV viral load', 'MOL', '25836-8'],
    ]);
  });

  it('reports ambiguous result codes and missing fields, and leaves both out', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedParam(internalDb, 'VLL', 'HIV VL log');
    await seedResultMapping(internalDb, 'r1', DISA, 'HIVVL', 'VLC');
    await seedResultMapping(internalDb, 'r2', DISA, 'HIVVL', 'VLL', { mapType: 'NARROWER-THAN' });
    await seedResultMapping(internalDb, 'r3', DISA, 'OLD', 'GONE');

    const result = await mapping.publish({ apply: true });

    expect(result.results).toEqual({
      mapped: 0,
      ambiguous: [{ system: DISA, code: 'HIVVL', catalogCodes: ['VLC', 'VLL'] }],
      targetMissing: [{ system: DISA, code: 'OLD', catalogCode: 'GONE' }],
    });
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toEqual([]);
  });

  // Review focus 1.
  it('ignores a mapping from the target system to itself, so it cannot collide with the self row', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedResultMapping(internalDb, 'bad1', PARAMS, 'VLC', 'VLC');
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'bad2', TEST_CATALOG_SYSTEM, 'VL', 'VL');

    const outcome = await mapping.rebuildNow();

    expect(outcome).toMatchObject({ ok: true, result: { written: 2, selfRows: 2 } });
  });

  // Review focus 2.
  it('writes test rows only when no dictionary is loaded', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const result = await mapping.publish({ apply: true });
    expect([result.results, result.selfRows, result.written]).toEqual([NO_RESULTS, 1, 1]);
  });

  it('writes a large dictionary in chunks', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    for (let i = 0; i < 450; i++) await seedParam(internalDb, `P${String(i).padStart(3, '0')}`, `Field ${i}`);
    expect((await mapping.publish({ apply: true })).written).toBe(450);
    const count = await externalDb.selectFrom('test_map').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(450);
  });
});

describe('rebuild triggers', () => {
  it('count a mapping into or out of the dictionary, and a dictionary sync', () => {
    expect(mappingTouchesTestMap(DISA, PARAMS)).toBe(true);
    expect(mappingTouchesTestMap(PARAMS, LOINC_SYSTEM)).toBe(true);
    expect(mappingTouchesTestMap(DISA, 'urn:openldr:other')).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: PARAMS } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: 'urn:openldr:other' } })).toBe(false);
  });
});

describe('parseMapLevel', () => {
  it('defaults to test and refuses anything but test or result', () => {
    expect(parseMapLevel(undefined)).toEqual({ ok: true, level: 'test' });
    expect(parseMapLevel('')).toEqual({ ok: true, level: 'test' });
    expect(parseMapLevel('result')).toEqual({ ok: true, level: 'result' });
    expect(parseMapLevel('panel')).toEqual({ ok: false, error: 'level must be test or result' });
  });
});
