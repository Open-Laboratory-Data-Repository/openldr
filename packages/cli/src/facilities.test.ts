import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ctx: {
    internalDb: { marker: 'internalDb' },
    store: { db: { marker: 'externalDb' } },
    terminology: { admin: { marker: 'admin' } },
    audit: { marker: 'audit' },
    logger: { marker: 'logger' },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  importFacilities: vi.fn(),
  scanObservedFacilities: vi.fn(),
  publishFacilityMap: vi.fn(),
  recordAuditEvent: vi.fn(),
  referenceCapture: { marker: 'referenceCapture' },
  readFileSync: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  importFacilities: mocks.importFacilities,
  scanObservedFacilities: mocks.scanObservedFacilities,
  publishFacilityMap: mocks.publishFacilityMap,
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock('@openldr/db', () => ({
  referenceCapture: mocks.referenceCapture,
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

import { runFacilitiesImport, runFacilitiesScanObserved, runFacilitiesPublish } from './facilities';

const CLEAN_RESULT = {
  parsed: 10, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [],
  created: 0, updated: 0, duplicates: 0,
};

describe('facilities import CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
    mocks.readFileSync.mockReturnValue('national_code,name\n100,Dodoma\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to a dry run: does not set apply, writes nothing, prints the summary, does not audit', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture, admin: mocks.ctx.terminology.admin },
      'national_code,name\n100,Dodoma\n',
      { nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, allowMalformedRows: undefined, apply: undefined },
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes and reports created/updated, and audits the import', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 3, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 2, updated: 1, duplicates: 0,
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture, admin: mocks.ctx.terminology.admin },
      expect.any(String),
      { nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, allowMalformedRows: undefined, apply: true },
    );
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'facility.import',
        entityType: 'facility',
        entityId: 'urn:tz:hfr',
      }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
  });

  it('surfaces duplicates as a warning, not just a count', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 2, skipped: 0, unknownColumns: [], duplicateColumns: [], quarantined: [], created: 1, updated: 0, duplicates: 1,
    });

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/WARNING/);
    expect(human).toMatch(/duplicate/i);
  });

  it('does not print a duplicates warning when duplicates is 0', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).not.toMatch(/WARNING/);
  });

  it('unknown columns without --allow-unknown-columns refuse and name the columns; no audit', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 0, skipped: 0, unknownColumns: ['beds', 'foo'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0,
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/beds/);
    expect(err).toMatch(/foo/);
    expect(err).toMatch(/allow-unknown-columns/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('--allow-unknown-columns lets an import with unknown columns proceed', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 1, skipped: 0, unknownColumns: ['beds'], duplicateColumns: [], quarantined: [], created: 1, updated: 0, duplicates: 0,
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, allowUnknownColumns: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ allowUnknownColumns: true }),
    );
  });

  // Task 5: surface Task 4's `quarantined`/`allowMalformedRows` (facility-import.ts) through the CLI,
  // per the repo's CLI-parity rule — mirrors the unknown-columns refusal above.
  it('quarantined rows without --allow-malformed-rows refuse and print each line/reason; no audit', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      created: 0, updated: 0, duplicates: 0,
    });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/line 3: too_many_fields — 2,Bad,Extra/);
    expect(err).toMatch(/1 row\(s\) quarantined; re-run with --allow-malformed-rows to import the rest/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('--allow-malformed-rows lets an import with quarantined rows proceed', async () => {
    mocks.importFacilities.mockResolvedValue({
      parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      created: 1, updated: 0, duplicates: 0,
    });

    const code = await runFacilitiesImport(
      '/some/file.csv',
      { nationalSystem: 'urn:tz:hfr', apply: true, allowMalformedRows: true, json: false },
    );

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ allowMalformedRows: true }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 1/);
  });

  it('--json still refuses on quarantined rows, with quarantined present in the JSON payload', async () => {
    const result = {
      parsed: 1, skipped: 0, unknownColumns: [], duplicateColumns: [],
      quarantined: [{ line: 3, reason: 'too_many_fields', raw: '2,Bad,Extra' }],
      created: 0, updated: 0, duplicates: 0,
    };
    mocks.importFacilities.mockResolvedValue(result);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: true });

    expect(code).toBe(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('a missing file exits non-zero with a clear message, not a stack trace', async () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/nope.csv'"), { code: 'ENOENT' });
    mocks.readFileSync.mockImplementation(() => {
      throw enoent;
    });

    const code = await runFacilitiesImport('/nope.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/nope\.csv/);
    expect(err).not.toMatch(/at Object|at runFacilitiesImport|\.ts:\d+/); // no stack trace
  });

  it('--json emits the whole machine-readable result, not prose', async () => {
    mocks.importFacilities.mockResolvedValue(CLEAN_RESULT);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(CLEAN_RESULT, null, 2) + '\n');
  });

  it('--json still refuses on unknown columns, with unknownColumns present in the JSON payload', async () => {
    const result = {
      parsed: 0, skipped: 0, unknownColumns: ['beds'], duplicateColumns: [], quarantined: [], created: 0, updated: 0, duplicates: 0,
    };
    mocks.importFacilities.mockResolvedValue(result);

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: true });

    expect(code).toBe(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('closes the app context even when importFacilities throws', async () => {
    mocks.importFacilities.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

const RECONCILE_DEPS = { internalDb: mocks.ctx.internalDb, externalDb: mocks.ctx.store.db, admin: mocks.ctx.terminology.admin };

describe('facilities scan-observed CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-runs by default: does not set apply, prints discovered/created/updated, does not audit', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ json: false });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(human).toMatch(/discovered 5/);
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('dry-runs by default via --json and prints counts (brief Step 1)', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ json: true });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(JSON.parse(printed)).toMatchObject({ discovered: expect.any(Number), created: expect.any(Number) });
  });

  it('--apply writes and audits facility.scan', async () => {
    mocks.scanObservedFacilities.mockResolvedValue({ discovered: 5, created: 2, updated: 1, systemRegistered: true });

    const code = await runFacilitiesScanObserved({ apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.scanObservedFacilities).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'facility.scan', entityType: 'facility' }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/created 2/);
    expect(human).toMatch(/updated 1/);
  });

  it('--json emits the whole machine-readable result', async () => {
    const result = { discovered: 0, created: 0, updated: 0, systemRegistered: false };
    mocks.scanObservedFacilities.mockResolvedValue(result);

    const code = await runFacilitiesScanObserved({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('closes the app context even when scanObservedFacilities throws, and reports a redacted message', async () => {
    mocks.scanObservedFacilities.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesScanObserved({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});

describe('facilities publish CLI', () => {
  let stdoutSpy: ReturnType<typeof vi.fn>;
  let stderrSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
    mocks.createAppContext.mockResolvedValue(mocks.ctx);
    mocks.ctx.close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-runs by default: does not set apply, prints resolved/unmapped/targetMissing/written, does not audit', async () => {
    mocks.publishFacilityMap.mockResolvedValue({ resolved: 8, unmapped: 3, targetMissing: 1, nonFacilityTarget: 2, ambiguous: 1, written: 12 });

    const code = await runFacilitiesPublish({ json: false });

    expect(code).toBe(0);
    expect(mocks.publishFacilityMap).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: undefined });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(human).toMatch(/resolved 8/);
    expect(human).toMatch(/unmapped 3/);
    expect(human).toMatch(/targetMissing 1/);
    // Task 10: `ambiguous` gets its own count in the human line. Folded into `unmapped` it would
    // tell an operator to go author a mapping, when the fix is to REMOVE one of the two they have.
    expect(human).toMatch(/nonFacilityTarget 2/);
    expect(human).toMatch(/ambiguous 1/);
    expect(human).toMatch(/written 12/);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes and audits facility.publish', async () => {
    mocks.publishFacilityMap.mockResolvedValue({ resolved: 8, unmapped: 3, targetMissing: 1, nonFacilityTarget: 2, ambiguous: 1, written: 12 });

    const code = await runFacilitiesPublish({ apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.publishFacilityMap).toHaveBeenCalledWith(RECONCILE_DEPS, { apply: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      mocks.ctx,
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({ action: 'facility.publish', entityType: 'facility' }),
    );
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/written 12/);
  });

  it('--json emits the whole machine-readable result', async () => {
    const result = { resolved: 0, unmapped: 0, targetMissing: 0, written: 0 };
    mocks.publishFacilityMap.mockResolvedValue(result);

    const code = await runFacilitiesPublish({ json: true });

    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2) + '\n');
  });

  it('closes the app context even when publishFacilityMap throws, and reports a redacted message', async () => {
    mocks.publishFacilityMap.mockRejectedValue(new Error('db exploded'));

    const code = await runFacilitiesPublish({ json: false });

    expect(code).toBe(1);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/db exploded/);
  });
});
