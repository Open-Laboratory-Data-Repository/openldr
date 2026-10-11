import { describe, it, expect } from 'vitest';
import { RESULT_PARAM_SYSTEM } from '@openldr/terminology';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { buildMapping, seedCatalogTest, seedParam, seedResult, seedResultMapping } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const PARAMS = RESULT_PARAM_SYSTEM;
const csv = (text: string) => new TextEncoder().encode(text);

describe('test mapping: result level writes', () => {
  it('set maps a result code to a field, at the result level only, and rebuilds', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');

    const change = await mapping.set(DISA, 'HIVVL', 'VLC', 'result');

    expect([change.before, change.after, change.rebuild.ok]).toEqual([null, 'VLC', true]);
    expect((await mapping.activeFor(DISA, 'HIVVL', 'result')).map((r) => r.to_code)).toEqual(['VLC']);
    expect(await mapping.activeFor(DISA, 'HIVVL')).toEqual([]);
    expect(await externalDb.selectFrom('test_map').select('catalog_code').where('id', '=', `result|${DISA}|HIVVL`).execute()).toEqual([{ catalog_code: 'VLC' }]);
  });

  it('set refuses a field the dictionary does not hold', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.set(DISA, 'HIVVL', 'NOPE', 'result')).rejects.toMatchObject({ kind: 'invalid', message: 'no result field has code NOPE' });
  });

  it('refuses a source in the target system at both levels', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await expect(mapping.set(PARAMS, 'VLC', 'VLC', 'result')).rejects.toMatchObject({
      kind: 'invalid', message: `${PARAMS} codes are result fields already and need no mapping`,
    });
    await expect(mapping.set(TEST_CATALOG_SYSTEM, 'VL', 'VL')).rejects.toMatchObject({
      kind: 'invalid', message: `${TEST_CATALOG_SYSTEM} codes are catalog tests already and need no mapping`,
    });
  });

  it('a lab cannot change a result mapping central sent down', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedParam(internalDb, 'VLL', 'HIV VL log');
    await seedResultMapping(internalDb, 'c1', DISA, 'HIVVL', 'VLC', { central: true });
    await expect(mapping.set(DISA, 'HIVVL', 'VLL', 'result')).rejects.toMatchObject({ kind: 'central-managed' });
  });

  it('clear removes a result mapping, and says so when there is none', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies');
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');

    const change = await mapping.clear(DISA, 'HIVVL', 'result');

    expect([change.before, change.after]).toEqual(['VLC', null]);
    await expect(mapping.clear(DISA, 'HIVVL', 'result')).rejects.toMatchObject({ kind: 'not-found', message: 'HIVVL has no result field mapping' });
  });
});

describe('test mapping: result level CSV', () => {
  it('exports every observed result code with its field, in the import layout', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');
    await seedResult(externalDb, 'o1', DISA, 'HIVVL', 'HIV, VL', '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o2', DISA, 'HIVVL', 'HIV, VL', '2026-05-01T08:00:00Z');
    await seedResult(externalDb, 'o3', DISA, 'CD4', null, '2026-05-01T08:00:00Z');

    expect(await mapping.exportCsv('result')).toBe(
      'system,code,description,results,parameter_code,loinc\n'
      + `${DISA},CD4,,1,,\n`
      + `${DISA},HIVVL,"HIV, VL",2,VLC,20447-9\n`,
    );
  });

  it('previews by parameter_code or LOINC and refuses dictionary codes and unknown fields', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });
    await seedParam(internalDb, 'CD4', 'CD4 count');
    await seedResultMapping(internalDb, 'm1', DISA, 'HIVVL', 'VLC');

    const report = await mapping.importPreview(csv([
      'system,code,parameter_code,loinc',
      `${DISA},HIVVL,VLC,`,       // unchanged
      `${DISA},POCVC,,20447-9`,   // new, by LOINC
      `${DISA},CD4,CD4,`,         // new
      `${DISA},BAD,NOPE,`,        // refused
      `${PARAMS},VLC,VLC,`,       // refused, a dictionary code
    ].join('\n')), 'result');

    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 1, refused: 2 });
    expect(report.refused).toEqual([
      { line: 5, system: DISA, code: 'BAD', reason: 'no result field has code NOPE' },
      { line: 6, system: PARAMS, code: 'VLC', reason: `${PARAMS} codes are result fields already and need no mapping` },
    ]);
  });

  // Review focus 4.
  it('refuses the test-level file at the result level, naming the missing column', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.importPreview(csv(`system,code,catalog_code\n${DISA},HIVVL,VL`), 'result'))
      .rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a parameter_code column or a loinc column' });
  });

  it('applies result mappings and rebuilds once', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedParam(internalDb, 'VLC', 'HIV VL copies', { loinc: '20447-9' });

    const report = await mapping.importApply(csv(`system,code,parameter_code,loinc\n${DISA},POCVC,,20447-9`), 'result');

    expect(report.counts.new).toBe(1);
    expect(report.rebuild?.ok).toBe(true);
    expect((await mapping.activeFor(DISA, 'POCVC', 'result')).map((r) => r.to_code)).toEqual(['VLC']);
  });
});
