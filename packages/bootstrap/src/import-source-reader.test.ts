import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorDb } from './connector-db';
import { createSourceReader, type PageResult } from './import-source-reader';

// Layer: the reader's own rules, over a fake ConnectorDb and a fake sleep. It proves which
// statements run, in what order, at what page size, and when the reader waits, halves, skips
// or throws. It does not prove that a real SQL Server, pg or mysql2 connection raises these
// errors, or that a real 5-second limit is kept by a real driver.

const KEY_SQL = 'SELECT TOP ({{limit}}) [RequestID], [Received] FROM [dbo].[Requests] WHERE [RequestID] > {{after}} ORDER BY [RequestID]';
const DETAIL_SQL = 'SELECT [RequestID], [Result], [Taken] FROM [dbo].[Results] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID], [Seq]';
const DETAILS = [{ name: 'results', sql: DETAIL_SQL }];
const PROBE = 'SELECT 1';

const SOURCE_KEYS = ['R001', 'R002', 'R003'];
const RECEIVED = new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6));

function err(code: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { code, ...extra });
}
const timeout = () => err('ETIMEOUT', 'Timeout: Request failed to complete in 30000ms');
const lost = () => err('ESOCKET', 'Connection lost - read ECONNRESET');

type Kind = 'keys' | 'details' | 'probe';
type Answer = Array<Record<string, unknown>> | Error | 'hang';

/** What the source holds, read the way the SQL above asks for it. */
function realKeys(sql: string): Array<Record<string, unknown>> {
  const limit = Number(/TOP \((\d+)\)/.exec(sql)?.[1]);
  const after = /> '([^']*)'/.exec(sql)?.[1] ?? '';
  return SOURCE_KEYS.filter((k) => k > after).slice(0, limit).map((k) => ({ RequestID: k, Received: RECEIVED }));
}
function realDetails(sql: string): Array<Record<string, unknown>> {
  const wanted = [...sql.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  return wanted.map((k) => ({ RequestID: k, Result: `pos-${k}`, Taken: RECEIVED }));
}

function sizeOf(sql: string): number {
  return Number(/TOP \((\d+)\)/.exec(sql)?.[1]);
}

/**
 * A source whose answers the test decides. `answer` returns undefined to give the real rows.
 * Every open, query and close is logged.
 */
function fakeSource(answer: (kind: Kind, sql: string, n: number) => Answer | undefined = () => undefined) {
  const log = {
    opens: [] as Array<{ queryTimeoutMs?: number } | undefined>,
    queries: [] as Array<{ kind: Kind; sql: string }>,
    closes: 0,
    probeCloses: 0,
  };
  const counts: Record<Kind, number> = { keys: 0, details: 0, probe: 0 };
  const open = vi.fn(async (opts?: { queryTimeoutMs?: number }): Promise<ConnectorDb> => {
    log.opens.push(opts);
    const isProbe = opts?.queryTimeoutMs === 5000;
    return {
      async query(sql: string) {
        const kind: Kind = sql === PROBE ? 'probe' : sql.includes('IN (') ? 'details' : 'keys';
        log.queries.push({ kind, sql });
        counts[kind] += 1;
        const a = answer(kind, sql, counts[kind]);
        if (a === 'hang') return new Promise<never>(() => undefined);
        if (a instanceof Error) throw a;
        if (a) return { rows: a };
        if (kind === 'probe') return { rows: [{ '': 1 }] };
        return { rows: kind === 'keys' ? realKeys(sql) : realDetails(sql) };
      },
      async close() {
        if (isProbe) log.probeCloses += 1;
        else log.closes += 1;
      },
    };
  });
  return { open, log, counts };
}

function harness(source: ReturnType<typeof fakeSource>, stopAfterChecks = Number.POSITIVE_INFINITY) {
  const waiting: Array<{ attempt: number; error: string } | null> = [];
  const sleeps: number[] = [];
  let checks = 0;
  const reader = createSourceReader({
    open: source.open,
    onWaiting: async (state) => { waiting.push(state); },
    stopWanted: async () => { checks += 1; return checks > stopAfterChecks; },
    clean: (text) => text.replace(/hunter2/g, '***').slice(0, 300),
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { reader, waiting, sleeps };
}

const first = { keySql: KEY_SQL, details: DETAILS, after: null, size: 500 };

function keySizes(source: ReturnType<typeof fakeSource>): number[] {
  return source.log.queries.filter((q) => q.kind === 'keys').map((q) => sizeOf(q.sql));
}

afterEach(() => { vi.useRealTimers(); });

describe('createSourceReader', () => {
  it('reads the keys, then every detail query for those keys', async () => {
    const source = fakeSource();
    const { reader, waiting } = harness(source);
    const page = await reader.readPage({ ...first, after: 'R001', size: 2 });
    expect(page).toEqual({
      kind: 'page',
      keys: ['R002', 'R003'],
      keyRows: [
        { RequestID: 'R002', Received: '2024-01-02T03:04:05.006' },
        { RequestID: 'R003', Received: '2024-01-02T03:04:05.006' },
      ],
      rows: {
        results: [
          { RequestID: 'R002', Result: 'pos-R002', Taken: '2024-01-02T03:04:05.006' },
          { RequestID: 'R003', Result: 'pos-R003', Taken: '2024-01-02T03:04:05.006' },
        ],
      },
      size: 2,
    });
    expect(source.log.queries.map((q) => q.kind)).toEqual(['keys', 'details']);
    expect(source.log.queries[0].sql).toContain("> 'R001'");
    expect(source.log.queries[1].sql).toContain("IN ('R002', 'R003')");
    expect(source.log.opens).toEqual([undefined]);
    expect(waiting).toEqual([]);
  });

  it('keeps one connection across pages and closes it on close', async () => {
    const source = fakeSource();
    const { reader } = harness(source);
    await reader.readPage({ ...first, size: 1 });
    await reader.readPage({ ...first, after: 'R001', size: 1 });
    expect(source.open).toHaveBeenCalledTimes(1);
    await reader.close();
    expect(source.log.closes).toBe(1);
  });

  it('reports end when the key query returns no keys', async () => {
    const source = fakeSource();
    const { reader } = harness(source);
    expect(await reader.readPage({ ...first, after: 'R003' })).toEqual({ kind: 'end' });
    expect(source.log.queries.map((q) => q.kind)).toEqual(['keys']);
  });

  it('a lost connection closes the connection, waits, opens a new one and reads the same page', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n === 1 ? lost() : undefined));
    const { reader, waiting, sleeps } = harness(source);
    const page = await reader.readPage(first);
    expect(page.kind).toBe('page');
    expect((page as Extract<PageResult, { kind: 'page' }>).keys).toEqual(SOURCE_KEYS);
    expect(waiting).toEqual([{ attempt: 1, error: 'Connection lost - read ECONNRESET' }, null]);
    // 5 s, in slices of at most 1 s so a stop is felt within a second.
    expect(sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(source.log.closes).toBe(1);
    expect(source.log.opens).toEqual([undefined, undefined]);
    expect(keySizes(source)).toEqual([500, 500]);
  });

  it('a lost connection on open is retried the same way', async () => {
    const source = fakeSource();
    const realOpen = source.open.getMockImplementation()!;
    source.open.mockImplementationOnce(async () => { throw lost(); }).mockImplementation(realOpen);
    const { reader, waiting } = harness(source);
    expect((await reader.readPage(first)).kind).toBe('page');
    expect(waiting).toEqual([{ attempt: 1, error: 'Connection lost - read ECONNRESET' }, null]);
  });

  it('keeps waiting until stopWanted, then reports stopped', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? lost() : undefined));
    // stopWanted is asked before each 1 s slice. Waits of 5 s, then 10 s: 15 slices pass, and
    // the first check of the third wait asks to stop.
    const { reader, waiting, sleeps } = harness(source, 15);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(15_000);
    expect(sleeps.every((s) => s <= 1000)).toBe(true);
    expect(source.open).toHaveBeenCalledTimes(3);
  });

  it('a refused error is thrown to the caller', async () => {
    const source = fakeSource((kind) => (kind === 'details'
      ? err('EREQUEST', "Invalid object name 'dbo.Results'. Password hunter2.", { number: 208 })
      : undefined));
    const { reader, waiting, sleeps } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow("Invalid object name 'dbo.Results'. Password ***.");
    expect(waiting).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('a refused login on open is thrown to the caller', async () => {
    const source = fakeSource();
    source.open.mockImplementationOnce(async () => { throw err('ELOGIN', "Login failed for user 'x'."); });
    const { reader, waiting } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow("Login failed for user 'x'.");
    expect(waiting).toEqual([]);
  });

  it('a timed-out page is read again at half the size when the source still answers', async () => {
    const source = fakeSource((kind, sql) => (kind === 'keys' && sizeOf(sql) > 250 ? timeout() : undefined));
    const { reader, waiting, sleeps } = harness(source);
    const page = await reader.readPage(first);
    expect(page).toMatchObject({ kind: 'page', size: 250, keys: SOURCE_KEYS });
    expect(keySizes(source)).toEqual([500, 250]);
    expect(source.log.opens).toEqual([undefined, { queryTimeoutMs: 5000 }]);
    expect(source.counts.probe).toBe(1);
    expect(source.log.probeCloses).toBe(1);
    expect(waiting).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('a timed-out detail query halves the page too', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n === 1 ? timeout() : undefined));
    const { reader } = harness(source);
    expect(await reader.readPage(first)).toMatchObject({ kind: 'page', size: 250 });
    expect(keySizes(source)).toEqual([500, 250]);
  });

  it('a timeout with a source that does not answer is a lost connection, and the page size stays', async () => {
    const source = fakeSource((kind, _sql, n) => {
      if (kind === 'keys' && n === 1) return timeout();
      if (kind === 'probe') return lost();
      return undefined;
    });
    const { reader, waiting, sleeps } = harness(source);
    const page = await reader.readPage(first);
    expect(page).toMatchObject({ kind: 'page', size: 500 });
    expect(keySizes(source)).toEqual([500, 500]);
    expect(waiting).toEqual([{ attempt: 1, error: 'Timeout: Request failed to complete in 30000ms' }, null]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(5000);
    expect(source.log.closes).toBe(1);
    expect(source.log.probeCloses).toBe(1);
  });

  it('a probe with no answer in 5 seconds makes the timeout a lost connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = fakeSource((kind, _sql, n) => {
      if (kind === 'keys' && n === 1) return timeout();
      if (kind === 'probe') return 'hang';
      return undefined;
    });
    const { reader, waiting } = harness(source);
    const pending = reader.readPage(first);
    await vi.advanceTimersByTimeAsync(4999);
    expect(waiting).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const page = await pending;
    expect(page).toMatchObject({ kind: 'page', size: 500 });
    expect(waiting[0]).toEqual({ attempt: 1, error: 'Timeout: Request failed to complete in 30000ms' });
    expect(source.log.probeCloses).toBe(1);
  });

  it('an outage never skips a key', async () => {
    // Every query times out, SELECT 1 too.
    const source = fakeSource(() => timeout());
    const { reader, waiting } = harness(source, 200);
    expect(await reader.readPage({ ...first, size: 1 })).toEqual({ kind: 'stopped' });
    expect(keySizes(source).every((s) => s === 1)).toBe(true);
    expect(waiting.filter((w) => w !== null).length).toBeGreaterThan(3);
  });

  it('an outage after the keys are read never skips a key, even at a page of 1', async () => {
    // The key query answers. Then the link drops: details and SELECT 1 time out.
    const source = fakeSource((kind) => (kind === 'keys' ? undefined : timeout()));
    const { reader, waiting } = harness(source, 200);
    const result = await reader.readPage({ ...first, size: 1 });
    expect(result).toEqual({ kind: 'stopped' });
    expect(source.counts.details).toBeGreaterThan(3);
    expect(keySizes(source).every((s) => s === 1)).toBe(true);
    // Waits of 5, 10, 20, 40 and 80 s take 155 checks. The stop lands inside the sixth wait.
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('an outage at a page of 500 keeps the size at 500', async () => {
    const source = fakeSource(() => timeout());
    const { reader } = harness(source, 50);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(keySizes(source).every((s) => s === 500)).toBe(true);
  });

  it('a key that times out 3 times at a page of 1 is reported as skipped', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? timeout() : undefined));
    const { reader, waiting, sleeps } = harness(source);
    expect(await reader.readPage({ ...first, after: 'R001', size: 1 })).toEqual({ kind: 'skipped', key: 'R002' });
    expect(source.counts.details).toBe(3);
    expect(source.counts.probe).toBe(3);
    expect(waiting).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('a slow key at a page of 4 is halved down to 1, then skipped', async () => {
    const source = fakeSource((kind, sql) => (kind === 'details' && sql.includes("'R001'") ? timeout() : undefined));
    const { reader } = harness(source);
    expect(await reader.readPage({ ...first, size: 4 })).toEqual({ kind: 'skipped', key: 'R001' });
    expect(keySizes(source)).toEqual([4, 2, 1, 1, 1]);
  });

  it('a key query that times out at a page of 1 is retried, not skipped', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'keys' && n <= 4 ? timeout() : undefined));
    const { reader, waiting } = harness(source);
    const page = await reader.readPage({ ...first, size: 1 });
    expect(page).toMatchObject({ kind: 'page', keys: ['R001'], size: 1 });
    expect(source.counts.keys).toBe(5);
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3, 4]);
  });

  it('a detail row whose first column is not a key of the page is a refused error', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? [{ RequestID: 'R999', Result: 'x' }] : undefined));
    const { reader, waiting } = harness(source);
    const failure = await reader.readPage({ ...first, checkRowKeys: true }).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/first column/);
    expect((failure as Error).message).not.toContain('R999');
    expect(waiting).toEqual([]);
  });

  it('with checkRowKeys off, a row whose first column is not a key passes through', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? [{ Other: 'R999', Result: 'x' }] : undefined));
    const { reader } = harness(source);
    const page = await reader.readPage(first);
    expect(page).toMatchObject({ kind: 'page', rows: { results: [{ Other: 'R999', Result: 'x' }] } });
  });

  it('checks every statement is one SELECT before it runs', async () => {
    const bad = [
      { keySql: 'DELETE FROM [dbo].[Requests] WHERE [RequestID] > {{after}} AND 1 = {{limit}}', details: DETAILS },
      { keySql: KEY_SQL, details: [{ name: 'results', sql: 'SELECT * INTO [dbo].[Copy] FROM [dbo].[Results] WHERE [RequestID] IN ({{keys}})' }] },
      { keySql: KEY_SQL, details: [{ name: 'results', sql: `${DETAIL_SQL}; DROP TABLE [dbo].[Results]` }] },
    ];
    for (const b of bad) {
      const source = fakeSource();
      const { reader } = harness(source);
      await expect(reader.readPage({ ...b, after: null, size: 500 })).rejects.toThrow();
      expect(source.log.queries).toEqual([]);
      expect(source.open).not.toHaveBeenCalled();
    }
  });

  it('a key that is not safe is thrown as it is, not retried', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? [{ RequestID: 'Ré' }] : undefined));
    const { reader, waiting } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow(/printable ASCII/);
    expect(waiting).toEqual([]);
    expect(source.counts.keys).toBe(1);
  });

  it('a key query that makes no progress past the last key is thrown', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? [{ RequestID: 'R002' }] : undefined));
    const { reader, waiting } = harness(source);
    await expect(reader.readPage({ ...first, after: 'R002' })).rejects.toThrow('the key query made no progress past the last key');
    expect(waiting).toEqual([]);
  });

  it('the error handed to onWaiting has been through clean', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'keys' && n === 1
      ? err('ESOCKET', `Connection to sa:hunter2@db lost ${'x'.repeat(400)}`)
      : undefined));
    const { reader, waiting } = harness(source);
    await reader.readPage(first);
    const state = waiting[0]!;
    expect(state.error).not.toContain('hunter2');
    expect(state.error).toContain('sa:***@db');
    expect(state.error.length).toBe(300);
  });
});
