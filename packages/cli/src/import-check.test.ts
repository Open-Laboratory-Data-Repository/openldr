import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Layer under test: the CLI's argument handling, output, exit codes and the export file, over a
// faked check service, and the four rows in command-meta. It does not cover the check service
// itself (packages/bootstrap/src/import-check.test.ts) nor a run through a server.
const mocks = vi.hoisted(() => ({ createAppContext: vi.fn(), recordCheckRead: vi.fn(async () => undefined) }));

vi.mock('@openldr/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('@openldr/config')>(),
  loadConfig: vi.fn(() => ({ config: true })),
}));
// The same rule the service and the broker use for a laboratory code.
vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  LABORATORY_CODE: /^[A-Za-z0-9._-]{1,32}$/,
  FINDING_CODE: /^[a-z][a-z0-9_]{0,63}$/,
  // The numbers the plugin broker checks a held request page against.
  HELD_LABEL_MAX: 64, HELD_LIST_LIMIT_MAX: 100, HELD_ITEMS_LIMIT_MAX: 200,
  checkIdOf: (copyId: string) => `check-of-${copyId}`,
  // The service's own rule for a check that still adds and removes held rows.
  isLiveCheck: (s: string) => ['queued', 'running', 'waiting', 'stopping'].includes(s),
  // The one function the broker's audit row and this command's audit row both come from.
  recordCheckRead: mocks.recordCheckRead,
}));

import { COMMAND_META } from './command-meta';
import {
  formatCheckRun, runImportCheckChoices, runImportCheckCodes, runImportCheckCorrect, runImportCheckHeld, runImportCheckRecheck, runImportCheckStart, runImportCheckStatus, runImportCheckStop,
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
      correct: vi.fn(async () => ({ corrections: [{ field: 'dob_age', value: '2023-03-11', original: '2024-03-11', reason: 'typed wrong', correctedBy: 'cli', correctedAt: 'x' }] })),
      recheck: vi.fn(async () => run({ status: 'queued', driver: null })),
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
      // The run it got has requests already read, so it carried on.
      expect(out.join('')).toBe('ab12cd  queued  copy=c0ffee  read=120 saved=100 held=15 failed=5\nCarries on from 120 requests read.\n');
      expect(printed()).not.toContain(SECRET_KEY);
      expect(closed).toBe(1);
    });

    it('says when the run starts from the first request, and --from-start asks for that', async () => {
      checks.start.mockResolvedValue(run({ status: 'queued', driver: null, cursor: null, counts: counts({ read: 0, saved: 0, held: 0, failed: 0 }) }));
      expect(await runImportCheckStart({ ...startOpts, fromStart: true })).toBe(0);
      expect(checks.start.mock.calls[0]![0]).toEqual({
        pluginId: 'v1-check', copyId: 'c0ffee', referenceCopyId: null, options: {}, fromStart: true, actor: cli,
      });
      expect(out.join('')).toBe('ab12cd  queued  copy=c0ffee  read=0 saved=0 held=0 failed=0\nStarts from the first request.\n');
      // Without the flag nothing is sent for it, so the service decides.
      expect(await runImportCheckStart({ ...startOpts, fromStart: false })).toBe(0);
      expect(checks.start.mock.calls[1]![0]).not.toHaveProperty('fromStart');
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
      // One JSON value and nothing else.
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
      expect(out.join('')).toBe('ab12cd  running  copy=c0ffee  read=120 saved=100 held=15 failed=5\n');
    });

    it('shows every run of the plugin, one line each', async () => {
      expect(await runImportCheckStatus('v1-check', undefined, { json: false, laboratories: false })).toBe(0);
      expect(checks.list).toHaveBeenCalledWith('v1-check');
      expect(out.join('').trim().split('\n')).toEqual([
        'ab12cd  running  copy=c0ffee  read=120 saved=100 held=15 failed=5',
        'ab12ce  completed  copy=c0ffee  read=120 saved=100 held=15 failed=5',
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
        'ab12cd  running  copy=c0ffee  read=120 saved=100 held=15 failed=5',
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
        'ab12cd  failed  copy=c0ffee  read=120 saved=100 held=15 failed=5',
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
      expect(out.join('')).toBe('ab12cd  stopping  copy=c0ffee  read=120 saved=100 held=15 failed=5\n');
      expect(closed).toBe(1);
    });

    it('--json prints the run without its cursor', async () => {
      expect(await runImportCheckStop('v1-check', 'ab12cd', { json: true })).toBe(0);
      const parsed = JSON.parse(out.join(''));
      expect(parsed.status).toBe('stopping');
      expect(parsed).not.toHaveProperty('cursor');
    });
  });

  describe('correct and recheck (held corrections)', () => {
    it('correct sends each --set as a field, an empty value as null, the reason and the cli actor, and prints no value', async () => {
      expect(await runImportCheckCorrect('v1-check', 'c0ffee', SECRET_KEY, { set: ['dob_age=2023-03-11', 'sex='], reason: 'typed wrong', json: false })).toBe(0);
      expect(checks.correct).toHaveBeenCalledWith({ pluginId: 'v1-check', copyId: 'c0ffee', key: SECRET_KEY, values: { dob_age: '2023-03-11', sex: null }, reason: 'typed wrong', actor: cli });
      expect(out.join('')).toBe('corrected 2 fields: dob_age, sex\n');
      expect(out.join('')).not.toContain('2023-03-11');
    });

    it('correct refuses a --set with no field and a missing reason before calling the service', async () => {
      await expect(runImportCheckCorrect('v1-check', 'c0ffee', SECRET_KEY, { set: ['=x'], reason: 'r', json: false })).rejects.toThrow(/field=value/);
      await expect(runImportCheckCorrect('v1-check', 'c0ffee', SECRET_KEY, { set: ['sex=F'], reason: '', json: false })).rejects.toThrow(/--reason/);
      expect(checks.correct).not.toHaveBeenCalled();
    });

    it('recheck --json prints no key the recheck names (review H5)', async () => {
      checks.recheck = vi.fn(async () => run({ status: 'queued', driver: null, recheck: { keys: [SECRET_KEY], returnTo: 'completed', finishedAt: null } } as never));
      expect(await runImportCheckRecheck('v1-check', 'c0ffee', SECRET_KEY, { json: true })).toBe(0);
      expect(out.join('')).not.toContain(SECRET_KEY);
    });

    // demo.4 item 11: the values a person may pick, so a correction from the CLI can use a real code.
    it('choices prints each field with its codes and names, and --field keeps one field', async () => {
      (checks as Record<string, unknown>).choices = vi.fn(async () => ({
        specimen: [{ code: 'BM', description: 'Bone marrow' }, { code: 'FNA', description: 'Fine needle aspirate' }],
        sex: [{ code: 'F', description: 'Female' }],
      }));
      expect(await runImportCheckChoices('v1-check', 'c0ffee', { json: false })).toBe(0);
      expect((checks as Record<string, ReturnType<typeof vi.fn>>).choices).toHaveBeenCalledWith('v1-check', 'c0ffee');
      expect(out.join('')).toBe('specimen  BM  Bone marrow\nspecimen  FNA  Fine needle aspirate\nsex  F  Female\n');
      out.length = 0;
      expect(await runImportCheckChoices('v1-check', 'c0ffee', { json: true, field: 'specimen' })).toBe(0);
      expect(JSON.parse(out.join(''))).toEqual({ specimen: [{ code: 'BM', description: 'Bone marrow' }, { code: 'FNA', description: 'Fine needle aspirate' }] });
      expect(mocks.recordCheckRead).toHaveBeenCalledWith(expect.anything(), expect.anything(), { pluginId: 'v1-check', copyId: 'c0ffee', kind: 'choices' });
    });

    it('choices says so when a field has no list', async () => {
      (checks as Record<string, unknown>).choices = vi.fn(async () => ({}));
      expect(await runImportCheckChoices('v1-check', 'c0ffee', { json: false, field: 'specimen' })).toBe(0);
      expect(out.join('')).toBe('no list of values for specimen\n');
    });

    it('recheck queues the run and prints it', async () => {
      expect(await runImportCheckRecheck('v1-check', 'c0ffee', SECRET_KEY, { json: false })).toBe(0);
      expect(checks.recheck).toHaveBeenCalledWith({ pluginId: 'v1-check', copyId: 'c0ffee', key: SECRET_KEY, actor: cli });
      expect(out.join('')).toContain('queued');
      expect(out.join('')).not.toContain(SECRET_KEY);
    });
  });

  describe('held', () => {
    const heldOpts = { json: false };

    // demo.4 item 10: the held list by finding code, and the codes with counts.
    it('--finding filters the list by a finding code, and refuses one that is not a bare word', async () => {
      checks.held.mockResolvedValue({ rows: [], total: 0 });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, finding: 'specimen_missing' })).toBe(0);
      expect(checks.held).toHaveBeenCalledWith('v1-check', 'c0ffee', { finding: 'specimen_missing', offset: 0, limit: 50 });
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { ...heldOpts, finding: 'Not A Code' })).rejects.toThrow(/--finding/);
    });

    it('codes lists each finding code with its count, most first, and takes the filters', async () => {
      (checks as Record<string, unknown>).heldCodes = vi.fn(async () => [{ code: 'specimen_missing', count: 2385 }, { code: 'panel_specimen_mismatch', count: 41 }]);
      expect(await runImportCheckCodes('v1-check', 'c0ffee', { json: false, laboratory: 'TBG' })).toBe(0);
      expect((checks as Record<string, ReturnType<typeof vi.fn>>).heldCodes).toHaveBeenCalledWith('v1-check', 'c0ffee', { laboratory: 'TBG' });
      expect(out.join('')).toBe('specimen_missing  2385\npanel_specimen_mismatch  41\n');
    });

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

    it('prints only the named fields of a row, so a field added to a row later never reaches the terminal', async () => {
      const leaky = heldRow(1, { findings: [{ note: PATIENT_VALUE }], check: { who: PATIENT_VALUE }, extra: PATIENT_VALUE });
      checks.held.mockResolvedValue({ rows: [leaky], total: 1 });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', heldOpts)).toBe(0);
      expect(printed()).not.toContain(PATIENT_VALUE);
      out.length = 0;
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: true })).toBe(0);
      expect(printed()).not.toContain(PATIENT_VALUE);
      const parsed = JSON.parse(out.join(''));
      expect(Object.keys(parsed.rows[0]).sort()).toEqual(['error', 'heldAt', 'key', 'label', 'laboratory', 'reason']);
    });

    it('writes the audit row for the list once, after the rows are read, and none when the read fails', async () => {
      expect(await runImportCheckHeld('v1-check', 'c0ffee', heldOpts)).toBe(0);
      expect(mocks.recordCheckRead).toHaveBeenCalledTimes(1);
      expect(mocks.recordCheckRead.mock.calls[0]).toEqual([
        expect.objectContaining({ importChecks: checks }),
        expect.objectContaining({ actorType: 'cli' }),
        { pluginId: 'v1-check', copyId: 'c0ffee', kind: 'held' },
      ]);
      mocks.recordCheckRead.mockClear();
      checks.held.mockRejectedValue(new Error('copy c0ffee not found'));
      await expect(runImportCheckHeld('v1-check', 'c0ffee', heldOpts)).rejects.toThrow(/not found/);
      expect(mocks.recordCheckRead).not.toHaveBeenCalled();
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
    /** Files left in the export folder: the target and any temporary file beside it. */
    const folder = () => readdir(dir);
    beforeEach(() => { checks.get.mockResolvedValue(run({ status: 'completed', driver: null })); });

    /** The position after a key K0001..: the number in it. */
    const at = (after: string | null) => (after === null ? 0 : Number(after.slice(1)));
    /** A fake that pages the way the service does by key: the rows past `after`, and `next`. */
    const serve = (n: number) => {
      checks.heldItems.mockImplementation(async (_p: string, _c: string, o: { after: string | null; limit: number }) => {
        const from = at(o.after);
        const to = Math.min(n, from + o.limit);
        return { items: items(from, to), total: n, next: to < n ? heldItem(to).key : null };
      });
    };

    it('reads by key until no row is left and writes one object per line with findings and check', async () => {
      serve(450);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      const afters = checks.heldItems.mock.calls.map((c) => (c[2] as { after: string | null }).after);
      expect(afters).toEqual([null, 'K0200', 'K0400']);
      for (const c of checks.heldItems.mock.calls) expect(c[2]).not.toHaveProperty('offset');
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
      expect(checks.heldItems.mock.calls[0]![2]).toEqual({ reason: 'error', label: 'x_y', laboratory: 'LAB1', after: null, limit: 200 });
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
        .mockResolvedValueOnce({ items: items(0, 200), total: 450, next: 'K0200' })
        .mockRejectedValueOnce(new Error('connection lost'));
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).rejects.toThrow(/connection lost/);
      await expect(stat(file())).rejects.toThrow();
      expect(await folder()).toEqual([]);
      expect(closed).toBe(1);
    });

    it('with --force, a fault keeps the old file whole and removes only the temporary file', async () => {
      await writeFile(file(), 'the old export');
      checks.heldItems
        .mockResolvedValueOnce({ items: items(0, 200), total: 450, next: 'K0200' })
        .mockRejectedValueOnce(new Error('connection lost'));
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force: true })).rejects.toThrow(/connection lost/);
      expect(await readFile(file(), 'utf8')).toBe('the old export');
      expect(await folder()).toEqual(['held.ndjson']);
    });

    it('with --force, a wrong plugin or copy (the first read fails) leaves the old file alone', async () => {
      await writeFile(file(), 'the old export');
      checks.heldItems.mockRejectedValue(new Error('copy c0ffee not found'));
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force: true })).rejects.toThrow(/not found/);
      expect(await readFile(file(), 'utf8')).toBe('the old export');
      expect(await folder()).toEqual(['held.ndjson']);
    });

    it('writes to a private temporary file beside the target, and the target appears only at the end', async () => {
      const seen: { names: string[]; modes: number[]; target: boolean }[] = [];
      checks.heldItems.mockImplementation(async (_p: string, _c: string, o: { after: string | null; limit: number }) => {
        const from = at(o.after);
        if (from > 0) {
          const names = await folder();
          const modes = await Promise.all(names.map(async (n) => (await stat(join(dir, n))).mode & 0o777));
          seen.push({ names, modes, target: names.includes('held.ndjson') });
        }
        const to = Math.min(450, from + o.limit);
        return { items: items(from, to), total: 450, next: to < 450 ? heldItem(to).key : null };
      });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect(seen.length).toBe(2);
      for (const s of seen) {
        expect(s.target).toBe(false);
        expect(s.names).toHaveLength(1);
        expect(s.modes).toEqual([0o600]);
      }
      expect(await folder()).toEqual(['held.ndjson']);
    });

    it('does not follow a link at the target: refuses it, with or without --force', async () => {
      const elsewhere = join(dir, 'elsewhere.txt');
      await writeFile(elsewhere, 'not yours');
      await symlink(elsewhere, file());
      serve(2);
      for (const force of [false, true]) {
        err.length = 0;
        expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force })).toBe(1);
        expect(err.join('')).toBe(`${file()} is a link. Name the file itself.\n`);
      }
      expect(await readFile(elsewhere, 'utf8')).toBe('not yours');
      expect(checks.heldItems).not.toHaveBeenCalled();
    });

    it('refuses a folder as the target, with or without --force, and does not say to use --force', async () => {
      await mkdir(file());
      serve(2);
      for (const force of [false, true]) {
        err.length = 0;
        expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force })).toBe(1);
        expect(err.join('')).toBe(`${file()} is a folder. Name a file.\n`);
      }
      expect(checks.heldItems).not.toHaveBeenCalled();
    });

    it('refuses while a check of that copy is queued, running, waiting or stopping, before it reads a row or makes a file', async () => {
      serve(2);
      for (const status of ['queued', 'running', 'waiting', 'stopping']) {
        err.length = 0;
        checks.get.mockResolvedValue(run({ status }));
        expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(1);
        expect(err.join(''), status).toBe('The check of this copy is running. Wait for it, or stop it, then export again.\n');
      }
      expect(checks.get).toHaveBeenCalledWith('v1-check', 'check-of-c0ffee');
      expect(checks.heldItems).not.toHaveBeenCalled();
      expect(await folder()).toEqual([]);
      expect(mocks.recordCheckRead).not.toHaveBeenCalled();
      expect(closed).toBe(4);
    });

    it('exports when the check is stopped, completed or failed, or there is none', async () => {
      serve(1);
      for (const status of ['stopped', 'completed', 'failed']) {
        checks.get.mockResolvedValue(run({ status }));
        expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: join(dir, `${status}.ndjson`), force: true })).toBe(0);
      }
      checks.get.mockResolvedValue(null);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
    });

    it('a count that differs from the total is a fault: no file, exit 1, both numbers in the message', async () => {
      // A row left the set during the export, so the last page is short and the total is still 450.
      checks.heldItems
        .mockResolvedValueOnce({ items: items(0, 200), total: 450, next: 'K0200' })
        .mockResolvedValueOnce({ items: items(200, 400), total: 450, next: 'K0400' })
        .mockResolvedValueOnce({ items: items(400, 449), total: 450, next: null });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(1);
      expect(err.join('')).toBe('The export is not whole: 449 requests were read and the total is 450. The file was not written. Run it again.\n');
      expect(await folder()).toEqual([]);
      expect(out.join('')).toBe('');
      expect(printed()).not.toContain(PATIENT_VALUE);
    });

    it('a short count keeps the old file when --force was given', async () => {
      await writeFile(file(), 'the old export');
      checks.heldItems
        .mockResolvedValueOnce({ items: items(0, 200), total: 450, next: 'K0200' })
        .mockResolvedValueOnce({ items: [], total: 450, next: null });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file(), force: true })).toBe(1);
      expect(err.join('')).toContain('200');
      expect(err.join('')).toContain('450');
      expect(await readFile(file(), 'utf8')).toBe('the old export');
      expect(await folder()).toEqual(['held.ndjson']);
    });

    it('writes one audit row for the whole export, not one per page, with no key, value or path', async () => {
      serve(450);
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect(mocks.recordCheckRead).toHaveBeenCalledTimes(1);
      expect(mocks.recordCheckRead.mock.calls[0]).toEqual([
        expect.objectContaining({ importChecks: checks }),
        expect.objectContaining({ actorType: 'cli' }),
        { pluginId: 'v1-check', copyId: 'c0ffee', kind: 'heldItems' },
      ]);
      expect(JSON.stringify(mocks.recordCheckRead.mock.calls)).not.toContain(PATIENT_VALUE);
      expect(JSON.stringify(mocks.recordCheckRead.mock.calls)).not.toContain(dir);
    });

    it('a row removed and a row added while it reads neither repeats nor skips a row it keeps', async () => {
      // Rows by key. Between the first and the second page, K0001 leaves and K00005 arrives before
      // it. Read by offset, the second page would start one row late.
      let rows = ['K0001', 'K0002', 'K0003', 'K0004'];
      checks.heldItems.mockImplementation(async (_p: string, _c: string, o: { after: string | null; limit: number }) => {
        const past = rows.filter((k) => o.after === null || k > o.after);
        const page = past.slice(0, o.limit);
        if (o.after === null) rows = ['K00005', ...rows.filter((k) => k !== 'K0001')];
        return {
          items: page.map((key) => ({ ...heldItem(1), key })), total: rows.length,
          next: past.length > o.limit ? page[page.length - 1]! : null,
        };
      });
      // A page of 200 reads all four at once, so ask the fake for two at a time by its own rule.
      const real = checks.heldItems.getMockImplementation()!;
      checks.heldItems.mockImplementation(async (p: string, c: string, o: { after: string | null; limit: number }) => real(p, c, { ...o, limit: 2 }));
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      const keys = (await readFile(file(), 'utf8')).trim().split('\n').map((l) => JSON.parse(l).key);
      expect(keys).toEqual(['K0001', 'K0002', 'K0003', 'K0004']);
    });

    it('stops when the service answers without a next, and the count check still holds', async () => {
      checks.heldItems.mockResolvedValueOnce({ items: items(0, 2), total: 2 });
      expect(await runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).toBe(0);
      expect(checks.heldItems).toHaveBeenCalledTimes(1);
    });

    it('a close that throws after a whole export does not remove the file', async () => {
      serve(2);
      mocks.createAppContext.mockResolvedValue({ importChecks: checks, close: async () => { throw new Error('close failed'); } });
      await expect(runImportCheckHeld('v1-check', 'c0ffee', { json: false, export: file() })).rejects.toThrow(/close failed/);
      expect((await readFile(file(), 'utf8')).trim().split('\n')).toHaveLength(2);
    });
  });
});

describe('command-meta rows for import check', () => {
  it('has the four commands, on the import key, and only held writes a file', () => {
    for (const p of ['import check start', 'import check status', 'import check stop', 'import check held']) {
      expect(COMMAND_META[p], p).toMatchObject({ kind: 'app', capability: 'connectors.manage' });
    }
    // A check start saves records, as import start does, so it needs the ingest key too.
    expect(COMMAND_META['import check start']!.alsoRequires).toEqual(['ingest.run']);
    expect(COMMAND_META['import check status']!.alsoRequires).toBeUndefined();
    expect(COMMAND_META['import check held']!.paths).toEqual([
      { target: '--export', kind: 'output-file', private: true, keepExistingUnless: '--force' },
    ]);
    expect(COMMAND_META['import check held']!.destructive).toBe(true);
    expect(COMMAND_META['import check status']!.destructive).toBeUndefined();
  });
});
