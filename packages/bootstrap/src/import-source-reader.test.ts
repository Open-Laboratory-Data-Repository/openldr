import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorDb } from './connector-db';
import { createSourceReader, matchPageKey, type PageResult } from './import-source-reader';

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
/** How `lost()` reads in the waiting state (R41). */
const LOST_TEXT = 'the source could not be reached: Connection lost - read ECONNRESET';
const STARTING_UP = 'the source may still be starting up: ';
/** What the connection pool really throws on a failed connect: the driver's words, no code, no number. */
const poolError = (message: string) => Object.assign(new Error(message), { name: 'TimeoutError' });

type Kind = 'keys' | 'details' | 'probe';
/** `{ throws }` throws a value that is not an Error, such as the array Kysely rejects with. */
type Answer = Array<Record<string, unknown>> | Error | { throws: unknown } | 'hang';

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
        if (a && !Array.isArray(a)) throw a.throws;
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
    expect(waiting).toEqual([{ attempt: 1, error: LOST_TEXT }, null]);
    // 5 s, in slices of at most 1 s so a stop is felt within a second.
    expect(sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(source.log.closes).toBe(1);
    // R40: every loss is followed by the SELECT 1 probe, on a connection of its own.
    expect(source.log.opens).toEqual([undefined, { queryTimeoutMs: 5000 }, undefined]);
    expect(keySizes(source)).toEqual([500, 500]);
  });

  it('a lost connection on open is retried the same way', async () => {
    const source = fakeSource();
    const realOpen = source.open.getMockImplementation()!;
    source.open.mockImplementationOnce(async () => { throw lost(); }).mockImplementation(realOpen);
    const { reader, waiting } = harness(source);
    expect((await reader.readPage(first)).kind).toBe('page');
    expect(waiting).toEqual([{ attempt: 1, error: LOST_TEXT }, null]);
  });

  it('keeps waiting until stopWanted, then reports stopped', async () => {
    // An outage: the key query and SELECT 1 both fail.
    const source = fakeSource((kind) => (kind === 'details' ? undefined : lost()));
    // stopWanted is asked before each 1 s slice. Waits of 5 s, then 10 s: 15 slices pass, and
    // the first check of the third wait asks to stop.
    const { reader, waiting, sleeps } = harness(source, 15);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(15_000);
    expect(sleeps.every((s) => s <= 1000)).toBe(true);
    // Three connections for the page, and one for each probe.
    expect(source.log.opens.filter((o) => o === undefined)).toHaveLength(3);
    expect(source.counts.probe).toBe(3);
    expect(keySizes(source)).toEqual([500, 500, 500]);
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
    // The timed-out connection is dropped and a new one opened, even though the probe answered.
    expect(source.log.opens).toEqual([undefined, { queryTimeoutMs: 5000 }, undefined]);
    expect(source.log.closes).toBe(1);
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
    expect(source.counts.details).toBe(0);
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

  it('with checkRowKeys, a row keyed as SQL Server matched it passes: another letter case, trailing spaces', async () => {
    const source = fakeSource((kind) => (kind === 'details'
      ? [{ RequestID: 'r001', Result: 'a' }, { RequestID: 'R002   ', Result: 'b' }, { RequestID: 'R003', Result: 'c' }]
      : undefined));
    const { reader } = harness(source);
    const page = await reader.readPage({ ...first, checkRowKeys: true });
    // The rows are handed back as the source spelled them. Filing is the caller's job.
    expect(page).toMatchObject({ kind: 'page', keys: ['R001', 'R002', 'R003'], rows: { results: [{ RequestID: 'r001' }, { RequestID: 'R002   ' }, { RequestID: 'R003' }] } });
  });

  it('with checkRowKeys, a row that matches two page keys once case is ignored is a refused error', async () => {
    const source = fakeSource((kind) => (kind === 'keys'
      ? [{ RequestID: 'ABC' }, { RequestID: 'abc' }]
      : [{ RequestID: 'Abc', Result: 'x' }]));
    const { reader } = harness(source);
    const failure = await reader.readPage({ ...first, checkRowKeys: true }).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/first column that is not a key of the page/);
    expect((failure as Error).message).not.toContain('Abc');
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

  it('a stop asked during a halving retry is honoured before the next query', async () => {
    const source = fakeSource((kind, sql) => (kind === 'keys' && sizeOf(sql) > 1 ? timeout() : undefined));
    // The first stopWanted call already asks to stop.
    const { reader, waiting } = harness(source, 0);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(keySizes(source)).toEqual([500]);
    expect(source.counts.probe).toBe(1);
    expect(waiting).toEqual([]);
  });

  it('a stop asked during the tries at a page of one is honoured before the next query', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? timeout() : undefined));
    // The first retry goes ahead. The second check asks to stop.
    const { reader } = harness(source, 1);
    expect(await reader.readPage({ ...first, size: 1 })).toEqual({ kind: 'stopped' });
    expect(source.counts.details).toBe(2);
  });

  it('error 245 with a row value is thrown without the value', async () => {
    const source = fakeSource((kind) => (kind === 'details'
      ? err('EREQUEST', "Conversion failed when converting the varchar value 'ZX-ROW-VALUE-4417' to data type int.", { number: 245 })
      : undefined));
    const { reader, waiting } = harness(source);
    const failure = await reader.readPage(first).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('the source refused the query (SQL Server error 245)');
    expect((failure as Error).message).not.toContain('ZX-ROW-VALUE-4417');
    expect(waiting).toEqual([]);
  });

  it('error 245 that is retried puts no row value in the waiting state', async () => {
    // No EREQUEST code, so it reads as lost and is retried. Its text still follows the number rule.
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n === 1
      ? Object.assign(new Error("Conversion failed when converting the varchar value 'ZX-ROW-VALUE-4417' to data type int."), { number: 245 })
      : undefined));
    const { reader, waiting } = harness(source);
    expect((await reader.readPage(first)).kind).toBe('page');
    expect(waiting).toEqual([{ attempt: 1, error: 'the source refused the query (SQL Server error 245)' }, null]);
    expect(JSON.stringify(waiting)).not.toContain('ZX-ROW-VALUE-4417');
  });

  it('error 208 keeps its table name', async () => {
    const source = fakeSource((kind) => (kind === 'keys'
      ? err('EREQUEST', "Invalid object name 'dbo.Requests'.", { number: 208 })
      : undefined));
    const { reader } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow("Invalid object name 'dbo.Requests'.");
  });

  it('a query that fails with several SQL Server errors is a thrown refused error, not a wait', async () => {
    // The shape Kysely's MSSQL driver rejects with: a plain array of tedious RequestErrors.
    const errors = [
      err('EREQUEST', "Invalid column name 'Resultt'.", { number: 207 }),
      err('EREQUEST', 'Statement(s) could not be prepared.', { number: 8180 }),
    ];
    const source = fakeSource((kind) => (kind === 'details' ? { throws: errors } : undefined));
    const { reader, waiting, sleeps } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow("Invalid column name 'Resultt'.");
    expect(waiting).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(source.counts.details).toBe(1);
  });

  it('a query that fails with 245 and 8180 throws no row value', async () => {
    const errors = [
      err('EREQUEST', "Conversion failed when converting the varchar value 'ZX-ROW-VALUE-4417' to data type int.", { number: 245 }),
      err('EREQUEST', 'Statement(s) could not be prepared.', { number: 8180 }),
    ];
    const source = fakeSource((kind) => (kind === 'keys' ? { throws: errors } : undefined));
    const { reader, waiting } = harness(source);
    const failure = await reader.readPage(first).catch((e: Error) => e);
    expect((failure as Error).message).toBe('the source refused the query (SQL Server error 245)');
    expect(waiting).toEqual([]);
  });

  it('close does not wait for a connection that never finishes closing', async () => {
    const source = fakeSource();
    const realOpen = source.open.getMockImplementation()!;
    source.open.mockImplementation(async (opts) => {
      const db = await realOpen(opts);
      return { query: db.query, close: () => new Promise<void>(() => undefined) };
    });
    const { reader } = harness(source);
    await reader.readPage(first);
    await expect(reader.close()).resolves.toBeUndefined();
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

// R45. After a restart SQL Server takes logins before its databases have recovered. A run that has
// read the source before waits on those errors, up to 12 tries in one readPage call.
describe('a source that may be starting up', () => {
  const sqlError = (number: number) => err('EREQUEST', `SQL Server error text ${number}`, { number });
  const readBefore = { ...first, readBefore: true };

  it.each([4060, 18456, 921, 922, 945, 6005, 17142, 17187, 18401])(
    'error %i is waited on when the run has read the source before',
    async (number) => {
      const source = fakeSource((kind, _sql, n) => (kind === 'keys' && n === 1 ? sqlError(number) : undefined));
      const { reader, waiting, sleeps } = harness(source);
      expect(await reader.readPage(readBefore)).toMatchObject({ kind: 'page', keys: SOURCE_KEYS, size: 500 });
      expect(waiting).toHaveLength(2);
      expect(waiting[0]!.attempt).toBe(1);
      expect(waiting[0]!.error.startsWith(STARTING_UP)).toBe(true);
      expect(waiting[1]).toBeNull();
      expect(sleeps.reduce((a, b) => a + b, 0)).toBe(5000);
      // Not a loss: no probe.
      expect(source.counts.probe).toBe(0);
    },
  );

  it('a refused login on open is waited on when the run has read the source before', async () => {
    const source = fakeSource();
    const realOpen = source.open.getMockImplementation()!;
    source.open.mockImplementationOnce(async () => { throw err('ELOGIN', "Login failed for user 'x'."); }).mockImplementation(realOpen);
    const { reader, waiting } = harness(source);
    expect((await reader.readPage(readBefore)).kind).toBe('page');
    expect(waiting).toEqual([{ attempt: 1, error: `${STARTING_UP}Login failed for user 'x'.` }, null]);
  });

  it('a login the pool refuses on open is waited on with the fixed sentence after the lead', async () => {
    const source = fakeSource();
    const realOpen = source.open.getMockImplementation()!;
    source.open.mockImplementationOnce(async () => { throw poolError("Login failed for user 'x'."); }).mockImplementation(realOpen);
    const { reader, waiting } = harness(source);
    expect((await reader.readPage(readBefore)).kind).toBe('page');
    expect(waiting).toEqual([{ attempt: 1, error: 'the source may still be starting up: the source refused the login' }, null]);
  });

  it('a new run with a wrong password fails at once', async () => {
    const source = fakeSource();
    source.open.mockImplementation(async () => { throw poolError("Login failed for user 'x'."); });
    const { reader, waiting, sleeps } = harness(source);
    await expect(reader.readPage({ ...first, readBefore: false })).rejects.toThrow(/^the source refused the login$/);
    expect(waiting).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(source.open).toHaveBeenCalledTimes(1);
  });

  it('a new run whose first query hits error 921 fails at once', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? sqlError(921) : undefined));
    const { reader, waiting } = harness(source);
    await expect(reader.readPage(first)).rejects.toThrow('the source refused the query (SQL Server error 921)');
    expect(waiting).toEqual([]);
  });

  it('a reader that has had one good query waits on its own, with no readBefore', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'keys' && n === 2 ? sqlError(18456) : undefined));
    const { reader, waiting } = harness(source);
    expect((await reader.readPage({ ...first, size: 1 })).kind).toBe('page');
    expect(await reader.readPage({ ...first, after: 'R001', size: 1 })).toMatchObject({ kind: 'page', keys: ['R002'] });
    expect(waiting).toEqual([{ attempt: 1, error: `${STARTING_UP}SQL Server error text 18456` }, null]);
  });

  it('fails after 12 tries in one readPage call', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? sqlError(921) : undefined));
    const { reader, waiting, sleeps } = harness(source);
    await expect(reader.readPage(readBefore)).rejects.toThrow(/^the source refused the query \(SQL Server error 921\)$/);
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(source.counts.keys).toBe(13);
    // 5, 10, 20, 40, 80, 160 s, then 300 s six times: about 35 minutes.
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(2_115_000);
  });

  it('the 12 tries are counted again on the next readPage call', async () => {
    // Key queries 1 to 12 fail, 13 answers; then 14 to 25 fail, 26 answers.
    const source = fakeSource((kind, _sql, n) => (kind === 'keys' && n !== 13 && n <= 25 ? sqlError(921) : undefined));
    const { reader } = harness(source);
    expect(await reader.readPage({ ...readBefore, size: 1 })).toMatchObject({ kind: 'page', keys: ['R001'] });
    expect(await reader.readPage({ ...readBefore, after: 'R001', size: 1 })).toMatchObject({ kind: 'page', keys: ['R002'] });
    expect(source.counts.keys).toBe(26);
  });

  it('a stop asked during such a wait returns stopped', async () => {
    const source = fakeSource((kind) => (kind === 'keys' ? sqlError(4060) : undefined));
    const { reader, waiting } = harness(source, 3);
    expect(await reader.readPage(readBefore)).toEqual({ kind: 'stopped' });
    expect(waiting).toHaveLength(1);
    expect(source.counts.keys).toBe(1);
  });

  it('a good page after a wait carries on, and the next page reads normally', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n === 1 ? sqlError(922) : undefined));
    const { reader, waiting } = harness(source);
    expect(await reader.readPage({ ...readBefore, size: 2 })).toMatchObject({ kind: 'page', keys: ['R001', 'R002'], size: 2 });
    expect(await reader.readPage({ ...readBefore, after: 'R002', size: 2 })).toMatchObject({ kind: 'page', keys: ['R003'] });
    expect(waiting.filter((w) => w !== null)).toHaveLength(1);
  });

  it('a missing table (208) still fails at once, even when read before', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? err('EREQUEST', "Invalid object name 'dbo.Results'.", { number: 208 }) : undefined));
    const { reader, waiting } = harness(source);
    await expect(reader.readPage(readBefore)).rejects.toThrow("Invalid object name 'dbo.Results'.");
    expect(waiting).toEqual([]);
  });

  it('a source restart: lost, then login refused, then good', async () => {
    // Trace C of the report: the server goes down, comes up refusing logins, then recovers.
    const source = fakeSource((kind, _sql, n) => {
      if (kind === 'probe') return lost();
      if (kind === 'keys' && n === 1) return lost();
      if (kind === 'keys' && n <= 3) return sqlError(18456);
      return undefined;
    });
    const { reader, waiting } = harness(source);
    expect(await reader.readPage(readBefore)).toMatchObject({ kind: 'page', size: 500 });
    const states = waiting.filter((w) => w !== null);
    expect(states.map((w) => w!.attempt)).toEqual([1, 2, 3]);
    expect(states[0]!.error).toBe(LOST_TEXT);
    expect(states[1]!.error.startsWith(STARTING_UP)).toBe(true);
    expect(states[2]!.error.startsWith(STARTING_UP)).toBe(true);
  });

  it('a starting-up wait is not a loss: it breaks a row of losses', async () => {
    const source = fakeSource((kind, _sql, n) => {
      if (kind === 'keys' && (n === 1 || n === 3)) return lost();
      if (kind === 'keys' && n === 2) return sqlError(921);
      return undefined;
    });
    const { reader } = harness(source);
    expect(await reader.readPage(readBefore)).toMatchObject({ kind: 'page', size: 500 });
    expect(keySizes(source)).toEqual([500, 500, 500, 500]);
  });
});

// R40. A page lost twice in a row, with the source still answering SELECT 1, is halved.
describe('a page that is lost again and again', () => {
  it('two losses with the probe answering halve the page, and the next wait is 5 s', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n <= 2 ? lost() : undefined));
    const { reader, waiting, sleeps } = harness(source);
    const page = await reader.readPage(first);
    expect(page).toMatchObject({ kind: 'page', size: 250, keys: SOURCE_KEYS });
    expect(keySizes(source)).toEqual([500, 500, 250]);
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 1]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(source.counts.probe).toBe(2);
  });

  it('one loss does not halve the page', async () => {
    const source = fakeSource((kind, _sql, n) => (kind === 'details' && n === 1 ? lost() : undefined));
    const { reader } = harness(source);
    expect(await reader.readPage(first)).toMatchObject({ kind: 'page', size: 500 });
    expect(keySizes(source)).toEqual([500, 500]);
  });

  it('a loss whose probe failed, between two counted losses, sets the count back to 0', async () => {
    const source = fakeSource((kind, _sql, n) => {
      if (kind === 'details' && n <= 3) return lost();
      if (kind === 'probe' && n === 2) return lost();
      return undefined;
    });
    const { reader, waiting } = harness(source);
    expect(await reader.readPage(first)).toMatchObject({ kind: 'page', size: 500 });
    expect(keySizes(source)).toEqual([500, 500, 500, 500]);
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 2, 3]);
  });

  it('a link that flaps halves down to 1, and the wait starts again at 5 s at each halving', async () => {
    // Trace B of the report: every detail query is lost while the page is above 31 keys' worth of
    // asking. The source holds 3 keys, so the size is read from the key query.
    let asked = 0;
    const source = fakeSource((kind, sql) => {
      if (kind === 'keys') { asked = sizeOf(sql); return undefined; }
      if (kind === 'details' && asked > 31) return lost();
      return undefined;
    });
    const { reader, waiting } = harness(source);
    expect(await reader.readPage(first)).toMatchObject({ kind: 'page', size: 31 });
    expect([...new Set(keySizes(source))]).toEqual([500, 250, 125, 62, 31]);
    // Each size is lost twice: the waits are tries 1 and 2, then 1 again after each halving.
    expect(waiting.filter((w) => w !== null).map((w) => w!.attempt)).toEqual([1, 1, 2, 1, 2, 1, 2, 1]);
  });

  it('at a page of 1 no key is skipped, however often the page is lost', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? lost() : undefined));
    const { reader, waiting } = harness(source, 400);
    expect(await reader.readPage({ ...first, size: 1 })).toEqual({ kind: 'stopped' });
    expect(keySizes(source).every((s) => s === 1)).toBe(true);
    expect(source.counts.details).toBeGreaterThan(5);
    // The wait keeps growing: no try number goes back to 1.
    const attempts = waiting.filter((w) => w !== null).map((w) => w!.attempt);
    expect(attempts).toEqual(attempts.map((_, i) => i + 1));
  });

  it('a stop asked during the wait after a halving returns stopped', async () => {
    const source = fakeSource((kind) => (kind === 'details' ? lost() : undefined));
    // The first wait takes 5 checks. The first check of the wait after the halving asks to stop.
    const { reader, waiting } = harness(source, 5);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(keySizes(source)).toEqual([500, 500]);
    expect(waiting).toEqual([{ attempt: 1, error: LOST_TEXT }, null, { attempt: 1, error: LOST_TEXT }]);
  });

  it('a lost link that is an outage never halves the page', async () => {
    // Trace A of the report: the page and the probe are both lost, again and again.
    const source = fakeSource(() => lost());
    const { reader } = harness(source, 300);
    expect(await reader.readPage(first)).toEqual({ kind: 'stopped' });
    expect(keySizes(source).every((s) => s === 500)).toBe(true);
  });
});

// R30. SQL Server's usual collation ignores letter case and trailing spaces, so a detail query's
// IN list also returns rows spelled another way. Those rows belong to the page key they matched.
describe('matchPageKey', () => {
  it('files rows keyed abc, ABC with trailing spaces and ABC under the page key ABC', () => {
    expect(['abc', 'ABC ', 'ABC', 'ABC   '].map((v) => matchPageKey(['ABC'], v))).toEqual(['ABC', 'ABC', 'ABC', 'ABC']);
  });

  it('prefers an exact match, so page keys abc and ABC each keep their own rows', () => {
    expect(matchPageKey(['abc', 'ABC'], 'abc')).toBe('abc');
    expect(matchPageKey(['abc', 'ABC'], 'ABC')).toBe('ABC');
  });

  it('returns null for a row that matches two page keys once case is ignored', () => {
    expect(matchPageKey(['abc', 'ABC'], 'Abc')).toBeNull();
  });

  // R30b. Trailing spaces are tried before case, so a case-sensitive source keeps abc and ABC apart.
  it('tries trailing spaces before case: abc and ABC on one page, a row abc with spaces is abc', () => {
    expect(matchPageKey(['abc', 'ABC'], 'abc ')).toBe('abc');
    expect(matchPageKey(['abc', 'ABC'], 'ABC   ')).toBe('ABC');
    // With no space match, case folding still applies.
    expect(matchPageKey(['ABC', 'DEF'], 'abc ')).toBe('ABC');
  });

  it('a step that matches two page keys is a fault at that step, and case is not tried', () => {
    // Both trim to the same text. Folding case would not tell them apart either way.
    expect(matchPageKey(['AB', 'AB '], 'AB  ')).toBeNull();
  });

  it('removes a long run of trailing spaces in one pass', () => {
    const spaces = ' '.repeat(200_000);
    const started = Date.now();
    expect(matchPageKey(['ABC'], `abc${spaces}`)).toBe('ABC');
    // A run of spaces that does not end the string: none are trailing, so nothing matches.
    expect(matchPageKey(['ABC'], `ABC${spaces}x`)).toBeNull();
    // A backtracking pattern takes seconds or more on this; a loop takes milliseconds.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('returns null for a row that matches no page key', () => {
    expect(matchPageKey(['ABC'], 'ABD')).toBeNull();
    // Leading spaces count, as they do in SQL Server.
    expect(matchPageKey(['ABC'], ' ABC')).toBeNull();
    expect(matchPageKey([], 'ABC')).toBeNull();
  });

  it('folds ASCII letters only', () => {
    expect(matchPageKey(['STRASSE'], 'straße')).toBeNull();
    expect(matchPageKey(['É1'], 'é1')).toBeNull();
  });

  it('answers the same after the page keys array is reused', () => {
    const keys = ['K1', 'K2'];
    expect(matchPageKey(keys, 'k1')).toBe('K1');
    expect(matchPageKey(keys, 'k2 ')).toBe('K2');
    expect(matchPageKey(keys, 'k3')).toBeNull();
  });
});
