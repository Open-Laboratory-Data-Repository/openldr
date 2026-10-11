import { describe, it, expect, vi } from 'vitest';
import { TEST_CATALOG_SYSTEM } from './test-catalog';
import { buildMapping, seedCatalogTest, seedMapping, seedRequest } from './test-support/test-mapping-fixture';

const DISA = 'urn:openldr:disa';
const csv = (text: string) => new TextEncoder().encode(text);

describe('test mapping: CSV', () => {
  it('exports every observed code with its mapping, in the import layout', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL', 'HIV, viral load', '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'CD4', null, '2026-05-01T08:00:00Z');

    expect(await mapping.exportCsv()).toBe(
      'system,code,description,requests,catalog_code,loinc\n'
      + `${DISA},CD4,,1,,\n`
      + `${DISA},HIVVL,"HIV, viral load",1,VL,25836-8\n`,
    );
  });

  it('previews new, changed, unchanged and refused rows, resolving LOINC when catalog_code is blank', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL');
    await seedMapping(internalDb, 'm2', DISA, 'POCVR', 'CD4');

    const report = await mapping.importPreview(csv([
      'system,code,catalog_code,loinc',
      `${DISA},HIVVL,VL,`,        // unchanged
      `${DISA},POCVR,,25836-8`,   // changed, CD4 to VL by LOINC
      `${DISA},CD4X,CD4,`,        // new
      `${DISA},UNMAPPED,,`,       // blank: no change
      `${DISA},BAD,NOPE,`,        // refused
      `${DISA},NOLOINC,,1234-5`,  // refused
      `,EMPTY,VL,`,               // refused
      `${DISA},CD4X,VL,`,         // refused, listed twice
    ].join('\n')));

    expect(report.counts).toEqual({ new: 1, changed: 1, unchanged: 2, refused: 4 });
    expect(report.refused).toEqual([
      { line: 6, system: DISA, code: 'BAD', reason: 'no catalog test has code NOPE' },
      { line: 7, system: DISA, code: 'NOLOINC', reason: 'no catalog test is linked to LOINC 1234-5' },
      { line: 8, system: '', code: 'EMPTY', reason: 'system and code are required' },
      { line: 9, system: DISA, code: 'CD4X', reason: 'listed twice in the file' },
    ]);
    expect(report.rebuild).toBeNull();
    expect(await internalDb.selectFrom('term_mappings').select('id').where('to_system', '=', TEST_CATALOG_SYSTEM).where('is_active', '=', true).execute()).toHaveLength(2);
  });

  it('refuses a row whose code central maps, and a LOINC two catalog tests share', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load', { loinc: '25836-8' });
    await seedCatalogTest(internalDb, 'VL2', 'HIV viral load (POC)', { loinc: '25836-8' });
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });

    const report = await mapping.importPreview(csv(`system,code,catalog_code,loinc\n${DISA},HIVVL,VL2,\n${DISA},POCVR,,25836-8\n`));

    expect(report.refused.map((r) => r.reason)).toEqual([
      'central maps HIVVL; a lab cannot change it',
      '2 catalog tests are linked to LOINC 25836-8',
    ]);
  });

  it('apply writes the new and changed rows, skips the refused ones, and rebuilds once', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const report = await mapping.importApply(csv(`system,code,catalog_code,loinc\n${DISA},HIVVL,VL,\n${DISA},BAD,NOPE,\n`));
    expect(report.counts).toEqual({ new: 1, changed: 0, unchanged: 0, refused: 1 });
    expect(report.rebuild?.ok).toBe(true);
    expect(await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).toEqual([{ source_code: 'HIVVL' }]);
  });

  it('apply still rebuilds when a write fails partway, then rethrows the failure', async () => {
    const { internalDb, externalDb, admin, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const real = admin.termMappings.saveExclusive.bind(admin.termMappings);
    let calls = 0;
    vi.spyOn(admin.termMappings, 'saveExclusive').mockImplementation(async (input) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return real(input);
    });

    await expect(mapping.importApply(csv(`system,code,catalog_code
${DISA},A1,VL
${DISA},B2,VL
`))).rejects.toThrow('disk full');

    expect(await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).toEqual([{ source_code: 'A1' }]);
  });

  // Review focus 4.
  it('reads a file Excel saved: BOM, CRLF and a quoted comma', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    const text = '﻿system,code,description,catalog_code\r\n'
      + `${DISA},A,"one, two",VL\r\n${DISA},B,plain,VL\r\n${DISA},C,,VL\r\n`;
    expect((await mapping.importPreview(csv(text))).counts).toEqual({ new: 3, changed: 0, unchanged: 0, refused: 0 });
  });

  it('keeps a central row that asks for no change, and still refuses one that asks for a different test', async () => {
    const { internalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedCatalogTest(internalDb, 'CD4', 'CD4 count');
    await seedMapping(internalDb, 'm1', DISA, 'HIVVL', 'VL', { central: true });

    const same = await mapping.importPreview(csv(`system,code,catalog_code
${DISA},HIVVL,VL
`));
    expect(same.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });

    const other = await mapping.importPreview(csv(`system,code,catalog_code
${DISA},HIVVL,CD4
`));
    expect(other.counts).toEqual({ new: 0, changed: 0, unchanged: 0, refused: 1 });
    expect(other.refused[0].reason).toBe('central maps HIVVL; a lab cannot change it');
  });

  it('refuses a code the warehouse holds with surrounding spaces, and still counts an unobserved code as new', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedRequest(externalDb, 'r1', DISA, 'HIVVL ', null, '2026-05-01T08:00:00Z');
    await seedRequest(externalDb, 'r2', DISA, 'CD4', null, '2026-05-01T08:00:00Z');

    const report = await mapping.importPreview(csv(`system,code,catalog_code
${DISA},HIVVL,VL
${DISA},CD4,VL
${DISA},NEVERSEEN,VL
`));

    expect(report.counts).toEqual({ new: 2, changed: 0, unchanged: 0, refused: 1 });
    expect(report.refused).toEqual([
      { line: 2, system: DISA, code: 'HIVVL', reason: 'the warehouse holds this code with surrounding spaces; map it on the Observed tab or with map set' },
    ]);
  });

  it('reads back a code the export guarded against spreadsheet formulas', async () => {
    const { internalDb, externalDb, mapping } = await buildMapping();
    await seedCatalogTest(internalDb, 'VL', 'HIV viral load');
    await seedMapping(internalDb, 'm1', DISA, '+X', 'VL');
    await seedRequest(externalDb, 'r1', DISA, '+X', null, '2026-05-01T08:00:00Z');
    const exported = await mapping.exportCsv();
    expect(exported).toContain("'+X");

    const report = await mapping.importPreview(csv(exported));
    expect(report.counts).toEqual({ new: 0, changed: 0, unchanged: 1, refused: 0 });

    // The same file against an unmapped code writes +X, not '+X.
    await internalDb.deleteFrom('term_mappings').execute();
    await mapping.importApply(csv(exported));
    expect((await externalDb.selectFrom('test_map').select('source_code').where('source_system', '=', DISA).execute()).map((r) => r.source_code)).toEqual(['+X']);
  });

  it('refuses a file without the system and code columns, or without catalog_code and loinc', async () => {
    const { mapping } = await buildMapping();
    await expect(mapping.importPreview(csv('code,catalog_code\nA,VL\n'))).rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a system column and a code column' });
    await expect(mapping.importPreview(csv('system,code\nx,A\n'))).rejects.toMatchObject({ kind: 'invalid', message: 'the file needs a catalog_code column or a loinc column' });
  });
});
