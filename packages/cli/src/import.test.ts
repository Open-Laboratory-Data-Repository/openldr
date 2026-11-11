import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Layer under test: the CLI's argument handling, output and exit codes over a faked import
// service. The service itself is covered in packages/bootstrap/src/import-run.test.ts.
const mocks = vi.hoisted(() => ({ createAppContext: vi.fn() }));

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));
vi.mock('@openldr/bootstrap', () => ({ createAppContext: mocks.createAppContext }));

import {
  formatImportRun, parseImportOptions, runImportAllow, runImportAllowed, runImportFailures, runImportResume,
  runImportRevoke, runImportStart, runImportStatus, runImportStop,
} from './import';

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1', pluginId: 'v1-import', connectorId: 'c1', status: 'completed', dryRun: false, cursor: 'REQ0500',
  counts: { keys: 500, imported: 498, failed: 2, resources: 3100 }, startedAt: '2026-11-11T12:00:00.000Z',
  updatedAt: '2026-11-11T12:01:00.000Z', finishedAt: '2026-11-11T12:01:00.000Z', lastError: null, ...over,
});

describe('import CLI', () => {
  let out: string[];
  let err: string[];
  let imports: Record<string, ReturnType<typeof vi.fn>>;
  let closed: number;

  beforeEach(() => {
    vi.clearAllMocks();
    out = []; err = []; closed = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true; });
    imports = {
      allow: vi.fn(async () => {}), revoke: vi.fn(async () => {}), allowed: vi.fn(async () => ['c1']),
      start: vi.fn(async () => run({ status: 'running' })), resume: vi.fn(async () => run({ status: 'running' })),
      wait: vi.fn(async () => run()), get: vi.fn(async () => run()), list: vi.fn(async () => [run(), run({ id: 'r0', status: 'stopped' })]),
      stop: vi.fn(async () => run({ status: 'stopping' })), failures: vi.fn(async () => [{ key: 'REQ0007', error: 'NO_REQUEST_ROWS' }]),
    };
    mocks.createAppContext.mockResolvedValue({ imports, close: async () => { closed += 1; } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const cli = expect.objectContaining({ type: 'cli', id: null });

  it('reads --option name=value pairs, keeping an = inside the value', () => {
    expect(parseImportOptions(['tz=+02:00', 'panels=HIVVL,VIRAL', 'where=a=b'])).toEqual({ tz: '+02:00', panels: 'HIVVL,VIRAL', where: 'a=b' });
    expect(parseImportOptions(undefined)).toEqual({});
    expect(() => parseImportOptions(['tz'])).toThrow(/name=value/);
    expect(() => parseImportOptions(['=x'])).toThrow(/name=value/);
  });

  it('prints one line for a run', () => {
    expect(formatImportRun(run() as never)).toBe('r1  completed  keys=500 imported=498 failed=2 resources=3100  cursor=REQ0500');
    expect(formatImportRun(run({ dryRun: true, status: 'failed', lastError: 'Invalid object name', cursor: null }) as never))
      .toBe('r1  failed (dry run)  keys=500 imported=498 failed=2 resources=3100  cursor=-  error: Invalid object name');
  });

  it('allows and revokes a connector for a plugin as the cli', async () => {
    expect(await runImportAllow('v1-import', 'c1')).toBe(0);
    expect(imports.allow).toHaveBeenCalledWith('v1-import', 'c1', cli);
    expect(await runImportRevoke('v1-import', 'c1')).toBe(0);
    expect(imports.revoke).toHaveBeenCalledWith('v1-import', 'c1', cli);
    out.length = 0;
    expect(await runImportAllowed('v1-import', { json: true })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual(['c1']);
    expect(closed).toBe(3);
  });

  it('starts an import, waits for it, and exits 1 when any request failed', async () => {
    const code = await runImportStart({ plugin: 'v1-import', connector: 'c1', option: ['tz=+02:00'], limit: '1000', pageSize: '200', dryRun: true, json: true });
    expect(imports.start).toHaveBeenCalledWith({
      pluginId: 'v1-import', connectorId: 'c1', options: { tz: '+02:00' }, limit: 1000, pageSize: 200, dryRun: true, actor: cli,
    });
    expect(imports.wait).toHaveBeenCalledWith('r1');
    expect(JSON.parse(out.join('')).counts.failed).toBe(2);
    expect(code).toBe(1);
    expect(closed).toBe(1);
  });

  it('exits 0 for a clean completed run and 1 for a failed or stopped one', async () => {
    imports.wait.mockResolvedValue(run({ counts: { keys: 5, imported: 5, failed: 0, resources: 9 } }));
    expect(await runImportStart({ plugin: 'v1-import', connector: 'c1', dryRun: false, json: false })).toBe(0);
    imports.wait.mockResolvedValue(run({ status: 'failed', counts: { keys: 0, imported: 0, failed: 0, resources: 0 } }));
    expect(await runImportStart({ plugin: 'v1-import', connector: 'c1', dryRun: false, json: false })).toBe(1);
    imports.wait.mockResolvedValue(run({ status: 'stopped', counts: { keys: 5, imported: 5, failed: 0, resources: 9 } }));
    expect(await runImportResume('v1-import', 'r1', { json: false })).toBe(1);
    expect(imports.resume).toHaveBeenCalledWith('v1-import', 'r1', cli);
  });

  it('refuses a limit or page size that is not a whole number, before connecting', async () => {
    await expect(runImportStart({ plugin: 'v1-import', connector: 'c1', limit: 'ten', dryRun: false, json: false })).rejects.toThrow(/--limit/);
    await expect(runImportStart({ plugin: 'v1-import', connector: 'c1', pageSize: '1.5', dryRun: false, json: false })).rejects.toThrow(/--page-size/);
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('shows one run, or every run of a plugin', async () => {
    expect(await runImportStatus('v1-import', 'r1', { json: false })).toBe(0);
    expect(imports.get).toHaveBeenCalledWith('v1-import', 'r1');
    out.length = 0;
    expect(await runImportStatus('v1-import', undefined, { json: false })).toBe(0);
    expect(out.join('').trim().split('\n')).toHaveLength(2);
    imports.get.mockResolvedValue(null);
    expect(await runImportStatus('v1-import', 'missing', { json: false })).toBe(1);
  });

  it('stops a run and lists failures', async () => {
    expect(await runImportStop('v1-import', 'r1')).toBe(0);
    expect(imports.stop).toHaveBeenCalledWith('v1-import', 'r1', cli);
    out.length = 0;
    expect(await runImportFailures('v1-import', 'r1', { json: false })).toBe(0);
    expect(out.join('')).toBe('REQ0007\tNO_REQUEST_ROWS\n');
  });
});
