import { type Kysely, CompiledQuery, sql } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import type { ReportResultData, ReportColumn } from '@openldr/reporting';
import { blankSql, type SqlDialect } from './sql-text';

export type { SqlDialect } from './sql-text';

const DIALECTS_IN_ORDER: readonly SqlDialect[] = ['postgres', 'mssql', 'mysql'];

/** Returns when `rawSql` is one read-only SELECT or WITH statement, read by the rules of the engine
 *  that will run it. This is the check that guards a run. Throws a fixed sentence in these cases:
 *  - the text is empty once comments are blanked;
 *  - it holds more than one statement;
 *  - it does not start with SELECT or WITH;
 *  - it holds a refused word (INTO, DDL or DML; see `hasBaseWord` for what counts as a word);
 *  - on mssql only, it holds a SQL Server statement word or pass-through function (see
 *    `refuseSqlServerStatementWords`);
 *  - every case in which `blankSql` throws (see `sql-text.ts`):
 *    - a string, block comment, quoted name or dollar-quoted string is never closed (any dialect);
 *    - a carriage return inside a line comment is followed by a character other than a line feed
 *      (mysql, mssql);
 *    - a vertical tab, a form feed, U+0085, U+2028 or U+2029 sits inside a `--` comment (mssql);
 *    - a `/*!` comment is directly followed by a digit or by `!`, or a `/*M!` or `/*m!` comment
 *      opens (mysql);
 *    - a `/*!` comment is never closed, or opens inside another one (mysql). */
export function validateSelectSql(rawSql: string, dialect: SqlDialect): void {
  const blanked = blankSql(rawSql, dialect);
  checkBlankedSelect(blanked, dialect);
  if (dialect === 'mssql') refuseSqlServerStatementWords(blanked);
}

/** The check made when a query is saved or imported and the engine that will run it is not known.
 *  It is not the check that guards a run.
 *
 *  The text passes when `validateSelectSql` passes it under at least one of postgres, mssql and
 *  mysql, tried in that order, so the mssql attempt applies the SQL Server rule. When it fails
 *  under all three, the postgres error is thrown. */
export function validateSelectSqlForSave(rawSql: string): void {
  let firstError: unknown = null;
  for (const each of DIALECTS_IN_ORDER) {
    try {
      validateSelectSql(rawSql, each);
      return;
    } catch (e) {
      if (each === DIALECTS_IN_ORDER[0]) firstError = e;
    }
  }
  throw firstError;
}

const MSSQL_REFUSAL = 'only read-only SELECT queries are allowed on SQL Server (statement words such as EXEC are refused; put a name that is such a word in [brackets])';

/** Reserved T-SQL words that can start a statement. `load` and `dump` are left out: Task 1's run
 *  on SQL Server 2025 found both work as bare names. `fetch` and `end` are left out because
 *  `OFFSET ... FETCH` and `CASE ... END` use them. */
const MSSQL_STATEMENT_WORDS = [
  'exec', 'execute', 'waitfor', 'dbcc', 'backup', 'restore', 'shutdown', 'kill', 'deny', 'declare', 'set',
  'reconfigure', 'begin', 'commit', 'rollback', 'save', 'if', 'while', 'print', 'raiserror', 'goto', 'return',
  'open', 'close', 'deallocate', 'checkpoint', 'bulk', 'writetext', 'updatetext', 'readtext', 'setuser',
  'revert', 'add',
];

/** Functions that send SQL held in a string to another server or read another source. */
const MSSQL_PASS_THROUGH = ['openquery', 'openrowset', 'opendatasource', 'openxml'];

/** Words that write or change the schema, refused on every engine. */
const BASE_WORDS = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke',
  'merge', 'call', 'copy', 'into'];

/** How one engine splits code into words.
 *
 *  A run is the longest stretch of name characters. A run that starts with a name-start character
 *  is one name, so a word counts only when it is the whole run. Any other run starts with a digit
 *  or `$`, so it is a number (or a `$` money literal) and what follows it. The engine ends the
 *  number at a letter that cannot continue it, so a word at the end of such a run is a word of its
 *  own: SQL Server reads `1KILL` as `1` then `KILL`. A word counts there when it ends the run.
 *
 *  `\b` is not used: it treats `#`, `@` and `$` as word ends, so `##open` and `@set` would match,
 *  and it treats a digit as part of a word, so `1KILL` would not. */
interface WordReading {
  /** One run of name characters, global. */
  run: RegExp;
  /** The first character of a run that is one name. */
  nameStart: RegExp;
}

/** T-SQL: a name starts with a letter, `_`, `#` or `@`, and goes on with those, digits and `$`. */
const MSSQL_READING: WordReading = {
  run: /[\p{L}\p{Nd}_#@$]+/gu,
  nameStart: /^[\p{L}_#@]/u,
};

/** Postgres: a name starts with a letter or `_`, and goes on with those, digits and `$`. `#` and `@`
 *  are operators there, so they end a word as `\b` did. */
const POSTGRES_READING: WordReading = {
  run: /[\p{L}\p{Nd}_$]+/gu,
  nameStart: /^[\p{L}_]/u,
};

/** A word list as two tests on one run: the whole run, or the end of the run. */
interface WordList { whole: RegExp; end: RegExp }

function wordList(words: readonly string[]): WordList {
  const alternatives = words.join('|');
  return { whole: new RegExp(`^(?:${alternatives})$`, 'iu'), end: new RegExp(`(?:${alternatives})$`, 'iu') };
}

/** The longest word in any list below, with room to spare. The end test reads only this much of a
 *  run, so a long run costs no more than a short one. */
const LONGEST_WORD = 32;

/** True when `run` holds a word of `list` that counts, read as `reading` says. */
function runHasWord(run: string, reading: WordReading, list: WordList): boolean {
  if (reading.nameStart.test(run)) return list.whole.test(run);
  return list.end.test(run.slice(-LONGEST_WORD));
}

/** Each run of name characters in `text`, with the index just after it. */
function* runsOf(text: string, reading: WordReading): Generator<{ run: string; after: number }> {
  for (const m of text.matchAll(reading.run)) yield { run: m[0], after: (m.index ?? 0) + m[0].length };
}

const BASE_LIST = wordList(BASE_WORDS);
const BASE_PATTERN_MYSQL = new RegExp(String.raw`\b(?:${BASE_WORDS.join('|')})\b`, 'i');

/** True when the blanked text holds a base word that counts. MySQL keeps `\b`: a bare MySQL name may
 *  start with a digit, so `1delete` is one name there. SQL Server and Postgres follow `WordReading`. */
function hasBaseWord(blanked: string, dialect: SqlDialect): boolean {
  if (dialect === 'mysql') return BASE_PATTERN_MYSQL.test(blanked);
  const reading = dialect === 'mssql' ? MSSQL_READING : POSTGRES_READING;
  for (const { run } of runsOf(blanked, reading)) if (runHasWord(run, reading, BASE_LIST)) return true;
  return false;
}

const MSSQL_REFUSED_WORDS = wordList([...MSSQL_STATEMENT_WORDS, ...MSSQL_PASS_THROUGH]);
const MSSQL_USE = wordList(['use']);
const MSSQL_TRIGGER_PAIR = wordList(['enable', 'disable']);
const MSSQL_NEXT = wordList(['next']);

/** What may follow `use` in a query hint: `HINT (` or `PLAN` and a string, with an optional `N`. */
const MSSQL_USE_HINT = /\s+(?:hint\s*\(|plan(?:\s*|\s+N)'')/iuy;
const MSSQL_TRIGGER_AFTER = /\s+trigger(?![\p{L}\p{Nd}_#@$])/iuy;
const MSSQL_NEXT_AFTER = /\s+value\s+for(?![\p{L}\p{Nd}_#@$])/iuy;

/** True when the sticky pattern matches `text` at `at`. */
function followedBy(text: string, at: number, sticky: RegExp): boolean {
  sticky.lastIndex = at;
  return sticky.test(text);
}

/** On SQL Server a SELECT with no semicolon can be followed by a second statement. The words that
 *  can start one are reserved, so one that counts in code is refused (see `WordReading`). A name
 *  that is such a word must be in brackets, which `blankSql` has already blanked. Reads the blanked
 *  text only.
 *  - `use` is refused unless `HINT (` or `PLAN '...'` follows, as in `OPTION (USE HINT('X'))`.
 *  - `enable` and `disable` are refused when `trigger` follows, and `next` when `value for` does. */
function refuseSqlServerStatementWords(blanked: string): void {
  for (const { run, after } of runsOf(blanked, MSSQL_READING)) {
    const refused = runHasWord(run, MSSQL_READING, MSSQL_REFUSED_WORDS)
      || (runHasWord(run, MSSQL_READING, MSSQL_USE) && !followedBy(blanked, after, MSSQL_USE_HINT))
      || (runHasWord(run, MSSQL_READING, MSSQL_TRIGGER_PAIR) && followedBy(blanked, after, MSSQL_TRIGGER_AFTER))
      || (runHasWord(run, MSSQL_READING, MSSQL_NEXT) && followedBy(blanked, after, MSSQL_NEXT_AFTER));
    if (refused) throw new Error(MSSQL_REFUSAL);
  }
}

function checkBlankedSelect(blanked: string, dialect: SqlDialect): void {
  // Strings, comments and quoted names are blanked before the structural and keyword checks, so
  // quoted text (e.g. 'convert this into that') can't trigger a false positive or hide a
  // statement. Only the validation copy is blanked, never the SQL that runs.
  const stripped = blanked.trim();
  if (!stripped) throw new Error('empty query');
  // Reject multiple statements: any semicolon that is not the final char.
  const noTrailing = stripped.replace(/;\s*$/, '');
  if (noTrailing.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(noTrailing)) throw new Error('only SELECT/WITH queries are allowed');
  // `into` is banned too: `SELECT … INTO <table>` creates a table and writes rows (a write
  // masquerading as a SELECT). On Postgres a read-only txn caught this; on MSSQL there is no
  // read-only txn, so this shared validator is the only guard for both Path A and Path B.
  if (hasBaseWord(noTrailing, dialect)) {
    throw new Error('only read-only SELECT queries are allowed (INTO/DDL/DML rejected)');
  }
}

export interface PaginationPlan {
  /** SQL to execute (a multi-statement batch for MSSQL). */
  sql: string;
  /** Rows to drop from the front of the result set. MSSQL applies its offset here (in JS)
   *  rather than in SQL; Postgres does the offset in SQL so this is 0. */
  sliceOffset: number;
}

/** Plan a dialect-correct row-cap + offset for an ARBITRARY user SELECT (which may end in its
 *  own ORDER BY). Postgres wraps in a derived table with LIMIT/OFFSET (server-side offset).
 *  SQL Server cannot wrap an ORDER BY query in a derived table (T-SQL forbids it, and OFFSET…FETCH
 *  requires the ORDER BY at the statement's own top level), so it caps rows with SET ROWCOUNT —
 *  which works for any SELECT including one ending in ORDER BY — and applies the offset by slicing
 *  the returned rows. */
export function planPagination(inner: string, dialect: SqlDialect, opts: { limit: number; offset?: number }): PaginationPlan {
  const limit = Math.floor(opts.limit);
  const offset = Math.floor(opts.offset ?? 0);
  if (dialect === 'mssql') {
    return { sql: `set rowcount ${offset + limit}; ${inner}; set rowcount 0`, sliceOffset: offset };
  }
  // Postgres AND MySQL/MariaDB: native LIMIT/OFFSET in a derived table (server-side offset).
  return { sql: `select * from (${inner}) as _q limit ${limit} offset ${offset}`, sliceOffset: 0 };
}

export interface SqlRunOpts {
  timeoutMs: number;
  rowCap: number;
  /** Optional driver-level deadline. SQL Server uses this to cancel the active Tedious request. */
  withDeadline?: <T>(timeoutMs: number, operation: () => Promise<T>) => Promise<T>;
}

/** MariaDB's `version()` string contains "MariaDB"; MySQL's does not. The engine variant is a
 *  server property (identical across every connection in the pool), so it is detected once via a
 *  trivial `version()` query and cached per db handle. Used to pick the per-statement timeout
 *  mechanism below (MySQL optimizer hint vs MariaDB `SET STATEMENT`). */
const mariaDbByDb = new WeakMap<object, boolean>();
async function isMariaDb(db: object, trx: Kysely<ExternalSchema>): Promise<boolean> {
  const cached = mariaDbByDb.get(db);
  if (cached !== undefined) return cached;
  const r = await sql<{ v: string }>`select version() as v`.execute(trx);
  const isMaria = /mariadb/i.test(String(r.rows[0]?.v ?? ''));
  mariaDbByDb.set(db, isMaria);
  return isMaria;
}

/** Run user SQL inside a read-only transaction with a statement/lock timeout and row cap.
 *  Dialect-aware: Postgres uses `set transaction read only` + `statement_timeout`; SQL Server has
 *  no equivalent transaction-level read-only mode or per-statement timeout, so it relies on the
 *  SELECT-only validation above for read-only-ness and bounds lock waits with LOCK_TIMEOUT.
 *  MySQL/MariaDB likewise have no read-only pragma usable mid-transaction (so they too rely on
 *  SELECT-only validation), and their statement timeout is applied PER-STATEMENT — no session var
 *  is mutated, so nothing leaks onto the pooled connection: MySQL 8 uses the
 *  `MAX_EXECUTION_TIME(<ms>)` optimizer hint on the wrapping SELECT, MariaDB uses
 *  `SET STATEMENT max_statement_time=<sec> FOR <stmt>`. The two are mutually exclusive (MySQL has no
 *  `SET STATEMENT … FOR`; MariaDB ignores the hint), so the engine variant is detected once (cached)
 *  from `version()`. */
export async function runSqlQuery(
  db: Kysely<ExternalSchema>, rawSql: string, opts: SqlRunOpts, engine: SqlDialect,
): Promise<ReportResultData> {
  validateSelectSql(rawSql, engine);
  const rows = await runReadQuery(db, CompiledQuery.raw(rawSql.replace(/;\s*$/, '')), opts, engine);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const columns: ReportColumn[] = keys.map((k) => ({
    key: k, label: k,
    kind: typeof rows[0]?.[k] === 'number' ? 'number' : 'string',
  }));
  return { columns, rows, chart: { type: 'bar', x: keys[0] ?? 'label', y: keys[1] ?? 'value' } };
}

/** Execute a trusted, parameterized SELECT with the same bounds as SQL widgets. */
export async function runReadQuery(
  db: Kysely<ExternalSchema>, query: CompiledQuery<unknown>, opts: SqlRunOpts, engine: SqlDialect,
): Promise<Record<string, unknown>[]> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1) throw new Error('timeoutMs must be a finite positive number');
  if (!Number.isFinite(opts.rowCap) || opts.rowCap < 1) throw new Error('rowCap must be a finite positive number');
  const cap = Math.floor(opts.rowCap);
  const ms = Math.floor(opts.timeoutMs);
  const execute = () => db.transaction().execute(async (trx) => {
    let statement = planPagination(query.sql, engine, { limit: cap }).sql;
    if (engine === 'mssql') {
      // LOCK_TIMEOUT bounds lock waits only. The driver owns execution cancellation.
      await sql`set lock_timeout ${sql.lit(ms)}`.execute(trx);
    } else if (engine === 'mysql') {
      statement = (await isMariaDb(db, trx))
        ? `set statement max_statement_time=${ms / 1000} for ${statement}`
        : statement.replace(/^select/i, `select /*+ MAX_EXECUTION_TIME(${ms}) */`);
    } else {
      await sql`set transaction read only`.execute(trx);
      await sql`set local statement_timeout = ${sql.lit(ms)}`.execute(trx);
    }
    return (await trx.executeQuery<Record<string, unknown>>({ ...query, sql: statement })).rows;
  });
  return opts.withDeadline ? opts.withDeadline(ms, execute) : execute();
}
