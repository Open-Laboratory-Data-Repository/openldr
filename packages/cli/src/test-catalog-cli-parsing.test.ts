import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program';

// Checks only what commander hands runTestCatalogList. The function itself is tested in
// test-catalog.test.ts. A fresh Command per test: commander keeps parsed values across parseAsync calls.
const mocks = vi.hoisted(() => ({
  runTestCatalogList: vi.fn().mockResolvedValue(0),
  runTestCatalogChange: vi.fn().mockResolvedValue(0),
  runTestCatalogImport: vi.fn().mockResolvedValue(0),
  runTestCatalogExport: vi.fn().mockResolvedValue(0),
  runTestCatalogParams: vi.fn().mockResolvedValue(0),
}));

vi.mock('./test-catalog', () => ({
  runTestCatalogList: mocks.runTestCatalogList,
  runTestCatalogChange: mocks.runTestCatalogChange,
  runTestCatalogImport: mocks.runTestCatalogImport,
  runTestCatalogExport: mocks.runTestCatalogExport,
  runTestCatalogParams: mocks.runTestCatalogParams,
}));

describe('test-catalog list: commander parsing', () => {
  beforeEach(() => {
    mocks.runTestCatalogList.mockClear();
    mocks.runTestCatalogChange.mockClear();
  });

  it('hands every flag to runTestCatalogList as given', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'test-catalog', 'list',
      '--search', 'viral', '--category', 'MOL', '--loinc', 'none', '--enabled', 'off',
      '--status', 'all', '--limit', '10', '--offset', '20', '--json',
    ]);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({
      search: 'viral', category: 'MOL', loinc: 'none', enabled: 'off', status: 'all', limit: '10', offset: '20', json: true,
    });
  });

  it('defaults --json to false', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'list']);
    expect(mocks.runTestCatalogList).toHaveBeenCalledWith({ json: false });
  });

  it('hands enable, disable, retire and restore their code and --json', async () => {
    for (const change of ['enable', 'disable', 'retire', 'restore'] as const) {
      mocks.runTestCatalogChange.mockClear();
      await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', change, 'HIVVL', '--json']);
      expect(mocks.runTestCatalogChange).toHaveBeenCalledWith(change, 'HIVVL', { json: true });
    }
  });

  it('hands import its file and flags, and export its --out', async () => {
    await buildProgram().exitOverride().parseAsync([
      'node', 'openldr', 'test-catalog', 'import', 'tests.xlsx',
      '--apply', '--column-map', 'cols.json', '--value-map', 'vals.json', '--json',
    ]);
    expect(mocks.runTestCatalogImport).toHaveBeenCalledWith(
      'tests.xlsx', { apply: true, columnMap: 'cols.json', valueMap: 'vals.json', json: true },
    );
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'import', 'tests.csv']);
    expect(mocks.runTestCatalogImport).toHaveBeenLastCalledWith('tests.csv', { apply: false, json: false });
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'export', '--out', 'catalog.csv']);
    expect(mocks.runTestCatalogExport).toHaveBeenCalledWith({ out: 'catalog.csv' });
  });

  it('hands params the code and the set file', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'params', 'FBC', '--set', 'params.json', '--json']);
    expect(mocks.runTestCatalogParams).toHaveBeenCalledWith('FBC', { set: 'params.json', json: true });
  });

  it('reads params with no flags', async () => {
    await buildProgram().exitOverride().parseAsync(['node', 'openldr', 'test-catalog', 'params', 'FBC']);
    expect(mocks.runTestCatalogParams).toHaveBeenCalledWith('FBC', { json: false });
  });
});
