import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTestCatalogImport, browseTestCatalog, browseTestCategories, catalogImportFormat, catalogResultParams, catalogSpecimensFor, downloadTestCatalogCsv,
  expandValueSetByUrl, getTestCatalogOptions, listTestCatalog,
  previewTestCatalogImport, readTestCatalogFile, setCatalogTestActive, setCatalogTestEnabled, updateCatalogTest,
} from './api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('test catalog api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0, ownedHere: true })));
  });

  it('sends only the filters that are set', async () => {
    await listTestCatalog({ q: 'viral', category: 'MOL', loinc: undefined, enabled: 'on', limit: 25, offset: 50 });
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog?q=viral&category=MOL&enabled=on&limit=25&offset=50');
  });

  it('asks for the plain list when no filter is set', async () => {
    await listTestCatalog();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog');
  });

  it('reads the picker choices', async () => {
    await getTestCatalogOptions();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/options');
  });

  it('encodes the code and sends one boolean for a row change', async () => {
    await setCatalogTestEnabled('HIV VL', true);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIV%20VL/enabled', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    await setCatalogTestActive('HIVVL', false);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/HIVVL/active', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: false }),
    });
  });

  it('carries the server refusal words into the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Test HIVVL is not in the catalog.', kind: 'not-found' }, 404)));
    await expect(updateCatalogTest('HIVVL', { display: 'x' })).rejects.toThrow('save test failed: Test HIVVL is not in the catalog.');
  });

  it('sends the file as raw bytes with its format, and each import step as JSON', async () => {
    const file = new File(['code,name\n'], 'tests.csv', { type: 'text/csv' });
    await readTestCatalogFile(file, 'csv');
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/read?format=csv', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
    });
    const input = { table: { headers: ['name'], rows: [['A']] }, columnMap: { name: 'name' } };
    await previewTestCatalogImport(input);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    await applyTestCatalogImport(input);
    expect(fetch).toHaveBeenLastCalledWith('/api/test-catalog/import/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
  });

  it('tells a file format from its name', () => {
    expect(catalogImportFormat('Tests.XLSX')).toBe('xlsx');
    expect(catalogImportFormat('tests.csv')).toBe('csv');
    expect(catalogImportFormat('tests.xls')).toBeNull();
  });

  it('downloads the export through a link named test-catalog.csv', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('code,name\n', { status: 200, headers: { 'content-type': 'text/csv' } })));
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:catalog'), revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadTestCatalogCsv();
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/export', { method: 'GET' });
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('test-catalog.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:catalog');
    click.mockRestore();
  });

  it('asks which specimens the chosen tests accept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ specimens: [{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }] })));
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'HIVVL' }];
    expect(await catalogSpecimensFor(tests)).toEqual([{ system: 'urn:openldr:cs:local', code: 'BLD', display: 'Blood' }]);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/specimens', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tests }),
    });
  });

  it('asks which result parameters the chosen tests need', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      tests: [{ test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }, params: [] }],
      rejectReasons: { order: [], test: [] },
    })));
    const tests = [{ system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }];
    const answer = await catalogResultParams(tests, { reference: 'Patient/p1' });
    expect(answer.tests).toEqual([{ test: { system: 'urn:openldr:codesystem:test-catalog', code: 'FBC' }, params: [] }]);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/result-params', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tests, patient: { reference: 'Patient/p1' } }),
    });
  });

  it('leaves the patient out when the order names none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ tests: [], rejectReasons: { order: [], test: [] } })));
    await catalogResultParams([], null);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/result-params', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tests: [] }),
    });
  });

  it('expands a value set by url, for a coded result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ expansion: { contains: [{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }] } })));
    expect(await expandValueSetByUrl('urn:openldr:valueset:rdt')).toEqual([{ system: 'urn:openldr:cs:local', code: 'NEG', display: 'Not detected' }]);
    expect(fetch).toHaveBeenCalledWith('/api/terminology/ValueSet/$expand?url=urn%3Aopenldr%3Avalueset%3Ardt&count=500');
  });

  it('browses the catalog with only the filters that are set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0, system: 'urn:x' })));
    await browseTestCatalog({ q: 'vir', category: 'MOL', limit: 25, offset: 50 });
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/browse?q=vir&category=MOL&limit=25&offset=50');
  });

  it('browses with no filters at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [], total: 0, system: 'urn:x' })));
    await browseTestCatalog({});
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/browse');
  });

  it('answers the rows, the total and the coding system as given', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rows: [{ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true }], total: 1, system: 'urn:x' })));
    expect(await browseTestCatalog({})).toEqual({ rows: [{ code: 'HIVVL', display: 'HIV viral load', category: 'MOL', enabled: true }], total: 1, system: 'urn:x' });
  });

  it('reads every catalog category for the browse filter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ categories: [{ code: 'MOL', display: 'Molecular' }] })));
    expect(await browseTestCategories()).toEqual([{ code: 'MOL', display: 'Molecular' }]);
    expect(fetch).toHaveBeenCalledWith('/api/test-catalog/browse/categories');
  });
});
