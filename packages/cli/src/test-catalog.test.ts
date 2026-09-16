import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));

// Partial: parseCatalogListQuery stays real, so this test checks the same parser the route uses.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    parseResultParams: actual.parseResultParams,
  };
});

import { formatResultParams, readResultParamsFile, runTestCatalogList } from './test-catalog';

const TEST = {
  code: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
  specimenTypes: [{ system: 'urn:openldr:cs:local', code: 'BLD' }], loinc: '25836-8', active: true,
  lab: { enabled: true, specimenTypes: null, localDisplay: null },
};

describe('openldr test-catalog list', () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    mocks.list.mockResolvedValue({ rows: [TEST], total: 3, ownedHere: true });
    mocks.close.mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({ testCatalog: { list: mocks.list }, close: mocks.close });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
    mocks.list.mockReset();
    mocks.close.mockReset();
  });

  it('refuses a bad flag in the route\'s words, before opening a context', async () => {
    expect(await runTestCatalogList({ status: 'gone', json: false })).toBe(1);
    expect(err.join('')).toBe('test-catalog list failed: status must be "active", "retired" or "all"\n');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('prints one line per test and says how many it shows', async () => {
    expect(await runTestCatalogList({ search: 'viral', enabled: 'on', json: false })).toBe(0);
    expect(mocks.list).toHaveBeenCalledWith({ q: 'viral', enabled: true, status: 'active', limit: 25, offset: 0 });
    expect(out.join('')).toBe('HIVVL\tHIV viral load\tMOL\t25836-8\ton\nshowing 1 of 3\n');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('marks a retired test and one with no LOINC', async () => {
    mocks.list.mockResolvedValue({ rows: [{ ...TEST, loinc: null, active: false, lab: { ...TEST.lab, enabled: false } }], total: 1, ownedHere: true });
    await runTestCatalogList({ status: 'all', json: false });
    expect(out.join('')).toBe('HIVVL\tHIV viral load\tMOL\tNo LOINC\toff\tretired\nshowing 1 of 1\n');
  });

  it('prints the store\'s answer as JSON with --json', async () => {
    await runTestCatalogList({ json: true });
    expect(JSON.parse(out.join(''))).toEqual({ rows: [TEST], total: 3, ownedHere: true });
  });

  it('reports a store failure and still closes the context', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    expect(await runTestCatalogList({ json: false })).toBe(1);
    expect(err.join('')).toContain('test-catalog list failed: boom');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});

describe('test-catalog params', () => {
  it('prints one line per parameter, with its type and band count', () => {
    expect(formatResultParams([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null,
        bands: [{ name: null, low: 12, high: 15, unit: 'g/dL', sex: 'female', ageLow: 18, ageHigh: null }] },
      { system: 'urn:openldr:default_result', code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [] },
    ])).toBe('HGB\tnumeric\t1 band\nNOTE\ttext\t0 bands');
  });

  it('says so when a test names none', () => {
    expect(formatResultParams([])).toBe('(no result parameters)');
  });

  it('reads a set file as a list of parameters', () => {
    expect(readResultParamsFile(JSON.stringify([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric' }])))
      .toEqual([{ system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [] }]);
  });

  it('keeps a range name from a set file', () => {
    const [param] = readResultParamsFile(JSON.stringify([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ name: 'Highland women', low: 12, high: 16 }] },
    ]));
    expect(param.bands[0].name).toBe('Highland women');
  });

  it('refuses a set file that is not a list', () => {
    expect(() => readResultParamsFile('{"code":"HGB"}')).toThrow(/list of result parameters/);
  });
});
