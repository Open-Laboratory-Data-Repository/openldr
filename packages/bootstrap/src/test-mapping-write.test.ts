import { describe, it, expect } from 'vitest';
import { TEST_CATALOG_SYSTEM, TEST_CODE_SYSTEM, TestCatalogError } from './test-catalog';
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
    expect(await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).toEqual([{ source_code: 'HIVVL' }]);
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

  it('set finds the target by Test code first, ignoring case, then by id, and stores the id', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'tst-0a1b2c3d4e5f6a7b', 'HIV viral load', { testCode: 'VL' });
    // A test whose id is another test's Test code: the Test code wins.
    await seedCatalogTest(internalDb, 'vl', 'Old viral load', { testCode: 'OLDVL' });
    await seedCatalogTest(internalDb, 'tst-1111111111111111', 'CD4 count', { testCode: 'CD4' });

    const byCode = await mapping.set(DISA, 'HIVVL', ' vl ');
    expect(byCode.after).toBe('tst-0a1b2c3d4e5f6a7b');
    expect(await active(internalDb, 'HIVVL')).toEqual([{ to_code: 'tst-0a1b2c3d4e5f6a7b', map_type: 'SAME-AS' }]);
    expect(await externalDb.selectFrom('test_map').select('catalog_code').where('source_system', '=', DISA).execute()).toEqual([{ catalog_code: 'VL' }]);

    const byId = await mapping.set(DISA, 'CD4P', 'tst-1111111111111111');
    expect(await active(internalDb, 'CD4P')).toEqual([{ to_code: byId.after, map_type: 'SAME-AS' }]);
    expect(byId.after).toBe('tst-1111111111111111');
    // The Test code rides along, so a door can print what people read (test identity review, M6).
    expect([byCode.testCode, byId.testCode]).toEqual(['VL', 'CD4']);
  });

  it('set refuses a source in the Test code system: those are catalog tests already', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await expect(mapping.set(TEST_CODE_SYSTEM, 'VL', 'VL')).rejects.toMatchObject({ kind: 'invalid' });
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
    expect(await externalDb.selectFrom('test_map').selectAll().where('source_system', '=', DISA).execute()).toEqual([]);
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

  it('idle() resolves only after the run in flight has finished, and at once when nothing runs', async () => {
    let finished = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const request = createCoalescedRunner(async () => { await gate; finished = true; });
    await request.idle(); // nothing running yet
    void request();
    let idled = false;
    const idle = request.idle().then(() => { idled = true; });
    await Promise.resolve();
    expect([finished, idled]).toEqual([false, false]);
    release();
    await idle;
    expect([finished, idled]).toEqual([true, true]);
  });

  it('idle() never starts a run', async () => {
    let runs = 0;
    const request = createCoalescedRunner(async () => { runs += 1; });
    await request.idle();
    expect(runs).toBe(0);
  });

  it('runs again for a request made after the burst finished', async () => {
    let runs = 0;
    const request = createCoalescedRunner(async () => { runs += 1; });
    await request();
    await request();
    expect(runs).toBe(2);
  });
});

describe('test mapping: settled', () => {
  it('resolves after a requested rebuild has written test_map', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');

    void mapping.requestRebuild();
    await mapping.settled();

    expect(await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).toEqual([{ source_code: 'HIVVL' }]);
  });

  it('waits for a direct rebuildNow too, and resolves when nothing is pending', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await mapping.settled();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');

    void mapping.rebuildNow();
    await mapping.settled();

    expect((await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).length).toBe(1);
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
    expect(await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code']).where('source_system', '=', DISA).execute())
      .toEqual([{ source_code: 'HIVVL', catalog_code: 'VL' }]);
  });
});
