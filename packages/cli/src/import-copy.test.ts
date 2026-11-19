import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Layer under test: the CLI's argument handling, output and exit codes over a faked copy service,
// and the four rows in command-meta. It does not cover the copy service itself, which is
// packages/bootstrap/src/import-copy.test.ts, nor a run through the server.
const mocks = vi.hoisted(() => {
  /** Stands in for the service's CopySetChangedError. The CLI tests for it with instanceof. */
  class CopySetChangedError extends Error {
    readonly sets: string[];
    constructor(sets: string[]) { super('changed'); this.name = 'CopySetChangedError'; this.sets = sets; }
  }
  return { createAppContext: vi.fn(), CopySetChangedError };
});

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));
vi.mock('@openldr/bootstrap', async (importOriginal) => ({
  createAppContext: mocks.createAppContext,
  CopySetChangedError: mocks.CopySetChangedError,
  // The words for the time left are the real ones the server uses.
  formatTimeLeft: (await importOriginal<typeof import('@openldr/bootstrap')>()).formatTimeLeft,
}));

import { COMMAND_META } from './command-meta';
import {
  formatCopyRun, formatTimeLeft, runImportCopyDelete, runImportCopyStart, runImportCopyStatus, runImportCopyStop,
} from './import-copy';

// A source key that must never be printed. It sits in every set's cursor.
const SECRET_KEY = 'REQ-SECRET-0042';

const copy = (over: Record<string, unknown> = {}) => ({
  id: 'c0ffee', kind: 'copy', rev: 3, pluginId: 'v1-import', pluginVersion: '1.2.0', connectorId: 'c1',
  status: 'running', options: { tz: '+02:00' }, pageSize: 500,
  sets: {
    requests: { cursor: SECRET_KEY, keys: 500, rows: 1200, bytes: 34000, skipped: 0, done: false },
    results: { cursor: SECRET_KEY, keys: 10, rows: 40, bytes: 900, skipped: 2, done: false },
  },
  setOrder: ['requests', 'results'], setSql: { requests: 'a1', results: 'b2' }, waiting: null, driver: 'p1',
  startedAt: '2026-11-15T08:00:00.000Z', updatedAt: '2026-11-15T08:01:00.000Z', finishedAt: null, lastError: null,
  startedBy: 'cli', ...over,
});

/** The service throws this when a set's SQL changed and reread was not given. */
const FakeSetChanged = mocks.CopySetChangedError;

describe('import copy CLI', () => {
  let out: string[];
  let err: string[];
  let copies: Record<string, ReturnType<typeof vi.fn>>;
  let closed: number;

  beforeEach(() => {
    vi.clearAllMocks();
    out = []; err = []; closed = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true; });
    copies = {
      start: vi.fn(async () => copy({ status: 'queued', driver: null })),
      get: vi.fn(async () => copy()),
      list: vi.fn(async () => [copy(), copy({ id: 'c0ffef', status: 'completed' })]),
      stop: vi.fn(async () => copy({ status: 'stopping' })),
      remove: vi.fn(async () => copy({ status: 'deleting', driver: null })),
    };
    mocks.createAppContext.mockResolvedValue({ importCopies: copies, close: async () => { closed += 1; } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const cli = expect.objectContaining({ type: 'cli', id: null });
  const printed = () => out.join('') + err.join('');

  it('start without --reread on a changed set exits 1, names the sets and changes nothing', async () => {
    copies.start.mockRejectedValue(new FakeSetChanged(['requests', 'results']));
    const code = await runImportCopyStart({ plugin: 'v1-import', connector: 'c1', reread: false, json: false });
    expect(code).toBe(1);
    expect(out.join('')).toBe('these sets would be read again from the start: requests, results. Run again with --reread to do that.\n');
    expect(copies.start).toHaveBeenCalledTimes(1);
    expect(copies.start.mock.calls[0]![0]).toMatchObject({ reread: false });
    expect(copies.stop).not.toHaveBeenCalled();
    expect(copies.remove).not.toHaveBeenCalled();
    expect(closed).toBe(1);
  });

  it('start with --reread passes reread: true', async () => {
    const code = await runImportCopyStart({
      plugin: 'v1-import', connector: 'c1', option: ['tz=+02:00'], pageSize: '200', reread: true, json: false,
    });
    expect(code).toBe(0);
    expect(copies.start).toHaveBeenCalledWith({
      pluginId: 'v1-import', connectorId: 'c1', options: { tz: '+02:00' }, pageSize: 200, reread: true, actor: cli,
    });
  });

  it('start returns as soon as the request is recorded, with exit code 0', async () => {
    const code = await runImportCopyStart({ plugin: 'v1-import', connector: 'c1', reread: false, json: false });
    expect(code).toBe(0);
    // Recorded and printed once. Nothing reads the copy again, so nothing waits for it.
    expect(copies.start).toHaveBeenCalledTimes(1);
    expect(copies.get).not.toHaveBeenCalled();
    expect(copies.list).not.toHaveBeenCalled();
    expect(out.join('')).toBe(`${formatCopyRun(copy({ status: 'queued', driver: null }) as never)}\n`);
    expect(closed).toBe(1);
  });

  it('refuses a page size that is not a whole number, or an option with no =, before connecting', async () => {
    await expect(runImportCopyStart({ plugin: 'v1-import', connector: 'c1', pageSize: '1.5', reread: false, json: false }))
      .rejects.toThrow(/--page-size/);
    await expect(runImportCopyStart({ plugin: 'v1-import', connector: 'c1', option: ['tz'], reread: false, json: false }))
      .rejects.toThrow(/name=value/);
    expect(mocks.createAppContext).not.toHaveBeenCalled();
  });

  it('formats a copy on one line with no key in it', () => {
    expect(formatCopyRun(copy() as never)).toBe(
      'c0ffee  running  requests keys=500 rows=1200 bytes=34000 skipped=0  results keys=10 rows=40 bytes=900 skipped=2',
    );
    const waiting = copy({ status: 'waiting', waiting: { since: 'x', attempt: 3, error: 'connect ETIMEDOUT\n10.0.0.5:1433' } });
    expect(formatCopyRun(waiting as never)).toBe(
      'c0ffee  waiting  requests keys=500 rows=1200 bytes=34000 skipped=0  results keys=10 rows=40 bytes=900 skipped=2  error: connect ETIMEDOUT 10.0.0.5:1433',
    );
    const failed = copy({ status: 'failed', lastError: "OpenLDR's own database refused a write (53100)" });
    expect(formatCopyRun(failed as never)).toMatch(/  error: OpenLDR's own database refused a write \(53100\)$/);
    // An old error left on a stopped copy is not shown: only waiting and failed carry one.
    expect(formatCopyRun(copy({ status: 'stopped', lastError: 'old' }) as never)).not.toContain('error');
    for (const run of [copy(), waiting, failed]) expect(formatCopyRun(run as never)).not.toContain(SECRET_KEY);
  });

  it('shows the percentage and time left of a running copy, and each set\'s total', () => {
    const counted = (status: string, secondsLeft: number | null) => copy({
      status,
      sets: {
        requests: { cursor: SECRET_KEY, keys: 500, rows: 1200, bytes: 34000, skipped: 0, done: false, total: 2000 },
        results: { cursor: SECRET_KEY, keys: 10, rows: 40, bytes: 900, skipped: 2, done: true, total: 12 },
      },
      estimate: { done: 512, total: 2012, percent: (100 * 512) / 2012, secondsLeft },
    });
    expect(formatCopyRun(counted('running', 754) as never)).toBe(
      'c0ffee  running  25.4% of 2012 keys, about 13 min left  requests keys=500 rows=1200 bytes=34000 skipped=0 total=2000  results keys=10 rows=40 bytes=900 skipped=2 total=12',
    );
    expect(formatCopyRun(counted('running', null) as never)).toContain('25.4% of 2012 keys, time left not known yet');
    // A copy that is not running shows how far it got, with no time left.
    expect(formatCopyRun(counted('stopped', null) as never)).toMatch(/^c0ffee {2}stopped {2}25\.4% of 2012 keys {2}requests/);
    expect(formatCopyRun(counted('completed', null) as never)).not.toContain('%');
    expect(formatCopyRun(counted('running', 754) as never)).not.toContain(SECRET_KEY);
  });

  it('says the time left in plain words', () => {
    expect(formatTimeLeft(59)).toBe('under a minute');
    expect(formatTimeLeft(90)).toBe('about 2 min');
    expect(formatTimeLeft(3600)).toBe('about 1 h');
    expect(formatTimeLeft(3 * 3600 + 5 * 60)).toBe('about 3 h 5 min');
  });

  // Spec 9.3: a copy with a skipped key left is shown as complete with a warning, never as clean.
  it('a completed copy with skipped keys says so in its status', () => {
    expect(formatCopyRun(copy({ status: 'completed' }) as never)).toBe(
      'c0ffee  completed with skipped keys  requests keys=500 rows=1200 bytes=34000 skipped=0  results keys=10 rows=40 bytes=900 skipped=2',
    );
    const clean = copy({ status: 'completed', sets: { requests: { cursor: SECRET_KEY, keys: 5, rows: 9, bytes: 10, skipped: 0, done: true } } });
    expect(formatCopyRun(clean as never)).toBe('c0ffee  completed  requests keys=5 rows=9 bytes=10 skipped=0');
  });

  it('status shows one copy or every copy of a plugin, and never a key, with or without --json', async () => {
    expect(await runImportCopyStatus('v1-import', 'c0ffee', { json: false })).toBe(0);
    expect(copies.get).toHaveBeenCalledWith('v1-import', 'c0ffee');
    expect(await runImportCopyStatus('v1-import', undefined, { json: false })).toBe(0);
    expect(out.join('').trim().split('\n')).toHaveLength(3);
    expect(printed()).not.toContain(SECRET_KEY);

    out.length = 0;
    expect(await runImportCopyStatus('v1-import', 'c0ffee', { json: true })).toBe(0);
    const one = JSON.parse(out.join(''));
    expect(one.sets.requests).toEqual({ keys: 500, rows: 1200, bytes: 34000, skipped: 0, done: false });
    expect(one.status).toBe('running');
    out.length = 0;
    expect(await runImportCopyStatus('v1-import', undefined, { json: true })).toBe(0);
    const all = JSON.parse(out.join(''));
    expect(all).toHaveLength(2);
    for (const run of all) for (const set of Object.values(run.sets)) expect(set).not.toHaveProperty('cursor');
    expect(printed()).not.toContain(SECRET_KEY);

    copies.get.mockResolvedValue(null);
    expect(await runImportCopyStatus('v1-import', 'missing', { json: false })).toBe(1);
  });

  it('start --json prints the run without its cursors', async () => {
    copies.start.mockResolvedValue(copy({ status: 'queued' }));
    expect(await runImportCopyStart({ plugin: 'v1-import', connector: 'c1', reread: false, json: true })).toBe(0);
    const run = JSON.parse(out.join(''));
    expect(run.id).toBe('c0ffee');
    expect(Object.keys(run.sets)).toEqual(['requests', 'results']);
    expect(printed()).not.toContain(SECRET_KEY);
  });

  it('start --json on a changed set prints the set names and exits 1', async () => {
    copies.start.mockRejectedValue(new FakeSetChanged(['results']));
    expect(await runImportCopyStart({ plugin: 'v1-import', connector: 'c1', reread: false, json: true })).toBe(1);
    expect(JSON.parse(out.join(''))).toEqual({ changedSets: ['results'] });
  });

  it('start passes any other refusal on to the caller', async () => {
    copies.start.mockRejectedValue(new Error('copy c0ffee is being deleted'));
    await expect(runImportCopyStart({ plugin: 'v1-import', connector: 'c1', reread: false, json: false })).rejects.toThrow(/being deleted/);
    expect(closed).toBe(1);
  });

  it('stop asks the service to stop the copy as the cli', async () => {
    expect(await runImportCopyStop('v1-import', 'c0ffee')).toBe(0);
    expect(copies.stop).toHaveBeenCalledWith('v1-import', 'c0ffee', cli);
    expect(out.join('')).toMatch(/^c0ffee {2}stopping {2}/);
    expect(printed()).not.toContain(SECRET_KEY);
  });

  it('delete without --force refuses and calls nothing', async () => {
    expect(await runImportCopyDelete('v1-import', 'c0ffee', { force: false })).toBe(1);
    expect(err.join('')).toMatch(/--force/);
    expect(mocks.createAppContext).not.toHaveBeenCalled();
    expect(copies.remove).not.toHaveBeenCalled();
  });

  it('delete with --force asks the service to delete the copy as the cli', async () => {
    expect(await runImportCopyDelete('v1-import', 'c0ffee', { force: true })).toBe(0);
    expect(copies.remove).toHaveBeenCalledWith('v1-import', 'c0ffee', cli);
    expect(out.join('')).toMatch(/^c0ffee {2}deleting {2}/);
    expect(printed()).not.toContain(SECRET_KEY);
  });

  it('every import copy command has a row in command-meta', () => {
    expect(COMMAND_META['import copy start']).toEqual({ kind: 'app', capability: 'connectors.manage', destructive: true });
    expect(COMMAND_META['import copy status']).toEqual({ kind: 'app', capability: 'connectors.manage' });
    expect(COMMAND_META['import copy stop']).toEqual({ kind: 'app', capability: 'connectors.manage' });
    expect(COMMAND_META['import copy delete']).toEqual({ kind: 'app', capability: 'connectors.manage', destructive: true });
  });
});
