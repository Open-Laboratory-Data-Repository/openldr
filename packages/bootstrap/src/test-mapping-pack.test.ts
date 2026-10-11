import { describe, it, expect } from 'vitest';
import { buildMapping, seedCatalogTest, seedMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';

describe('test mapping: pack plan and apply', () => {
  it('maps by LOINC, keeps an existing mapping, and skips what it cannot resolve', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'A', 'A', { loinc: '1111-1' });
    await seedCatalogTest(internalDb, 'B', 'B', { loinc: '1111-1' });
    await seedMapping(internalDb, 'm1', DISA, 'POCVR', 'A');

    const plan = await mapping.planPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'POCVR', loinc: '25836-8' },
      { system: DISA, code: 'WW', loinc: '9999-9' },
      { system: DISA, code: 'X', loinc: '1111-1' },
    ]);

    expect(plan).toEqual({
      mapped: [{ system: DISA, code: 'HIVVL', catalogCode: 'VL' }],
      kept: [{ system: DISA, code: 'POCVR' }],
      skipped: [
        { system: DISA, code: 'WW', reason: 'no catalog test is linked to LOINC 9999-9' },
        { system: DISA, code: 'X', reason: '2 catalog tests are linked to LOINC 1111-1' },
      ],
    });
  });

  // Review focus 1.
  it('skips a code the pack lists twice', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    const plan = await mapping.planPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
    ]);
    expect(plan.mapped).toHaveLength(1);
    expect(plan.skipped).toEqual([{ system: DISA, code: 'HIVVL', reason: 'listed twice in this pack' }]);
  });

  it('apply writes the mapped codes, never touches a kept one, and rebuilds once', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'A', 'A');
    await seedMapping(internalDb, 'm1', DISA, 'POCVR', 'A');

    const out = await mapping.applyPack([
      { system: DISA, code: 'HIVVL', loinc: '25836-8' },
      { system: DISA, code: 'POCVR', loinc: '25836-8' },
    ]);

    expect(out.rebuild.ok).toBe(true);
    const rows = await externalDb.selectFrom('test_map').select(['source_code', 'catalog_code']).where('source_system', '=', DISA).orderBy('source_code').execute();
    expect(rows).toEqual([{ source_code: 'HIVVL', catalog_code: 'VL' }, { source_code: 'POCVR', catalog_code: 'A' }]);
  });
});
