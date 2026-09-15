import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  importPreview: vi.fn(),
  importApply: vi.fn(),
  exportCsv: vi.fn(),
  close: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));
vi.mock('./cli-actor', () => ({ cliActor: () => ({ actorType: 'cli', actorId: null, actorName: 'tester' }) }));

// Partial: the file reader, the schemas and the audit entry stay real, so the CLI is checked against
// the route's own rules.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    recordAuditEvent: mocks.recordAuditEvent,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    catalogChangeAction: actual.catalogChangeAction,
    catalogImportAudit: actual.catalogImportAudit,
    catalogColumnMapSchema: actual.catalogColumnMapSchema,
    catalogValueMapSchema: actual.catalogValueMapSchema,
    readCatalogImportFile: actual.readCatalogImportFile,
    TestCatalogError: actual.TestCatalogError,
  };
});

import { TestCatalogError } from '@openldr/bootstrap';
import { runTestCatalogExport, runTestCatalogImport } from './test-catalog';

const REPORT = {
  counts: { new: 1, changed: 1, unchanged: 3, refused: 1 },
  refused: [{ line: 5, code: 'X1', reason: 'Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.' }],
  unmatched: { categories: [{ text: 'Virology', rows: 2 }], specimens: [{ text: 'Plasma', rows: 1 }] },
  categoriesToAdd: [{ code: 'VIRO', display: 'Virology' }],
  loincChecked: false,
};

describe('openldr test-catalog import and export', () => {
  let dir: string;
  let out: string[];
  let err: string[];

  const file = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text, 'utf8');
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-cli-'));
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.importPreview.mockResolvedValue(REPORT);
    mocks.importApply.mockResolvedValue(REPORT);
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { importPreview: mocks.importPreview, importApply: mocks.importApply, exportCsv: mocks.exportCsv },
      close: mocks.close,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const m of Object.values(mocks)) m.mockReset();
  });

  it('previews by default with the suggested columns, and writes and audits nothing', async () => {
    const path = file('tests.csv', 'Test code,Test name\nHIVVL,HIV viral load\n');
    expect(await runTestCatalogImport(path, { apply: false, json: false })).toBe(0);
    expect(mocks.importPreview).toHaveBeenCalledWith({
      table: { headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']] },
      columnMap: { code: 'Test code', name: 'Test name' },
    });
    expect(mocks.importApply).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    expect(out.join('')).toBe([
      'Preview only. Nothing was written. Run again with --apply to write it.',
      'new 1, changed 1, unchanged 3, refused 1',
      'LOINC is not loaded here, so LOINC codes were checked for their format only.',
      'Categories to add: VIRO (Virology)',
      'Category text with no match: "Virology" (2 rows)',
      'Specimen text with no match: "Plasma" (1 row)',
      'Refused:',
      '  row 5, X1: Specimen "Plasma" is not in the specimen type list. Choose a specimen for it.',
      '',
    ].join('\n'));
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes, audits as the CLI, and reads the --column-map and --value-map files', async () => {
    const path = file('tests.csv', 'Test code,Test name\nHIVVL,HIV viral load\n');
    const columnMap = { code: 'Test code', name: 'Test name' };
    const valueMap = { categories: [{ text: 'Virology', kind: 'new', code: 'VIRO', display: 'Virology' }], specimens: [] };
    expect(await runTestCatalogImport(path, {
      apply: true, json: false,
      columnMap: file('cols.json', JSON.stringify(columnMap)),
      valueMap: file('vals.json', JSON.stringify(valueMap)),
    })).toBe(0);
    expect(mocks.importApply).toHaveBeenCalledWith({
      table: { headers: ['Test code', 'Test name'], rows: [['HIVVL', 'HIV viral load']] }, columnMap, valueMap,
    });
    expect(out.join('').split('\n')[0]).toBe('Applied.');
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      { actorType: 'cli', actorId: null, actorName: 'tester' },
      {
        action: 'test_catalog.import', entityType: 'test_catalog', entityId: 'urn:openldr:codesystem:test-catalog',
        metadata: { counts: REPORT.counts, categoriesAdded: ['VIRO'] },
      },
    );
  });

  it('prints the report as JSON with --json', async () => {
    const path = file('tests.csv', 'name\nA\n');
    await runTestCatalogImport(path, { apply: false, json: true });
    expect(JSON.parse(out.join(''))).toEqual(REPORT);
  });

  it('refuses a file or map it cannot use, in words, without opening the app', async () => {
    const txt = file('tests.txt', 'name\nA\n');
    expect(await runTestCatalogImport(txt, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: ${txt} must end in .csv or .xlsx\n`);

    err.length = 0;
    const notXlsx = file('tests.xlsx', 'name\nA\n');
    expect(await runTestCatalogImport(notXlsx, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog import failed: The file is not an Excel workbook (.xlsx).\n');

    err.length = 0;
    const csv = file('tests.csv', 'name\nA\n');
    const badMap = file('vals.json', JSON.stringify({ categories: [{ text: 'Virology', kind: 'new', code: 'VIRO' }], specimens: [] }));
    expect(await runTestCatalogImport(csv, { apply: false, json: false, valueMap: badMap })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: --value-map ${badMap}: categories.0.display Required\n`);

    err.length = 0;
    const notJson = file('cols.json', '{ nope');
    expect(await runTestCatalogImport(csv, { apply: false, json: false, columnMap: notJson })).toBe(1);
    expect(err.join('')).toBe(`test-catalog import failed: --column-map ${notJson} is not valid JSON\n`);

    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('reports a service refusal and still closes the context', async () => {
    mocks.importPreview.mockRejectedValue(new TestCatalogError('This catalog comes from central.', 'central-managed'));
    const path = file('tests.csv', 'name\nA\n');
    expect(await runTestCatalogImport(path, { apply: false, json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog import failed: This catalog comes from central.\n');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('export writes the CSV to standard output, or to --out', async () => {
    mocks.exportCsv.mockResolvedValue('code,name\nHIVVL,HIV viral load\n');
    expect(await runTestCatalogExport({})).toBe(0);
    expect(out.join('')).toBe('code,name\nHIVVL,HIV viral load\n');

    out.length = 0;
    const target = join(dir, 'catalog.csv');
    expect(await runTestCatalogExport({ out: target })).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('code,name\nHIVVL,HIV viral load\n');
    expect(out.join('')).toBe(`Wrote ${target}.\n`);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
