import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Layer under test: the CLI's argument handling, output, exit codes and the export file, over a
// faked check service, and the four rows in command-meta. It does not cover the check service
// itself (packages/bootstrap/src/import-check.test.ts) nor a run through a server.
const mocks = vi.hoisted(() => ({ createAppContext: vi.fn() }));

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));
// The same rule the service and the broker use for a laboratory code.
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  LABORATORY_CODE: /^[A-Za-z0-9._-]{1,32}$/,
}));

import { COMMAND_META } from './command-meta';
import {
  formatCheckRun, runImportCheckHeld, runImportCheckStart, runImportCheckStatus, runImportCheckStop,
} from './import-check';

// A source key and a patient value that must never be printed from a run. The key sits in the cursor.
const SECRET_KEY = 'REQ-SECRET-0042';
// Planted in a finding and in a check. It must reach the export file and never the terminal.
const PATIENT_VALUE = 'Zyxwv Quillon 1971-03-09';

const counts = (over: Record<string, unknown> = {}) => ({ read: 120, saved: 100, held: 15, failed: 5, resources: 300, labels: {}, ...over });

const run = (over: Record<string, unknown> = {}) => ({
  id: 'ab12cd', kind: 'check', rev: 4, pluginId: 'v1-check', pluginVersion: '1.0.0', copyId: 'c0ffee', referenceCopyId: null,
  status: 'running', options: { tz: '+02:00' }, pageSize: 500, cursor: SECRET_KEY, counts: counts(),
  laboratories: [
    { code: 'LAB1', counts: { read: 100, saved: 90, held: 8, failed: 2, labels: {} } },
    { code: null, counts: { read: 20, saved: 10, held: 7, failed: 3, labels: {} } },
  ],
  waiting: null, driver: 'p1', startedAt: '2026-11-16T08:00:00.000Z', updatedAt: '2026-11-16T08:01:00.000Z',
  finishedAt: null, lastError: null, startedBy: 'cli', ...over,
});

const heldRow = (n: number, over: Record<string, unknown> = {}) => ({
  copyId: 'c0ffee', key: `K${String(n).padStart(4, '0')}`, runId: 'ab12cd', reason: 'held', label: 'dob_missing',
  laboratory: 'LAB1', error: null, heldAt: '2026-11-16T09:00:00.000Z', ...over,
});
const heldItem = (n: number, over: Record<string, unknown> = {}) => ({
  ...heldRow(n, over), findings: [{ note: PATIENT_VALUE, n }], check: { who: PATIENT_VALUE },
});

describe('import check CLI', () => {
  let out: string[];
  let err: string[];
  let checks: Record<string, ReturnType<typeof vi.fn>>;
  let closed: number;
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    out = []; err = []; closed = 0;
    dir = await mkdtemp(join(tmpdir(), 'import-check-'));
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true; });
    checks = {
      start: vi.fn(async () => run({ status: 'queued', driver: null })),
      get: vi.fn(async () => run()),
      list: vi.fn(async () => [run(), run({ id: 'ab12ce', status: 'completed' })]),
      stop: vi.fn(async () => run({ status: 'stopping' })),
      held: vi.fn(async () => ({ rows: [heldRow(1), heldRow(2, { reason: 'error', label: null, laboratory: null, error: 'DECODE_FAILED' })], total: 2 })),
      heldItems: vi.fn(async () => ({ items: [], total: 0 })),
    };
    mocks.createAppContext.mockResolvedValue({ importChecks: checks, close: async () => { closed += 1; } });
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });

  const cli = expect.objectContaining({ type: 'cli', id: null });
  const printed = () => out.join('') + err.join('');
  const startOpts = { plugin: 'v1-check', copy: 'c0ffee', json: false };

  describe('start', () => {
    it('calls the service with the copy, no reference, no options and the cli actor, and prints one line', async () => {
      expect(await runImportCheckStart(startOpts)).toBe(0);
      expect(checks.start).toHaveBeenCalledTimes(1);
      expect(checks.start.mock.calls[0]![0]).toEqual({
        pluginId: 'v1-check', copyId: 'c0ffee', referenceCopyId: null, options: {}, actor: cli,
      });
      expect(out.join('')).toBe('ab12cd  queued  read=120 saved=100 held=15 failed=5\n');
      expect(printed()).not.toContain(SECRET_KEY);
      expect(closed).toBe(1);
    });

    it('passes the reference, the parsed options and the page size', async () => {
      expect(await runImportCheckStart({ ...startOpts, reference: 'r1', option: ['tz=+02:00', 'mode=a=b'], pageSize: '250' })).toBe(0);
      expect(checks.start.mock.calls[0]![0]).toEqual({
        pluginId: 'v1-check', copyId: 'c0ffee', referenceCopyId: 'r1', options: { tz: '+02:00', mode: 'a=b' }, pageSize: 250, actor: cli,
      });
    });

    it('refuses a bad --option or --page-size before it connects', async () => {
      await expect(runImportCheckStart({ ...startOpts, option: ['novalue'] })).rejects.toThrow(/--option takes name=value/);
      await expect(runImportCheckStart({ ...startOpts, pageSize: '5x' })).rejects.toThrow(/--page-size must be a whole number/);
      await expect(runImportCheckStart({ ...startOpts, pageSize: '-1' })).rejects.toThrow(/--page-size must be a whole number/);
      expect(mocks.createAppContext).not.toHaveBeenCalled();
    });

    it('--json prints the run without its cursor and driver', async () => {
      expect(await runImportCheckStart({ ...startOpts, json: true })).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.id).toBe('ab12cd');
      expect(parsed).not.toHaveProperty('cursor');
      expect(parsed).not.toHaveProperty('driver');
      expect(printed()).not.toContain(SECRET_KEY);
    });

    it('passes the service refusal on and still closes the context', async () => {
      checks.start.mockRejectedValue(new Error('copy c0ffee is not finished'));
      await expect(runImportCheckStart(startOpts)).rejects.toThrow(/not finished/);
      expect(closed).toBe(1);
    });
  });

  describe('status', () => {
    it('shows one run', async () => {
      expect(await runImportCheckStatus('v1-check', 'ab12cd', { json: false, laboratories: false })).toBe(0);
      expect(checks.get).toHaveBeenCalledWith('v1-check', 'ab12cd');
      expect(out.join('')).toBe('ab12cd  running  read=120 saved=100 held=15 failed=5\n');
    });

    it('shows every run of the plugin, one line each', async () => {
      expect(await runImportCheckStatus('v1-check', undefined, { json: false, laboratories: false })).toBe(0);
      expect(checks.list).toHaveBeenCalledWith('v1-check');
      expect(out.join('').trim().split('\n')).toEqual([
        'ab12cd  running  read=120 saved=100 held=15 failed=5',
        'ab12ce  completed  read=120 saved=100 held=15 failed=5',
      ]);
    });

    it('says so when the plugin has no run, and exits 1 for a run that is not there', async () => {
      checks.list.mockResolvedValue([]);
      expect(await runImportCheckStatus('v1-check', undefined, { json: false, laboratories: false })).toBe(0);
      expect(out.join('')).toBe('(no checks)\n');
      checks.get.mockResolvedValue(null);
      expect(await runImportCheckStatus('v1-check', 'nope', { json: false, laboratories: false })).toBe(1);
      expect(out.join('')).toContain('check nope not found');
    });

    it('--laboratories adds one line per laboratory, (none) for no code', async () => {
      expect(await runImportCheckStatus('v1-check', 'ab12cd', { json: false, laboratories: true })).toBe(0);
      expect(out.join('').trim().split('\n')).toEqual([
        'ab12cd  running  read=120 saved=100 held=15 failed=5',
        '  LAB1  read=100 saved=90 held=8 failed=2',
        '  (none)  read=20 saved=10 held=7 failed=3',
      ]);
    });

    it('--laboratories on a run that has none adds nothing', async () => {
      checks.get.mockResolvedValue(run({ laboratories: undefined }));
      expect(await runImportCheckStatus('v1-check', 'ab12cd', { json: false, laboratories: true })).toBe(0);
      expect(out.join('').trim().split('\n')).toHaveLength(1);
    });

    it('prints a lastError on its own line, on one line, and nothing when it is not set', async () => {
      checks.get.mockResolvedValue(run({ status: 'failed', lastError: 'the plugin\nfailed:  DECODE_FAILED' }));
      expect(await runImportCheckStatus('v1-check', 'ab12cd', { json: false, laboratories: false })).toBe(0);
      expect(out.join('').trim().split('\n')).toEqual([
        'ab12cd  failed  read=120 saved=100 held=15 failed=5',
        'error: the plugin failed: DECODE_FAILED',
      ]);
      expect(formatCheckRun(run() as never)).not.toContain('error');
    });

    it('--json prints the runs without a cursor and never a key', async () => {
      expect(await runImportCheckStatus('v1-check', undefined, { json: true, laboratories: false })).toBe(0);
      const all = JSON.parse(out.join(''));
      expect(all).toHaveLength(2);
      for (const r of all) expect(r).not.toHaveProperty('cursor');
      out.length = 0;
      expect(await runImportCheckStatus('v1-check', 'ab12cd', { json: true, laboratories: true })).toBe(0);
      expect(JSON.parse(out.join('')).laboratories).toHaveLength(2);
      expect(printed()).not.toContain(SECRET_KEY);
    });
  });

  describe('stop', () => {
    it('calls the service with the cli actor and prints the run', async () => {
      expect(await runImportCheckStop('v1-check', 'ab12cd', { json: false })).toBe(0);
      expect(checks.stop).toHaveBeenCalledWith('v1-check', 'ab12cd', cli);
      expect(out.join('')).toBe('ab12cd  stopping  read=120 saved=100 held=15 failed=5\n');
      expect(closed).toBe(1);
    });

    it('--json prints the run without its cursor', async () => {
      expect(await runImportCheckStop('v1-check', 'ab12cd', { json: true })).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.status).toBe('stopping');
      expect(parsed).not.toHaveProperty('cursor');
    });
  });

  describe('held', () => {
    const heldOpts = { json: false };

    it('lists the rows with no findings, then the total, and asks for 50 from 0 by default', async () => {
      checks.held.mockResolvedValue({ rows: [heldRow(1), heldRow(2, { reason: 'error', label: null, laboratory: null, error: 'DECODE_FAILED' })], total: 7 });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', heldOpts)).toBe(0);
      expect(checks.held).toHaveBeenCalledWith('v1-check', 'c0ffee', { offset: 0, limit: 50 });
      expect(out.join('').trim().split('\n')).toEqual([
        'K0001  LAB1  dob_missing  -  2026-11-16T09:00:00.000Z',
        'K0002  (none)  error  DECODE_FAILED  2026-11-16T09:00:00.000Z',
        'total 7',
      ]);
    });

    it('passes each filter, the offset and the limit', async () => {
      expect(await runImportCheckHeld('v1-check', 'c0ffee', {
        json: false, label: 'dob_missing', reason: 'held', laboratory: 'LAB-1.a', offset: '10', limit: '100',
      })).toBe(0);
      expect(checks.held).toHaveBeenCalledWith('v1-check', 'c0ffee', {
        reason: 'held', label: 'dob_missing', laboratory: 'LAB-1.a', offset: 10, limit: 100,
      });
    });

    it('bounds the limit to 1 to 100 and refuses a bad reason, laboratory, offset or label', async () => {
      for (const limit of ['0', '101', 'x', '-5']) {
        await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, limit })).rejects.toThrow(/--limit/);
      }
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, reason: 'both' })).rejects.toThrow(/--reason must be held or error/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, laboratory: 'a b' })).rejects.toThrow(/--laboratory/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, laboratory: 'x'.repeat(33) })).rejects.toThrow(/--laboratory/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, offset: '-1' })).rejects.toThrow(/--offset must be a whole number/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, label: '' })).rejects.toThrow(/--label/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, label: 'x'.repeat(65) })).rejects.toThrow(/--label/);
      expect(mocks.createAppContext).not.toHaveBeenCalled();
    });

    it('--json prints the rows and the total', async () => {
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: true })).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.total).toBe(2);
      expect(parsed.rows).toHaveLength(2);
    });

    it('an empty list says so and still prints the total', async () => {
      checks.held.mockResolvedValue({ rows: [], total: 0 });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', heldOpts)).toBe(0);
      expect(out.join('')).toBe('total 0\n');
    });
  });

  describe('held --export', () => {
    const file = () => join(dir, 'held.ndjson');
    const items = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => heldItem(from + i + 1));

    /** A fake that pages the way the service does: by offset and limit over `n` rows. */
    const serve = (n: number) => {
      checks.heldItems.mockImplementation(async (_p: string, _c: string, o: { offset: number; limit: number }) => ({
        items: items(o.offset, Math.min(n, o.offset + o.limit)), total: n,
      }));
    };

    it('pages until the total is reached and writes one object per line with findings and check', async () => {
      serve(450);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      const offsets = checks.heldItems.mock.calls.map((c) => (c[2] as { offset: number }).offset);
      expect(offsets).toEqual([0, 200, 400]);
      for (const c of checks.heldItems.mock.calls) expect((c[2] as { limit: number }).limit).toBeLessThanOrEqual(200);
      expect(checks.held).not.toHaveBeenCalled();
      const lines = (await readFile(file(), 'utf8')).split('\n');
      expect(lines.at(-1)).toBe('');
      const rows = lines.slice(0, -1).map((l) => JSON.parse(l));
      expect(rows).toHaveLength(450);
      expect(rows[0]).toMatchObject({ key: 'K0001', findings: [{ note: PATIENT_VALUE, n: 1 }], check: { who: PATIENT_VALUE } });
      expect(rows[449].key).toBe('K0450');
    });

    it('sends the filters on every page and no offset or limit of the caller', async () => {
      serve(3);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), reason: 'error', label: 'x_y', laboratory: 'LAB1' })).toBe(0);
      expect(checks.heldItems.mock.calls[0]![2]).toMatchObject({ reason: 'error', label: 'x_y', laboratory: 'LAB1', offset: 0 });
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: join(dir, 'b'), limit: '10' })).rejects.toThrow(/--export/);
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: join(dir, 'b'), offset: '10' })).rejects.toThrow(/--export/);
    });

    it('writes the file with mode 0600', async () => {
      serve(2);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect((await stat(file())).mode & 0o777).toBe(0o600);
    });

    it('prints only the count and the path, never a value from a finding', async () => {
      serve(2);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect(out.join('')).toBe(`2 requests written to ${file()}\n`);
      expect(printed()).not.toContain(PATIENT_VALUE);
      expect(await readFile(file(), 'utf8')).toContain(PATIENT_VALUE);
      out.length = 0;
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: true, export: join(dir, 'j.ndjson') })).toBe(0);
      expect(JSON.parse(out.join(''))).toEqual({ exported: 2, path: join(dir, 'j.ndjson') });
      expect(printed()).not.toContain(PATIENT_VALUE);
    });

    it('refuses an existing file without --force, and leaves it and the database alone', async () => {
      await writeFile(file(), 'keep me');
      serve(2);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(1);
      expect(err.join('')).toContain('already exists');
      expect(err.join('')).toContain('--force');
      expect(await readFile(file(), 'utf8')).toBe('keep me');
      expect(checks.heldItems).not.toHaveBeenCalled();
      expect(mocks.createAppContext).not.toHaveBeenCalled();
    });

    it('overwrites an existing file with --force, and keeps it at 0600', async () => {
      await writeFile(file(), 'old old old old old old old old old old old', { mode: 0o644 });
      serve(2);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force: true })).toBe(0);
      const text = await readFile(file(), 'utf8');
      expect(text).not.toContain('old old');
      expect(text.trim().split('\n')).toHaveLength(2);
      expect((await stat(file())).mode & 0o777).toBe(0o600);
    });

    it('an empty match writes an empty file and says 0', async () => {
      serve(0);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect(out.join('')).toBe(`0 requests written to ${file()}\n`);
      expect(await readFile(file(), 'utf8')).toBe('');
    });

    it('a fault midway removes the half file and puts no value in the error', async () => {
      checks.heldItems
        .mockResolvedValueOnce({ items: items(0, 200), total: 450 })
        .mockRejectedValueOnce(new Error('connection lost'));
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).rejects.toThrow(/connection lost/);
      await expect(stat(file())).rejects.toThrow();
      expect(closed).toBe(1);
    });
  });
});

describe('command-meta rows for import check', () => {
  it('has the four commands, on the import key, and only held writes a file', () => {
    for (const p of ['import check start', 'import check status', 'import check stop', 'import check held']) {
      expect(COMMAND_META[p], p).toMatchObject({ kind: 'app', capability: 'connectors.manage' });
    }
    expect(COMMAND_META['import check held']!.paths).toEqual([{ target: '--export', kind: 'output-file' }]);
    expect(COMMAND_META['import check held']!.destructive).toBe(true);
    expect(COMMAND_META['import check status']!.destructive).toBeUndefined();
  });
});
