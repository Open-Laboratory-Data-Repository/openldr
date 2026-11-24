import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAppContext: vi.fn(),
  list: vi.fn(),
  close: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({ loadConfig: vi.fn(() => ({ config: true })) }));

// Partial: parseCatalogListQuery stays real, so this test checks the same parser the route uses.
vi.mock('@openldr/bootstrap', async () => {
  const actual = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
  return {
    createAppContext: mocks.createAppContext,
    parseCatalogListQuery: actual.parseCatalogListQuery,
    parseResultParams: actual.parseResultParams,
    readHoursCell: actual.readHoursCell,
    catalogUpdateAudit: actual.catalogUpdateAudit,
    recordAuditEvent: mocks.recordAuditEvent,
  };
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatResultParams, readResultParamsFile, runTestCatalogList, runTestCatalogParams, runTestCatalogSet } from './test-catalog';

const TEST = {
  code: 'HIVVL', testCode: 'HIVVL', display: 'HIV viral load', shortName: 'VL', category: 'MOL',
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
    ])).toBe('HGB\tnumeric\trequired\t1 band\nNOTE\ttext\trequired\t0 bands');
  });

  it('prints whether each field is required, and the settings it has, by the names a --set file uses', () => {
    const S = 'urn:openldr:default_result';
    expect(formatResultParams([
      { system: S, code: 'HGB', resultType: 'numeric', valueSetUrl: null, bands: [], required: false, min: 0, max: 30, decimals: 1 },
      { system: S, code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [], required: true, minLength: 2, maxLength: 200 },
      { system: S, code: 'SEEN', resultType: 'date', valueSetUrl: null, bands: [], dateLimit: 'past' },
      { system: S, code: 'POS', resultType: 'boolean', valueSetUrl: null, bands: [] },
      { system: S, code: 'SYM', resultType: 'multicoded', valueSetUrl: 'urn:x:vs:symptoms', bands: [] },
    ])).toBe([
      'HGB\tnumeric\toptional\t0 bands\tmin 0, max 30, decimals 1',
      'NOTE\ttext\trequired\t0 bands\tminLength 2, maxLength 200',
      'SEEN\tdate\trequired\t0 bands\tdateLimit past',
      'POS\tboolean\trequired\t0 bands',
      'SYM\tmulticoded\trequired\t0 bands',
    ].join('\n'));
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

  it('keeps a range age unit from a set file', () => {
    const [param] = readResultParamsFile(JSON.stringify([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 14, high: 22, ageLow: 0, ageHigh: 28, ageUnit: 'd' }] },
    ]));
    expect(param.bands[0].ageUnit).toBe('d');
  });

  it('refuses a set file that is not a list', () => {
    expect(() => readResultParamsFile('{"code":"HGB"}')).toThrow(/list of result parameters/);
  });
});

describe('openldr test-catalog params --set', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
  });

  // The parser drops an age unit it does not know, which would save the range as years. The CLI
  // hands the service the file as written, and the service refuses it as the route does.
  it('sends an unknown age unit to the service as written, and reports its refusal', async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
    const update = vi.fn().mockRejectedValue(new Error('FBC: HGB range 1 has the age unit "days". Use d (days), mo (months) or y (years).'));
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { resolve: vi.fn().mockResolvedValue({ ...TEST, code: 'FBC', resultParams: [] }), update }, close,
    });
    const file = join(mkdtempSync(join(tmpdir(), 'tc-params-')), 'params.json');
    writeFileSync(file, JSON.stringify([
      { system: 'urn:openldr:default_result', code: 'HGB', resultType: 'numeric', bands: [{ low: 14, high: 22, ageLow: 0, ageHigh: 28, ageUnit: 'days' }] },
    ]));
    expect(await runTestCatalogParams('FBC', { set: file, json: false })).toBe(1);
    expect(update.mock.calls[0][1].resultParams[0].bands[0].ageUnit).toBe('days');
    expect(err.join('')).toContain('HGB range 1 has the age unit "days"');
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('openldr test-catalog params --set: field settings and range fields', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
  });

  it('sends the settings, the new types and the range fields, and prints them back as saved', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    const S = 'urn:openldr:default_result';
    const params = [
      { system: S, code: 'HGB', resultType: 'numeric', valueSetUrl: null, required: false, min: 0, max: 30, decimals: 1, bands: [{
        name: null, low: 11, high: 14, unit: null, sex: null, ageLow: null, ageHigh: null,
        pregnancy: 'pregnant', country: 'TZA', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'WHO', scope: 'national',
      }] },
      { system: S, code: 'NOTE', resultType: 'text', valueSetUrl: null, bands: [], minLength: 2, maxLength: 200 },
      { system: S, code: 'SEEN', resultType: 'date', valueSetUrl: null, bands: [], dateLimit: 'future' },
      { system: S, code: 'SYM', resultType: 'multicoded', valueSetUrl: 'urn:x:vs:symptoms', bands: [] },
    ];
    const { parseResultParams } = await vi.importActual<typeof import('@openldr/bootstrap')>('@openldr/bootstrap');
    const update = vi.fn(async (_id: string, input: { resultParams: unknown }) => ({ ...TEST, code: 'FBC', resultParams: parseResultParams(input.resultParams) }));
    mocks.createAppContext.mockResolvedValue({
      testCatalog: { resolve: vi.fn().mockResolvedValue({ ...TEST, code: 'FBC', resultParams: [] }), update }, close: vi.fn().mockResolvedValue(undefined),
    });
    const file = join(mkdtempSync(join(tmpdir(), 'tc-params-')), 'params.json');
    writeFileSync(file, JSON.stringify(params));
    expect(await runTestCatalogParams('FBC', { set: file, json: true })).toBe(0);
    expect(update.mock.calls[0][1].resultParams).toEqual(params);
    expect(JSON.parse(out.join(''))).toEqual(params);
    expect(mocks.recordAuditEvent.mock.calls.at(-1)?.[2]).toMatchObject({ after: { resultParams: params } });
  });
});

describe('openldr test-catalog set', () => {
  let out: string[];
  let err: string[];
  const stored = { ...TEST, resultParams: [], expectedTatHours: 48, criticalTatHours: null, requiresVerification: true };

  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { err.push(String(s)); return true; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mocks.createAppContext.mockReset();
    mocks.recordAuditEvent.mockReset();
  });

  function withTest() {
    const update = vi.fn(async (_code: string, input: Record<string, unknown>) => ({ ...stored, ...input }));
    const close = vi.fn().mockResolvedValue(undefined);
    const resolve = vi.fn().mockResolvedValue(stored);
    mocks.createAppContext.mockResolvedValue({ testCatalog: { resolve, update }, close });
    return { update, close, resolve };
  }

  it('sends the stored test with only the given fields changed, leaves result parameters out, and audits', async () => {
    const { update, close } = withTest();
    expect(await runTestCatalogSet('HIVVL', { criticalTat: '0.5', requiresVerification: 'false', json: false })).toBe(0);
    const sent = update.mock.calls[0][1];
    expect(sent).toMatchObject({ display: 'HIV viral load', criticalTatHours: 0.5, requiresVerification: false });
    expect(sent).not.toHaveProperty('expectedTatHours');
    expect(sent).not.toHaveProperty('resultParams');
    // No --test-code leaves the Test code as stored.
    expect(sent).not.toHaveProperty('testCode');
    expect(out.join('')).toBe('Test code\tHIVVL\nexpected TAT\t48 h\ncritical TAT\t0.5 h\nrequires verification\tno\n');
    expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({ action: 'test_catalog.update', entityId: 'HIVVL' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('changes the Test code with --test-code, on the test the typed code finds, and audits old and new', async () => {
    const { update, resolve } = withTest();
    const stored2 = { ...stored, code: 'tst-0123456789abcdef', testCode: 'HB' };
    resolve.mockResolvedValue(stored2);
    update.mockImplementation(async (_code: string, input: Record<string, unknown>) => ({ ...stored2, ...input }));
    expect(await runTestCatalogSet('HB', { testCode: 'HGB', json: false })).toBe(0);
    expect(resolve).toHaveBeenCalledWith('HB');
    expect(update.mock.calls[0][0]).toBe('tst-0123456789abcdef');
    expect(update.mock.calls[0][1]).toMatchObject({ testCode: 'HGB' });
    expect(out.join('')).toContain('Test code\tHGB\n');
    expect(mocks.recordAuditEvent.mock.calls[0][2]).toMatchObject({
      action: 'test_catalog.update', entityId: 'tst-0123456789abcdef', metadata: { testCode: { from: 'HB', to: 'HGB' } },
    });
  });

  it('refuses an empty --test-code before opening a context, and names a test it cannot find', async () => {
    expect(await runTestCatalogSet('HB', { testCode: '  ', json: false })).toBe(1);
    expect(err.join('')).toContain('--test-code needs a code');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    const { resolve } = withTest();
    resolve.mockResolvedValue(null);
    expect(await runTestCatalogSet('NOPE', { testCode: 'X', json: false })).toBe(1);
    expect(err.join('')).toContain('no such test: NOPE');
  });

  it('clears a TAT given as none', async () => {
    const { update } = withTest();
    expect(await runTestCatalogSet('HIVVL', { expectedTat: 'none', json: true })).toBe(0);
    expect(update.mock.calls[0][1].expectedTatHours).toBeNull();
  });

  it('refuses a TAT that is not a number, a switch that is not true or false, and no flag at all, before opening a context', async () => {
    expect(await runTestCatalogSet('HIVVL', { expectedTat: 'two days', json: false })).toBe(1);
    expect(await runTestCatalogSet('HIVVL', { requiresVerification: 'maybe', json: false })).toBe(1);
    expect(await runTestCatalogSet('HIVVL', { json: false })).toBe(1);
    expect(err.join('')).toContain('--expected-tat must be a number of hours');
    expect(err.join('')).toContain('--requires-verification must be true or false');
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('hands a negative TAT to the service and reports its refusal', async () => {
    const update = vi.fn().mockRejectedValue(new Error('The expected turnaround time must be a positive number of hours, not -2.'));
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.createAppContext.mockResolvedValue({ testCatalog: { resolve: vi.fn().mockResolvedValue(stored), update }, close });
    expect(await runTestCatalogSet('HIVVL', { expectedTat: '-2', json: false })).toBe(1);
    expect(update.mock.calls[0][1].expectedTatHours).toBe(-2);
    expect(err.join('')).toContain('must be a positive number of hours');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
