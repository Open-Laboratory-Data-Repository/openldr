import { classifyConnectError } from './connector-diagnose';

// The rules a source read follows when a query fails: which errors are worth retrying, how long
// to wait before the next try, and how a page shrinks and grows. Pure functions, used by the page
// reader (import-source-reader.ts).

/**
 * - `lost`: the link failed. Wait, open a new connection and read the same page again.
 * - `timeout`: the query ran out of time. Probe the source before deciding it was the page size.
 * - `refused`: the source itself said no, such as a missing table or a failed login. Retrying
 *   cannot fix it.
 */
export type SourceErrorKind = 'lost' | 'timeout' | 'refused';

const FIRST_WAIT_MS = 5000;
const MAX_WAIT_MS = 300_000;
/** Good pages in a row before a shrunk page doubles again. */
const GROW_AFTER = 5;
/** SQL Server: this request was chosen as a deadlock victim. Running it again can work. */
const DEADLOCK_VICTIM = 1205;
/** SQL Server errors whose message names a column, a table, a database or a login, never a row. */
const NAMES_NO_ROW = new Set([207, 208, 229, 230, 262, 911, 916, 4060, 18452, 18456]);
/** SQL Server errors seen while a server that has just started recovers its databases: the login
 *  or the database is refused until recovery ends (R45). */
const STARTING_UP_NUMBERS = new Set([4060, 18456, 921, 922, 945, 6005, 17142, 17187, 18401]);
/** Driver codes for a link that failed on the network. */
const NETWORK_CODES = new Set(['ESOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ECONNCLOSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);
const UNRECOGNISED = 'the source failed in a way OpenLDR does not recognise';
const UNREACHABLE = 'the source could not be reached';
const UNREADABLE = 'the source could not be read';
const DEADLOCK_TEXT = `the source stopped this read to end a deadlock (SQL Server error ${DEADLOCK_VICTIM}); it is tried again`;

/**
 * The member errors of a statement that failed with more than one SQL Server error, or null.
 * tedious raises an AggregateError when one request gets several error tokens
 * (tedious 18 lib/token/handler.js:295), and Kysely's MSSQL driver rejects with its `errors`,
 * a plain array (kysely 0.28 dialect/mssql/mssql-driver.js:281). An AggregateError, or any
 * object with an `errors` array, is read the same way.
 */
function members(err: unknown): unknown[] | null {
  if (Array.isArray(err)) return err;
  const errors = typeof err === 'object' && err !== null ? (err as { errors?: unknown }).errors : undefined;
  return Array.isArray(errors) ? errors : null;
}

function fields(err: unknown): { code: string; number: number | null; message: string } {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; number?: unknown; message?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : '',
    number: typeof e.number === 'number' && Number.isFinite(e.number) ? e.number : null,
    message: typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '',
  };
}

/** Order matters. An unknown error is `lost`, so it is retried and shown rather than ending the
 *  run: the complaint this answers is a run that stops and waits for a person. */
export function classifySourceError(err: unknown): SourceErrorKind {
  const list = members(err);
  if (list) {
    // Several errors: refused if any is, else timeout if any is, else lost. Empty is lost.
    const kinds = list.map(classifySourceError);
    if (kinds.includes('refused')) return 'refused';
    if (kinds.includes('timeout')) return 'timeout';
    return 'lost';
  }
  const { code, number, message } = fields(err);
  // A SQL Server error's words can name a column or a table, so they are read for a timeout only
  // when the error has no number.
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT' || (number === null && /timeout|timed out/i.test(message))) return 'timeout';
  if (code === 'ELOGIN') return 'refused';
  const hint = classifyConnectError(message);
  if (hint === 'loginFailed' || hint === 'databaseMissing') return 'refused';
  if (code === 'EREQUEST') return number === DEADLOCK_VICTIM ? 'lost' : 'refused';
  return 'lost';
}

/**
 * The only way a source error becomes text, for an error thrown to the caller and for the
 * waiting state. A SQL Server message can quote a row value (error 245 does), so the driver's
 * message is kept only when it cannot. Rules, in order:
 *  1. a login error: the driver's message;
 *  2. a SQL Server error that names a column, table, database or login: the driver's message;
 *  3. a deadlock (1205): a fixed sentence that says it is tried again. Any other SQL Server
 *     error: its number only;
 *  4. no number, and a timeout: the driver's message (timer text). No number, and a lost link:
 *     for `EINVALIDSTATE`, the fixed sentence "the source could not be reached"; for a network
 *     code, "the source could not be reached: " and the driver's message; for anything else,
 *     "the source could not be read: " and the driver's message;
 *  5. anything else: a fixed sentence.
 * The driver's message always goes through `clean`. A lead goes through `clean` with it, so the
 * cap cuts the driver's words and never the lead. A statement that failed with several errors
 * is described by its first refused member, or by its first member when none is refused. An
 * empty list gets the fixed sentence.
 */
export function describeSourceError(err: unknown, clean: (text: string) => string): string {
  const list = members(err);
  if (list) {
    if (list.length === 0) return UNRECOGNISED;
    return describeSourceError(list.find((m) => classifySourceError(m) === 'refused') ?? list[0], clean);
  }
  const { code, number, message } = fields(err);
  if (code === 'ELOGIN') return clean(message);
  if (number !== null) {
    if (NAMES_NO_ROW.has(number)) return clean(message);
    return number === DEADLOCK_VICTIM ? DEADLOCK_TEXT : `the source refused the query (SQL Server error ${number})`;
  }
  const kind = classifySourceError(err);
  if (kind === 'timeout') return clean(message);
  if (kind === 'lost') {
    // tedious's words for a request on a connection that has closed name its inner state only.
    if (code === 'EINVALIDSTATE') return UNREACHABLE;
    return clean(`${NETWORK_CODES.has(code) ? UNREACHABLE : UNREADABLE}: ${message}`);
  }
  return UNRECOGNISED;
}

/**
 * True when the error may come from a source that has just started and is still recovering its
 * databases: a login error, a message that reads as a failed login or a database that cannot be
 * opened, or one of the SQL Server numbers above. For a list, true when any member is. The reader
 * waits on these only for a run that has read the source before, so a wrong password on a new run
 * still fails at once.
 */
export function isSourceStartingUp(err: unknown): boolean {
  const list = members(err);
  if (list) return list.some(isSourceStartingUp);
  const { code, number, message } = fields(err);
  if (code === 'ELOGIN') return true;
  const hint = classifyConnectError(message);
  if (hint === 'loginFailed' || hint === 'databaseMissing') return true;
  return number !== null && STARTING_UP_NUMBERS.has(number);
}

/** Socket codes that mean the storage could not be reached. The same eight the AWS SDK retries
 *  (@smithy/core 3.29, retry, NODEJS_TIMEOUT_ERROR_CODES and NODEJS_NETWORK_ERROR_CODES). */
const STORAGE_DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);
/** S3 error names for a store that is up but cannot answer now, and the HTTP handler's timeout. */
const STORAGE_DOWN_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'ServiceUnavailable', 'SlowDown', 'InternalError']);
/** Far deeper than any real chain of causes. Stops a cause that points back at itself. */
const MAX_CAUSE_DEPTH = 10;

function storageDownAt(err: unknown, depth: number): boolean {
  if (depth > MAX_CAUSE_DEPTH || typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown }; cause?: unknown; errors?: unknown };
  if (typeof e.code === 'string' && STORAGE_DOWN_CODES.has(e.code)) return true;
  if (typeof e.name === 'string' && STORAGE_DOWN_NAMES.has(e.name)) return true;
  const status = e.$metadata?.httpStatusCode;
  // 429 is not in R33b's list. The SDK treats it as throttling, and waiting cures it.
  if (typeof status === 'number' && (status >= 500 || status === 429)) return true;
  if (storageDownAt(e.cause, depth + 1)) return true;
  return Array.isArray(e.errors) && e.errors.some((m) => storageDownAt(m, depth + 1));
}

/**
 * True when loading a plugin's code failed because blob storage cannot answer right now: after a
 * power cut it may come up after the server. The error, its `cause` followed down, and each entry
 * of an `errors` array are looked at. Everything else is false, so a hash mismatch (a tamper
 * signal), a missing object or file (`NoSuchKey`, `ENOENT`) and a plugin that cannot be invoked
 * fail the run and show why.
 */
export function isStorageDown(err: unknown): boolean {
  return storageDownAt(err, 0);
}

/** The wait before try number `attempt` (1 for the first retry): 5 s, doubling, at most 300 s. */
export function retryWaitMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (n - 1));
}

/** Half the page, never below 1. */
export function shrinkPage(size: number): number {
  return Math.max(1, Math.floor(size / 2));
}

/** Double the page after 5 good pages in a row, never above the run's own page size. */
export function growPage(size: number, target: number, goodInRow: number): number {
  return goodInRow >= GROW_AFTER ? Math.min(target, size * 2) : size;
}
