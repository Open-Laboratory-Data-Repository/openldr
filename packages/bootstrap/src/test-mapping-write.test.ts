import { describe, it, expect } from 'vitest';
import { TEST_CATALOG_SYSTEM, TestCatalogError } from './test-catalog';
import { createCoalescedRunner, isTestMapRelevantRecord, mappingTouchesTestMap } from './test-mapping';
import { buildMapping, seedCatalogTest, seedMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';

async function active(db: Awaited<ReturnType<typeof buildMapping>>['internalDb'], code: string) {
  return db.selectFrom('term_mappings').select(['to_code', 'map_type'])
    .where('from_system', '=', DISA).where('from_code', '=', code)
    .where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute();
}

describe('test mapping: writes', () => {
  it('set writes one SAME-AS mapping, rebuilds, and reports before and after', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');

    const change = await mapping.set(DISA, 'HIVVL', 'VL');

    expect([change.before, change.after, change.rebuild.ok]).toEqual([null, 'VL', true]);
    expect(await active(internalDb, 'HIVVL')).toEqual([{ to_code: 'VL', map_type: 'SAME-AS' }]);
    expect(await externalDb.selectFrom('test_map').select('source_code').execute()).toEqual([{ source_code: 'HIVVL' }]);
  });

  it('set replaces the earlier target and deactivates any other active mapping, whatever its type', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'EID', 'Early infant diagnosis');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'EID');
    await seedMapping(internalDb, 'm2', DISA, 'HIVVL', 'EID', { mapType: 'NARROWER-THAN' });

    const change = await mapping.set(DISA, 'HIVVL', 'VL');

    expect(change.before).toBe('EID');
    expect(await active(internalDb, 'HIVVL')).toEqual([{ to_code: 'VL', map_type: 'SAME-AS' }]);
  });

  it('set refuses an unknown catalog code as invalid', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(DISA, 'HIVVL', 'NOPE')).rejects.toMatchObject({ kind: 'invalid', message: 'no catalog test has code NOPE' });
  });

  it('set and clear refuse a mapping central sent down', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });
    await expect(mapping.set(DISA, 'HIVVL', 'VL')).rejects.toBeInstanceOf(TestCatalogError);
    await expect(mapping.set(DISA, 'HIVVL', 'VL')).rejects.toMatchObject({ kind: 'central-managed' });
    await expect(mapping.clear(DISA, 'HIVVL')).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('set refuses a blank system or code', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(' ', 'HIVVL', 'VL')).rejects.toMatchObject({ kind: 'invalid', message: 'system and code are required' });
  });

  it('clear deactivates every active catalog mapping for the code and rebuilds', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await mapping.set(DISA, 'HIVVL', 'VL');

    const change = await mapping.clear(DISA, 'HIVVL');

    expect([change.before, change.after, change.rebuild.ok]).toEqual(['VL', null, true]);
    expect(await active(internalDb, 'HIVVL')).toEqual([]);
    expect(await externalDb.selectFrom('test_map').selectAll().execute()).toEqual([]);
  });

  it('clear refuses a code with no mapping as not-found', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.clear(DISA, 'HIVVL')).rejects.toMatchObject({ kind: 'not-found', message: 'HIVVL has no catalog mapping' });
  });
});

describe('createCoalescedRunner', () => {
  // Review focus 5.
  it('runs at most twice for a burst of 500 requests', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const request = createCoalescedRunner(async () => { runs += 1; if (runs === 1) await gate; });
    const all = Array.from({ length: 500 }, () => request());
    release();
    await Promise.all(all);
    expect(runs).toBe(2);
  });

  it('runs again for a request made after the burst finished', async () => {
    let runs = 0;
    const request = createCoalescedRunner(async () => { runs += 1; });
    await request();
    await request();
    expect(runs).toBe(2);
  });
});

describe('which changes touch test_map', () => {
  it('a mapping to or from the catalog does', () => {
    expect(mappingTouchesTestMap('urn:openldr:disa', TEST_CATALOG_SYSTEM)).toBe(true);
    expect(mappingTouchesTestMap(TEST_CATALOG_SYSTEM, 'http://loinc.org')).toBe(true);
    expect(mappingTouchesTestMap('urn:x', 'urn:y')).toBe(false);
  });

  it('a synced term mapping into the catalog, a mapping delete, and the catalog system itself do', () => {
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: { fromSystem: 'urn:openldr:disa', toSystem: TEST_CATALOG_SYSTEM } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: null })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'term_mapping', body: { fromSystem: 'urn:x', toSystem: 'urn:y' } })).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: TEST_CATALOG_SYSTEM } })).toBe(true);
    expect(isTestMapRelevantRecord({ entityType: 'terminology_system', body: { url: 'urn:other' } })).toBe(false);
    expect(isTestMapRelevantRecord({ entityType: 'dashboard', body: {} })).toBe(false);
  });
});

describe('rebuildNow runs one at a time', () => {
  it('two overlapping rebuilds both succeed and leave one correct row', async () => {
    const { internalDb, externalDb, mapping, warnings } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');

    const finished: number[] = [];
    const first = mapping.rebuildNow().then((o) => { finished.push(1); return o; });
    const second = mapping.rebuildNow().then((o) => { finished.push(2); return o; });
    const [a, b] = await Promise.all([first, second]);

    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(finished).toEqual([1, 2]);
    expect(warnings).toEqual([]);
    expect(await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code']).execute())
      .toEqual([{ source_code: 'HIVVL', catalog_code: 'VL' }]);
  });
});
