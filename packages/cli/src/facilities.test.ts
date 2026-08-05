import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ctx: {
    internalDb: { marker: 'internalDb' },
    audit: { marker: 'audit' },
    logger: { marker: 'logger' },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  importFacilities: vi.fn(),
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
  recordAuditEvent: mocks.recordAuditEvent,
}));

vi.mock('@openldr/db', () => ({
  referenceCapture: mocks.referenceCapture,
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

import { runFacilitiesImport } from './facilities';

const CLEAN_RESULT = { parsed: 10, skipped: 0, unknownColumns: [], created: 0, updated: 0, duplicates: 0 };

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
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture },
      'national_code,name\n100,Dodoma\n',
      { nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, apply: undefined },
    );
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    const human = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(human).toMatch(/dry run/i);
    expect(human).toMatch(/nothing written|--apply/i);
    expect(mocks.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('--apply writes and reports created/updated, and audits the import', async () => {
    mocks.importFacilities.mockResolvedValue({ parsed: 3, skipped: 0, unknownColumns: [], created: 2, updated: 1, duplicates: 0 });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      { db: mocks.ctx.internalDb, capture: mocks.referenceCapture },
      expect.any(String),
      { nationalSystem: 'urn:tz:hfr', allowUnknownColumns: undefined, apply: true },
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
    mocks.importFacilities.mockResolvedValue({ parsed: 2, skipped: 0, unknownColumns: [], created: 1, updated: 0, duplicates: 1 });

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
    mocks.importFacilities.mockResolvedValue({ parsed: 0, skipped: 0, unknownColumns: ['beds', 'foo'], created: 0, updated: 0, duplicates: 0 });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, json: false });

    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(err).toMatch(/beds/);
    expect(err).toMatch(/foo/);
    expect(err).toMatch(/allow-unknown-columns/);
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('--allow-unknown-columns lets an import with unknown columns proceed', async () => {
    mocks.importFacilities.mockResolvedValue({ parsed: 1, skipped: 0, unknownColumns: ['beds'], created: 1, updated: 0, duplicates: 0 });

    const code = await runFacilitiesImport('/some/file.csv', { nationalSystem: 'urn:tz:hfr', apply: true, allowUnknownColumns: true, json: false });

    expect(code).toBe(0);
    expect(mocks.importFacilities).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ allowUnknownColumns: true }),
    );
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
    const result = { parsed: 0, skipped: 0, unknownColumns: ['beds'], created: 0, updated: 0, duplicates: 0 };
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
