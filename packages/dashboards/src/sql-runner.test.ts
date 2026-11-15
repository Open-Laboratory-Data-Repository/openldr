import { describe, it, expect, vi } from 'vitest';
import {
  CompiledQuery, Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler, PostgresAdapter,
  PostgresIntrospector, PostgresQueryCompiler, type DatabaseConnection, type Driver, type QueryResult,
} from 'kysely';
import { validateSelectSql, validateSelectSqlForSave, runSqlQuery, runReadQuery, planPagination, SQL_CHECK_WORDS_FOR_TESTS } from './sql-runner';

// --- Fake Kysely db/executor for driving runSqlQuery's `sql`/`sql.raw` calls through the
// transaction. Mirrors just enough of kysely's RawBuilder.execute() contract (getExecutor() →
// transformQuery() → compileQuery() → executeQuery()) to record the exact SQL text issued,
// without depending on kysely's real dialect compilers. Only RawNode + immediate ValueNode
// (what `sql` tags / `sql.lit` / `sql.raw` produce) need to be rendered.
interface FakeOpNode {
  kind: string;
  sqlFragments?: readonly string[];
  parameters?: readonly FakeOpNode[];
  value?: unknown;
}

function renderNode(node: FakeOpNode): string {
  // `sql.lit(x)` (used to inline the timeout) is itself a RawBuilder, so it arrives here as a
  // nested RawNode wrapping a ValueNode (`sql.lit`'s `toOperationNode()`), not a bare ValueNode.
  if (node.kind === 'RawNode') return compileRawNode(node);
  if (node.kind === 'ValueNode') return String(node.value);
  throw new Error(`fake compiler: unsupported node kind ${node.kind}`);
}

function compileRawNode(node: FakeOpNode): string {
  const fragments = node.sqlFragments ?? [];
  const params = node.parameters ?? [];
  let out = fragments[0] ?? '';
  for (let i = 0; i < params.length; i++) out += renderNode(params[i]) + (fragments[i + 1] ?? '');
  return out;
}

function makeFakeDb(
  rows: Record<string, unknown>[],
  version = '',
): { db: any; executed: string[] } {
  const executed: string[] = [];
  const executor = {
    transformQuery: (node: FakeOpNode) => node,
    compileQuery: (node: FakeOpNode) => ({ sql: compileRawNode(node), parameters: [], query: node }),
    executeQuery: async (compiledQuery: { sql: string }) => {
      executed.push(compiledQuery.sql);
      // Serve version() (the mysql/mariadb per-statement-timeout variant detection) from the
      // configured string; every other query returns the configured rows.
      if (/version\(\)/i.test(compiledQuery.sql)) return { rows: [{ v: version }] };
      return { rows };
    },
  };
  const trx = {
    getExecutor: () => executor,
    executeQuery: executor.executeQuery,
    rollback: () => ({ execute: async () => {} }),
  };
  const db = {
    transaction: () => ({ execute: (cb: (trx: unknown) => unknown) => cb(trx) }),
    // The mssql arm opens a rolled-back transaction on one connection.
    connection: () => ({
      execute: (cb: (one: unknown) => unknown) => cb({ startTransaction: () => ({ execute: async () => trx }) }),
    }),
  };
  return { db, executed };
}

// --- A real Kysely over a fake driver with a pool of ONE connection. It records what each
// request is, and models the server's transaction state on that connection. Because the pool has
// one connection, a connection that is never given back makes the next query fail at once.
type Trail = string;

interface FakeServer {
  rows?: Record<string, unknown>[];
  /** Fail a statement. `endsTransaction` models SQL Server ending the transaction by itself. */
  failQuery?: (sql: string) => { error: Error; endsTransaction?: boolean } | undefined;
  /** Fail the roll-back request itself, whatever the transaction state. */
  failRollback?: () => Error | undefined;
  /** Model `resetConnectionsOnRelease: true`: the reset on release ends an open transaction. */
  resetOnRelease?: boolean;
}

function recordingDb(dialect: 'mssql' | 'postgres', server: FakeServer = {}) {
  const trail: Trail[] = [];
  const state = { leased: false, inTransaction: false, acquiredInTransaction: [] as boolean[] };
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      trail.push(q.sql);
      const fail = server.failQuery?.(q.sql);
      if (fail) {
        if (fail.endsTransaction) state.inTransaction = false;
        throw fail.error;
      }
      return { rows: (server.rows ?? []) as R[] };
    },
    async *streamQuery() { throw new Error('fake driver: not used'); },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      if (state.leased) throw new Error('fake pool: the only connection was never given back');
      state.leased = true;
      state.acquiredInTransaction.push(state.inTransaction);
      trail.push('acquire');
      return connection;
    },
    async beginTransaction() {
      trail.push('begin');
      if (state.inTransaction) throw new Error('fake server: a transaction is already open');
      state.inTransaction = true;
    },
    async commitTransaction() { trail.push('commit'); state.inTransaction = false; },
    async rollbackTransaction() {
      trail.push('rollback');
      const failure = server.failRollback?.();
      if (failure) throw failure;
      if (!state.inTransaction) throw new Error('3903: the ROLLBACK TRANSACTION request has no corresponding BEGIN TRANSACTION');
      state.inTransaction = false;
    },
    async releaseConnection() {
      trail.push('release');
      if (server.resetOnRelease) state.inTransaction = false;
      state.leased = false;
    },
    async destroy() {},
  };
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => (dialect === 'mssql' ? new MssqlAdapter() : new PostgresAdapter()),
      createDriver: () => driver,
      createQueryCompiler: () => (dialect === 'mssql' ? new MssqlQueryCompiler() : new PostgresQueryCompiler()),
      createIntrospector: (k) => (dialect === 'mssql' ? new MssqlIntrospector(k) : new PostgresIntrospector(k)),
    },
  });
  return { db, trail, state };
}

const RUN = { timeoutMs: 5000, rowCap: 10 };

describe('validateSelectSqlForSave', () => {
  it('accepts a single SELECT', () => { expect(() => validateSelectSqlForSave('SELECT 1')).not.toThrow(); });
  it('accepts a CTE (WITH)', () => { expect(() => validateSelectSqlForSave('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow(); });
  it('rejects INSERT', () => { expect(() => validateSelectSqlForSave('INSERT INTO x VALUES (1)')).toThrow(); });
  it('rejects UPDATE/DELETE/DROP', () => {
    for (const s of ['UPDATE x SET a=1', 'DELETE FROM x', 'DROP TABLE x']) expect(() => validateSelectSqlForSave(s)).toThrow();
  });
  it('rejects multiple statements', () => { expect(() => validateSelectSqlForSave('SELECT 1; DROP TABLE x')).toThrow(); });
  it('strips a trailing comment so it does not smuggle a second statement', () => { expect(() => validateSelectSqlForSave('SELECT 1 -- ; DROP')).not.toThrow(); });
  it('rejects SELECT ... INTO (creates a table — not read-only)', () => {
    expect(() => validateSelectSqlForSave('SELECT * INTO shadow FROM t')).toThrow();
    expect(() => validateSelectSqlForSave('select id into #tmp from t')).toThrow();
  });
  it('allows "into" inside a string literal (not a false positive)', () => {
    expect(() => validateSelectSqlForSave("SELECT 'convert this into that' as note")).not.toThrow();
  });
  it('reads a comment marker inside a string as text, so a second statement is still found', () => {
    expect(() => validateSelectSqlForSave("SELECT '--', 1; SELECT 2")).toThrow('only a single statement is allowed');
  });
  it('refuses a string that is never closed', () => {
    expect(() => validateSelectSqlForSave("SELECT 'abc")).toThrow();
  });
});

describe('validateSelectSql and the dialect', () => {
  it('reads the text by the engine it is given', () => {
    expect(() => validateSelectSql("SELECT [it's] FROM t", 'mssql')).not.toThrow();
    expect(() => validateSelectSql("SELECT $$it's$$ AS a", 'postgres')).not.toThrow();
    expect(() => validateSelectSql("SELECT 'it\\'s' AS a", 'mysql')).not.toThrow();
    expect(() => validateSelectSql('SELECT ["]; SELECT 2; SELECT ["]', 'mssql')).toThrow();
  });
  it('the save form passes when one engine would accept the text', () => {
    expect(() => validateSelectSqlForSave("SELECT [it's] FROM t")).not.toThrow();
    expect(() => validateSelectSqlForSave("SELECT $$it's$$ AS a")).not.toThrow();
    expect(() => validateSelectSqlForSave("SELECT 1 # don't\n")).not.toThrow();
  });
  it('the save form throws the error from the postgres reading', () => {
    const message = (fn: () => void) => { try { fn(); return ''; } catch (e) { return String(e); } };
    expect(message(() => validateSelectSqlForSave("SELECT 'abc"))).toBe(message(() => validateSelectSql("SELECT 'abc", 'postgres')));
    expect(message(() => validateSelectSqlForSave("SELECT 'abc"))).not.toBe('');
  });
  it('the save form throws the postgres reading\'s error when the readings fail differently', () => {
    const message = (fn: () => void) => { try { fn(); return ''; } catch (e) { return String(e); } };
    const text = "SELECT 1; SELECT 'a\\'";
    const save = message(() => validateSelectSqlForSave(text));
    expect(save).not.toBe('');
    expect(save).toBe(message(() => validateSelectSql(text, 'postgres')));
    expect(save).not.toBe(message(() => validateSelectSql(text, 'mysql')));
  });
  it('the save form still refuses what every engine refuses', () => {
    expect(() => validateSelectSqlForSave("SELECT 'abc")).toThrow();
    expect(() => validateSelectSqlForSave("SELECT '--', 1; SELECT 2")).toThrow();
    expect(() => validateSelectSqlForSave('DROP TABLE t')).toThrow();
  });
});

// Task 1's real run on SQL Server 2025 found `load` and `dump` are not reserved, so they are not here.
const STATEMENT_WORDS = ['exec', 'execute', 'waitfor', 'dbcc', 'backup', 'restore', 'shutdown', 'kill', 'deny',
  'declare', 'set', 'reconfigure', 'begin', 'commit', 'rollback', 'save', 'if', 'while', 'print', 'raiserror',
  'goto', 'return', 'open', 'close', 'deallocate', 'checkpoint', 'bulk', 'writetext', 'updatetext', 'readtext',
  'setuser', 'revert', 'add'];

const MSSQL_REFUSAL = 'only read-only SELECT queries are allowed on SQL Server (statement words such as EXEC are refused; put a name that is such a word in [brackets])';

describe('validateSelectSql on SQL Server', () => {
  it.each(STATEMENT_WORDS)('mssql refuses the statement word %s', (w) => {
    expect(() => validateSelectSql(`SELECT 1 AS x ${w.toUpperCase()} something`, 'mssql')).toThrow();
  });
  it.each(STATEMENT_WORDS)('other dialects keep %s as a name', (w) => {
    expect(() => validateSelectSql(`SELECT ${w} FROM t`, 'postgres')).not.toThrow();
    expect(() => validateSelectSqlForSave(`SELECT ${w} FROM t`)).not.toThrow();
  });
  it.each(STATEMENT_WORDS)('mysql keeps %s as a name', (w) => {
    expect(() => validateSelectSql(`SELECT ${w} FROM t`, 'mysql')).not.toThrow();
  });
  it.each(['load', 'dump'])('mssql keeps %s as a name', (w) => {
    expect(() => validateSelectSql(`SELECT ${w} FROM ${w}`, 'mssql')).not.toThrow();
  });
  it.each([
    "SELECT * FROM OPENQUERY(lnk, 'select 1')", "SELECT * FROM OPENROWSET('a','b','c')",
    "SELECT * FROM OPENDATASOURCE('a','b').x.dbo.t", 'SELECT * FROM OPENXML(1, 2)',
    'SELECT 1 AS x USE other', 'SELECT * FROM t x DISABLE TRIGGER trg ON t',
    'SELECT * FROM t x ENABLE TRIGGER trg ON t', 'SELECT NEXT VALUE FOR dbo.seq',
    'SELECT a FROM t OPTION (USE hints)', 'SELECT 1 AS x USE',
    'SELECT NEXT /* c */ VALUE\n  FOR dbo.seq', 'SELECT 1 AS x\nEXEC p', 'SELECT 1 AS x [a]exec p',
  ])('mssql refuses %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).toThrow(); });
  it.each([
    'SELECT [open], open_date, [set] FROM t', 'SELECT * FROM ##open', 'SELECT @set AS a',
    "SELECT 'please exec this' AS a", 'SELECT 1 -- exec later', "SELECT a FROM t OPTION (USE HINT('X'))",
    'SELECT a FROM t OPTION (USE PLAN N\'<p/>\')', 'SELECT a FROM t ORDER BY a OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
    'SELECT CASE WHEN a = 1 THEN 2 END FROM t', 'SELECT enable, disable, next, value FROM t',
    'SELECT * FROM OPENJSON(@j)', 'SELECT open$x, x$open, open1, _open, opened FROM t',
    'SELECT 1 /* exec p */ AS a', 'SELECT [exec] FROM t', 'SELECT a FROM t OPTION (use\n  hint (\'X\'))',
  ])('mssql allows %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).not.toThrow(); });

  it('refuses with one fixed sentence that holds none of the SQL', () => {
    for (const q of ['SELECT 1 AS x EXEC secret_proc', "SELECT * FROM OPENQUERY(lnk, 'x')", 'SELECT 1 AS x USE secret_db']) {
      let message = '';
      try { validateSelectSql(q, 'mssql'); } catch (e) { message = (e as Error).message; }
      expect(message).toBe(MSSQL_REFUSAL);
    }
  });

  it('the save form applies the SQL Server rule in its mssql reading', () => {
    // Postgres and MySQL read `'s] ...` as a string that is never closed, so only the mssql
    // reading can pass this text. That reading refuses EXEC.
    expect(() => validateSelectSqlForSave("SELECT [it's] AS a")).not.toThrow();
    expect(() => validateSelectSqlForSave("SELECT [it's] AS a EXEC p")).toThrow();
  });
});

describe('a statement word right after a number, on mssql', () => {
  it.each([
    'SELECT 1KILL 55', "SELECT 1WAITFOR DELAY '00:00:05'", 'SELECT 1EEXEC p', 'SELECT 10EXEC p',
    'SELECT 1DELETE FROM t', 'SELECT 1INTO x FROM t', 'SELECT 1UPDATE t SET a = 1', 'SELECT $1EXEC p',
    'SELECT 1DISABLE TRIGGER trg ON t', 'SELECT 1USE other',
  ])('refuses %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).toThrow(); });
  it.each([
    'SELECT 1FROM t', 'SELECT 1KILLS FROM t', 'SELECT a1exec FROM t', 'SELECT _1exec FROM t',
    'SELECT #1exec FROM t', 'SELECT 1e5 AS x', 'SELECT 0x1F AS x',
  ])('allows %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).not.toThrow(); });
  it('the save form accepts it, because mysql reads 1DELETE as a name, and the postgres reading refuses it', () => {
    expect(() => validateSelectSqlForSave('SELECT 1DELETE FROM t')).not.toThrow(); // mysql reads 1DELETE as a name
    expect(() => validateSelectSql('SELECT 1DELETE FROM t', 'postgres')).toThrow();
  });
});

describe('a binary literal on mssql', () => {
  it.each([
    'SELECT 0xADD AS b', 'SELECT 0x0DBCC AS b', 'SELECT 0x AS b', 'SELECT 0x1F AS b',
    'SELECT 0x1DELETE FROM t', 'SELECT 0x1EXEC p', 'SELECT 0X0ADD AS b',
  ])('allows %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).not.toThrow(); });
  it.each([
    'SELECT 0x1KILL 55', 'SELECT 0xFFWAITFOR DELAY \'00:00:01\'', 'SELECT 0xGO_SET', 'SELECT 0x1 EXEC p',
  ])('handles %s by the rule', (q) => {
    const refused = !['SELECT 0xGO_SET'].includes(q);
    if (refused) expect(() => validateSelectSql(q, 'mssql')).toThrow();
    else expect(() => validateSelectSql(q, 'mssql')).not.toThrow();
  });
});

describe('pair words and the characters between them, on mssql', () => {
  it.each([
    'SELECT * FROM t x DISABLE\u001fTRIGGER trg ON t',
    'SELECT NEXT\u0085VALUE FOR dbo.seq',
    'SELECT * FROM t x ENABLE ​TRIGGER trg ON t',
  ])('refuses %j with the SQL Server sentence', (q) => { expect(() => validateSelectSql(q, 'mssql')).toThrow(MSSQL_REFUSAL); });
  it('keeps the words as names when printable punctuation sits between them', () => {
    expect(() => validateSelectSql('SELECT next.value, disable.trigger FROM t', 'mssql')).not.toThrow();
  });
});

describe('the window the end test reads', () => {
  it('is at least as long as the longest listed word', () => {
    const longest = Math.max(...SQL_CHECK_WORDS_FOR_TESTS.lists.flat().map((w) => w.length));
    expect(SQL_CHECK_WORDS_FOR_TESTS.window).toBeGreaterThanOrEqual(longest);
  });
});

describe('use, on mssql', () => {
  it.each([
    "SELECT a FROM t OPTION (USE HINT('X'))", "SELECT a FROM t OPTION (USE HINT ('X', 'Y'))",
    "SELECT a FROM t OPTION (RECOMPILE, USE HINT('X'))", "SELECT a FROM t OPTION (USE PLAN N'<p/>')",
    "SELECT a FROM t OPTION (USE PLAN '<p/>')",
  ])('allows %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).not.toThrow(); });
  it.each([
    'SELECT 1 USE hint', 'SELECT 1 USE plan', 'SELECT 1 USE hints', 'SELECT 1 USE', 'SELECT 1 USE other',
  ])('refuses %s', (q) => { expect(() => validateSelectSql(q, 'mssql')).toThrow(); });
});

describe('the base word list after a number', () => {
  it('postgres refuses a base word right after a number, as SQL Server does', () => {
    expect(() => validateSelectSql('SELECT 1INTO x FROM t', 'postgres')).toThrow(/read-only/);
    expect(() => validateSelectSql('SELECT a1into, _into FROM t', 'postgres')).not.toThrow();
  });
  it('mysql keeps reading a digit and a word as one name', () => {
    expect(() => validateSelectSql('SELECT 1DELETE FROM t', 'mysql')).not.toThrow();
    expect(() => validateSelectSql('SELECT 1 DELETE FROM t', 'mysql')).toThrow(/read-only/);
  });
});

describe('runSqlQuery reads the SQL as its engine does', () => {
  it('on mssql refuses a statement word before anything reaches the database', async () => {
    const transaction = vi.fn(() => { throw new Error('should not reach db'); });
    await expect(runSqlQuery({ transaction } as any, 'SELECT backup FROM t', { timeoutMs: 5000, rowCap: 10 }, 'mssql'))
      .rejects.toThrow(MSSQL_REFUSAL);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('on postgres sends the same word as a name to the database', async () => {
    const { db, executed } = makeFakeDb([{ backup: 1 }]);
    await runSqlQuery(db, 'SELECT backup FROM t', { timeoutMs: 5000, rowCap: 10 }, 'postgres');
    expect(executed).toContain('select * from (SELECT backup FROM t\n) as _q limit 10 offset 0');
  });
});

describe('runSqlQuery numeric guards', () => {
  const db = { transaction: () => { throw new Error('should not reach db'); } } as any;

  it('rejects NaN timeoutMs before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: NaN, rowCap: 10 }, 'postgres'))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects Infinity rowCap before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 5000, rowCap: Infinity }, 'postgres'))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects zero timeoutMs before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 0, rowCap: 10 }, 'postgres'))
      .rejects.toThrow(/finite positive/);
  });

  it('rejects negative rowCap before reaching the db', async () => {
    await expect(runSqlQuery(db, 'select 1', { timeoutMs: 5000, rowCap: -1 }, 'postgres'))
      .rejects.toThrow(/finite positive/);
  });
});

describe('runSqlQuery dialect-aware session setup + capped query', () => {
  it('postgres: read-only txn + statement_timeout + LIMIT/OFFSET capped query', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'postgres');
    expect(executed).toContain('set transaction read only');
    expect(executed).toContain('set local statement_timeout = 5000');
    expect(executed).toContain('select * from (select 1 as a\n) as _q limit 100 offset 0');
    expect(result.rows).toEqual([{ a: 1 }]);
    expect(result.columns).toEqual([{ key: 'a', label: 'a', kind: 'number' }]);
  });

  it('postgres: same shape with another timeout and cap', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    await runSqlQuery(db, 'select 1 as a', { timeoutMs: 2500, rowCap: 10 }, 'postgres');
    expect(executed).toContain('set transaction read only');
    expect(executed).toContain('set local statement_timeout = 2500');
    expect(executed).toContain('select * from (select 1 as a\n) as _q limit 10 offset 0');
  });

  it('mssql: SET LOCK_TIMEOUT (no read-only/statement_timeout) + SET ROWCOUNT capped batch', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }]);
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mssql');
    expect(executed).toContain('set lock_timeout 5000');
    expect(executed.some((s) => /read only/i.test(s))).toBe(false);
    expect(executed.some((s) => /statement_timeout/i.test(s))).toBe(false);
    expect(executed).toContain('set rowcount 100; select 1 as a\n; set rowcount 0');
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mssql: runs the transaction inside the supplied driver deadline', async () => {
    const { db } = makeFakeDb([{ a: 1 }]);
    const deadline = {
      async run<T>(_timeoutMs: number, operation: () => Promise<T>): Promise<T> {
        return operation();
      },
    };
    const deadlineSpy = vi.spyOn(deadline, 'run');

    await runSqlQuery(db, 'select 1 as a', {
      timeoutMs: 475,
      rowCap: 100,
      withDeadline: deadline.run.bind(deadline),
    }, 'mssql');

    expect(deadlineSpy).toHaveBeenCalledWith(475, expect.any(Function));
  });

  it('mysql (MySQL 8): per-statement MAX_EXECUTION_TIME hint on the capped query — no session SET, no read-only txn', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '8.4.0'); // version() has no "MariaDB"
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mysql');
    // The row cap is the wrapping SELECT; the timeout rides on it as an optimizer hint (ms).
    expect(executed).toContain('select /*+ MAX_EXECUTION_TIME(5000) */ * from (select 1 as a\n) as _q limit 100 offset 0');
    // Nothing session-scoped and no pg/mssql pragmas — no leak onto the pooled connection.
    expect(executed.some((s) => /set session/i.test(s))).toBe(false);
    expect(executed.some((s) => /max_statement_time/i.test(s))).toBe(false); // that's MariaDB's, not MySQL's
    expect(executed.some((s) => /read only/i.test(s))).toBe(false);
    expect(executed.some((s) => /statement_timeout/i.test(s))).toBe(false);
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mysql (MariaDB): per-statement SET STATEMENT max_statement_time wrapper (seconds) — no hint, no session SET', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '11.4.2-MariaDB-1:11.4.2+maria~ubu2404');
    const result = await runSqlQuery(db, 'select 1 as a', { timeoutMs: 5000, rowCap: 100 }, 'mysql');
    expect(executed).toContain('set statement max_statement_time=5 for select * from (select 1 as a\n) as _q limit 100 offset 0');
    expect(executed.some((s) => /max_execution_time/i.test(s))).toBe(false); // that's MySQL's hint, not MariaDB's
    expect(executed.some((s) => /set session/i.test(s))).toBe(false);
    expect(result.rows).toEqual([{ a: 1 }]);
  });

  it('mysql: a fractional-second timeout renders a decimal max_statement_time on MariaDB', async () => {
    const { db, executed } = makeFakeDb([{ a: 1 }], '11.4.2-MariaDB');
    await runSqlQuery(db, 'select 1 as a', { timeoutMs: 2500, rowCap: 10 }, 'mysql');
    expect(executed).toContain('set statement max_statement_time=2.5 for select * from (select 1 as a\n) as _q limit 10 offset 0');
  });
});

describe('planPagination', () => {
  it('wraps Postgres with LIMIT/OFFSET (server-side offset, no slice)', () => {
    expect(planPagination('select 1', 'postgres', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'select * from (select 1\n) as _q limit 100 offset 0', sliceOffset: 0 });
  });
  it('wraps Postgres with a non-zero offset in SQL', () => {
    expect(planPagination('select 1', 'postgres', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'select * from (select 1\n) as _q limit 50 offset 25', sliceOffset: 0 });
  });
  it('caps MSSQL with SET ROWCOUNT (works with an ORDER BY query), offset applied by slicing', () => {
    // ORDER BY in the inner query would be invalid inside a derived table on SQL Server; SET ROWCOUNT avoids that.
    expect(planPagination('select 1 order by 1', 'mssql', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'set rowcount 100; select 1 order by 1\n; set rowcount 0', sliceOffset: 0 });
  });
  it('MSSQL fetches offset+limit rows via SET ROWCOUNT and reports sliceOffset', () => {
    expect(planPagination('select 1', 'mssql', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'set rowcount 75; select 1\n; set rowcount 0', sliceOffset: 25 });
  });
  it('defaults offset to 0 and floors non-integers', () => {
    expect(planPagination('select 1', 'postgres', { limit: 10.9 }))
      .toEqual({ sql: 'select * from (select 1\n) as _q limit 10 offset 0', sliceOffset: 0 });
    expect(planPagination('select 1', 'mssql', { limit: 10.9 }))
      .toEqual({ sql: 'set rowcount 10; select 1\n; set rowcount 0', sliceOffset: 0 });
  });
  it('wraps MySQL with LIMIT/OFFSET (reuses the Postgres server-side-offset path)', () => {
    expect(planPagination('select 1', 'mysql', { limit: 100, offset: 0 }))
      .toEqual({ sql: 'select * from (select 1\n) as _q limit 100 offset 0', sliceOffset: 0 });
    expect(planPagination('select 1', 'mysql', { limit: 50, offset: 25 }))
      .toEqual({ sql: 'select * from (select 1\n) as _q limit 50 offset 25', sliceOffset: 0 });
  });
  // R7: a trailing line comment in the person's SQL must not swallow what the plan adds.
  it.each(['postgres', 'mysql'] as const)('%s: a query that ends in a line comment gets the wrapper end on a new line', (dialect) => {
    const plan = planPagination('select 1 -- note', dialect, { limit: 10, offset: 5 });
    expect(plan.sql).toBe('select * from (select 1 -- note\n) as _q limit 10 offset 5');
    expect(plan.sql.split('\n')[1]).toBe(') as _q limit 10 offset 5');
  });
  it('mssql: a query that ends in a line comment gets the row-cap reset on a new line', () => {
    const plan = planPagination('select 1 -- note', 'mssql', { limit: 10 });
    expect(plan.sql).toBe('set rowcount 10; select 1 -- note\n; set rowcount 0');
    expect(plan.sql.split('\n')[1]).toBe('; set rowcount 0');
    expect(plan.sql.endsWith('set rowcount 0')).toBe(true);
  });
});

describe('runReadQuery on mssql runs in a transaction that is always rolled back', () => {
  it('runReadQuery on mssql rolls back after a good query and after a failed one', async () => {
    const good = recordingDb('mssql', { rows: [{ a: 1 }] });
    const rows = await runReadQuery(good.db, CompiledQuery.raw('select 1 as a'), RUN, 'mssql');
    expect(rows).toEqual([{ a: 1 }]);
    expect(good.trail).toEqual([
      'acquire', 'begin', 'set lock_timeout 5000', 'set rowcount 10; select 1 as a\n; set rowcount 0', 'rollback', 'release',
    ]);
    expect(good.state).toMatchObject({ leased: false, inTransaction: false });

    const bad = recordingDb('mssql', {
      failQuery: (s) => (s.includes('select nope') ? { error: new Error('Invalid column name') } : undefined),
    });
    await expect(runReadQuery(bad.db, CompiledQuery.raw('select nope'), RUN, 'mssql')).rejects.toThrow('Invalid column name');
    expect(bad.trail).toEqual([
      'acquire', 'begin', 'set lock_timeout 5000', 'set rowcount 10; select nope\n; set rowcount 0', 'rollback', 'release',
    ]);
    expect(bad.trail).not.toContain('commit');
    expect(bad.state).toMatchObject({ leased: false, inTransaction: false });
  });

  it('runReadQuery on mssql: after a deadline cancels the query, the next query on the same db finds no open transaction', async () => {
    // The real deadline is the driver's request timeout: the statement's request fails, and the
    // transaction stays open on the server. This fake does no reset on release, so only the
    // roll-back can close it. What it proves: after a failed statement a roll-back is sent and the
    // connection goes back with no transaction open. It has no timer and no real attention, so it
    // shows neither the roll-back's timing nor what SQL Server does after a cancel. The old
    // `transaction()` code also rolled back on an error, so this test passed before the change too.
    let cancelNext = true;
    const shared = recordingDb('mssql', {
      rows: [{ a: 1 }],
      failQuery: (s) => {
        if (!s.startsWith('set rowcount') || !cancelNext) return undefined;
        cancelNext = false;
        return { error: new Error('Timeout: Request failed to complete in 5000ms') };
      },
    });
    const deadlines: number[] = [];
    const opts = { ...RUN, withDeadline: <T>(ms: number, op: () => Promise<T>) => { deadlines.push(ms); return op(); } };

    await expect(runReadQuery(shared.db, CompiledQuery.raw('select 1 as a'), opts, 'mssql')).rejects.toThrow('Timeout');
    expect(shared.trail.slice(-2)).toEqual(['rollback', 'release']);

    const rows = await runReadQuery(shared.db, CompiledQuery.raw('select 1 as a'), opts, 'mssql');
    expect(rows).toEqual([{ a: 1 }]);
    expect(deadlines).toEqual([5000, 5000]);
    // The second query got the same connection with no transaction open, and began its own.
    expect(shared.state.acquiredInTransaction).toEqual([false, false]);
    expect(shared.trail.filter((t) => t === 'begin')).toHaveLength(2);
    expect(shared.state).toMatchObject({ leased: false, inTransaction: false });
  });

  it('runReadQuery on mssql: when SQL Server ended the transaction, the person sees their own error, not 3903', async () => {
    const db = recordingDb('mssql', {
      failQuery: (s) => (s.startsWith('set rowcount')
        ? { error: new Error("Conversion failed when converting the varchar value 'x' to data type int."), endsTransaction: true }
        : undefined),
    });
    await expect(runReadQuery(db.db, CompiledQuery.raw("select cast('x' as int) as a"), RUN, 'mssql'))
      .rejects.toThrow('Conversion failed');
    expect(db.trail.slice(-2)).toEqual(['rollback', 'release']);
    expect(db.state).toMatchObject({ leased: false, inTransaction: false });
  });

  it('runReadQuery on mssql: a roll-back that fails after a good read still returns the rows and gives the connection back', async () => {
    // The store resets a connection when it is given back (`resetConnectionsOnRelease: true`), and
    // that reset ends an open transaction. The fake models it here, for this case only.
    let failOnce = true;
    const db = recordingDb('mssql', {
      rows: [{ a: 1 }],
      resetOnRelease: true,
      failRollback: () => {
        if (!failOnce) return undefined;
        failOnce = false;
        return new Error('the roll-back request failed');
      },
    });
    expect(await runReadQuery(db.db, CompiledQuery.raw('select 1 as a'), RUN, 'mssql')).toEqual([{ a: 1 }]);
    expect(db.trail.slice(-2)).toEqual(['rollback', 'release']);
    // Not leaked: the pool's one connection serves the next query.
    expect(await runReadQuery(db.db, CompiledQuery.raw('select 1 as a'), RUN, 'mssql')).toEqual([{ a: 1 }]);
    expect(db.state.acquiredInTransaction).toEqual([false, false]);
  });

  it('runReadQuery on mssql: a statement that ends in a line comment is still rolled back, as its own request', async () => {
    const db = recordingDb('mssql', { rows: [] });
    await runReadQuery(db.db, CompiledQuery.raw('select 1 as a -- note'), RUN, 'mssql');
    expect(db.trail).toEqual([
      'acquire', 'begin', 'set lock_timeout 5000', 'set rowcount 10; select 1 as a -- note\n; set rowcount 0', 'rollback', 'release',
    ]);
    expect(db.state.inTransaction).toBe(false);
  });
});

describe('runReadQuery on postgres', () => {
  it('runReadQuery on postgres still sets the transaction read only', async () => {
    const db = recordingDb('postgres', { rows: [{ a: 1 }] });
    expect(await runReadQuery(db.db, CompiledQuery.raw('select 1 as a'), RUN, 'postgres')).toEqual([{ a: 1 }]);
    expect(db.trail).toEqual([
      'acquire', 'begin',
      'set transaction read only',
      'SET LOCAL standard_conforming_strings = on',
      'set local statement_timeout = 5000',
      'select * from (select 1 as a\n) as _q limit 10 offset 0',
      'commit', 'release',
    ]);
  });
  it('a postgres statement that fails is rolled back and the connection given back', async () => {
    const db = recordingDb('postgres', {
      failQuery: (s) => (s.startsWith('select *') ? { error: new Error('canceling statement due to statement timeout') } : undefined),
    });
    await expect(runReadQuery(db.db, CompiledQuery.raw('select pg_sleep(9)'), RUN, 'postgres')).rejects.toThrow('statement timeout');
    expect(db.trail.slice(-2)).toEqual(['rollback', 'release']);
    expect(db.state).toMatchObject({ leased: false, inTransaction: false });
  });
});
