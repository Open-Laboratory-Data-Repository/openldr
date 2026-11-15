import { validateSelectSql } from '@openldr/dashboards';
import type { ConnectorDb } from './connector-db';
import { classifySourceError, describeSourceError, isSourceStartingUp, retryWaitMs, shrinkPage } from './import-retry';
import { assertSafeKey, fillDetailQuery, fillKeyQuery, toPluginRow } from './import-sql';

// Reads one page of a source database: the key query, then every detail query for those keys.
// It is used by the one-pass import and by the copy, and it decides what a failed query means:
//  - a lost link: close the connection and send the source `SELECT 1` with a 5-second limit.
//    Then wait, open a new connection and read the same page again. A loss whose `SELECT 1`
//    answered is counted. At the second counted loss in a row the page is halved, down to 1, and
//    the wait starts again at 5 s. A loss whose `SELECT 1` did not answer is an outage: the count
//    goes back to 0 and the page size stays. At a page of 1 a loss never skips a key;
//  - a timeout: send the source `SELECT 1` as above. No answer means the link is down, so it is
//    an outage. An answer means the page was too big, so the page is halved and read again, down to 1;
//  - a key whose details time out 3 times at a page of 1 is handed back as skipped;
//  - a login or database error from a source that may be starting up, on a run that has read it
//    before: waited on like a lost link, up to 12 tries in one call, then thrown;
//  - any other error the source returned, such as a missing table, is thrown to the caller.
// A stop is asked for before every retry. Source error text comes only from describeSourceError,
// so it cannot quote a row. The reader keeps no position. The caller passes `after` and `size` on every call.

export type PageResult =
  | {
    kind: 'page';
    keys: string[];
    /** The key query's own rows, through toPluginRow, in order. */
    keyRows: Array<Record<string, unknown>>;
    /** Keyed by detail query name, as the plugin's `map` expects. */
    rows: Record<string, Array<Record<string, unknown>>>;
    /** The page size this page was read at. Smaller than asked when a timeout or two losses halved it. */
    size: number;
  }
  | { kind: 'end' }
  | { kind: 'stopped' }
  | { kind: 'skipped'; key: string };

export interface ReadPageInput {
  keySql: string;
  details: Array<{ name: string; sql: string }>;
  after: string | null;
  size: number;
  /** Refuse a detail row whose first column is not one of the page's keys. Default false. */
  checkRowKeys?: boolean;
  /** The run has read this source before, so a refused login or database may be a source that
   *  is starting up. Default false. The reader also counts it true after its own first good query. */
  readBefore?: boolean;
}

export interface SourceReader {
  readPage(input: ReadPageInput): Promise<PageResult>;
  close(): Promise<void>;
}

export interface SourceReaderDeps {
  /** Opens a connection. The reader passes 5000 for its `SELECT 1` probe and nothing otherwise. */
  open(opts?: { queryTimeoutMs?: number }): Promise<ConnectorDb>;
  /** Called with a state when the reader starts waiting, and with null when it reads again. */
  onWaiting(state: { attempt: number; error: string } | null): Promise<void>;
  stopWanted(): Promise<boolean>;
  /** Makes driver text safe to show: masks the password, caps the length. */
  clean(text: string): string;
  sleep?: (ms: number) => Promise<void>;
}

const PROBE_SQL = 'SELECT 1';
const PROBE_TIMEOUT_MS = 5000;
/** A wait is slept in slices this long, so a stop is felt within a second. */
const SLICE_MS = 1000;
/** Timeouts of one key at a page of 1 before it is skipped. */
const SKIP_AFTER = 3;
/** Counted losses in a row (the probe answered each) before the page is halved. */
const HALVE_AFTER_LOSSES = 2;
/** Waits on a source that may be starting up, in one readPage call. About 35 minutes. */
const STARTING_UP_TRIES = 12;
const STARTING_UP_LEAD = 'the source may still be starting up: ';

/** An error from `open` or `db.query`. Only these are classified and may be retried. Every other
 *  error (a statement that is not one SELECT, an unsafe key, a row filed under a wrong key) is a
 *  fault of the plugin or the data and is thrown as it is. */
class SourceFailure {
  constructor(readonly cause: unknown) {}
}

function firstColumn(row: Record<string, unknown>): string {
  return String(Object.values(row)[0] ?? '');
}

/** The text with its trailing spaces (U+0020) removed. A plain loop: a regular expression such as
 *  / +$/ backtracks, and takes seconds on a long run of spaces that does not end the string. */
function dropTrailingSpaces(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 32) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}
/** ASCII letters folded to one case. Other letters are left as they are. */
const foldAscii = (s: string): string => s.replace(/[a-z]/g, (c) => c.toUpperCase());
const spaceStep = dropTrailingSpaces;
const caseStep = (s: string): string => foldAscii(dropTrailingSpaces(s));

/** Each page's keys are indexed once, however many rows ask. Pages are short-lived arrays. */
interface KeyIndex { exact: Set<string>; spaces: Map<string, string | null>; cased: Map<string, string | null> }
const keyIndexes = new WeakMap<readonly string[], KeyIndex>();

/** Page keys by `step(key)`. Two different page keys with the same form map to null. */
function indexBy(pageKeys: string[], step: (s: string) => string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const key of pageKeys) {
    const f = step(key);
    out.set(f, out.has(f) && out.get(f) !== key ? null : key);
  }
  return out;
}

/**
 * The page key a detail row belongs to, by the string form of its first column (R30, R30b). SQL
 * Server's usual collation ignores letter case and trailing spaces, so `IN ('ABC')` also returns
 * rows keyed `abc` or `ABC `. Three steps, in order, stopping at the first that matches:
 *  1. a page key equal to `value`;
 *  2. a page key equal to it once trailing spaces are removed from both;
 *  3. a page key equal to it once trailing spaces are removed and ASCII letters folded to one case.
 * A step that matches more than one page key is a fault at that step, and the later steps are not
 * tried. So on a case-sensitive source with `abc` and `ABC` on one page, a row `abc ` is `abc`.
 * No match at any step, or a fault: null, a fault of the plugin or the data.
 * `pageKeys` is indexed on first use and must not change afterwards.
 */
export function matchPageKey(pageKeys: string[], value: string): string | null {
  let index = keyIndexes.get(pageKeys);
  if (!index) {
    index = { exact: new Set(pageKeys), spaces: indexBy(pageKeys, spaceStep), cased: indexBy(pageKeys, caseStep) };
    keyIndexes.set(pageKeys, index);
  }
  if (index.exact.has(value)) return value;
  const spaced = spaceStep(value);
  if (index.spaces.has(spaced)) return index.spaces.get(spaced) ?? null;
  return index.cased.get(foldAscii(spaced)) ?? null;
}

export function createSourceReader(deps: SourceReaderDeps): SourceReader {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let db: ConnectorDb | null = null;
  /** True once a query on this reader has answered. */
  let readOnce = false;

  /** Forget the current connection. A close on a cut link can hang, so it is not awaited. */
  function drop(): void {
    const old = db;
    db = null;
    if (old) void old.close().catch(() => undefined);
  }

  async function sourceRows(sql: string): Promise<Array<Record<string, unknown>>> {
    validateSelectSql(sql);
    try {
      if (!db) db = await deps.open();
      const { rows } = await db.query(sql);
      readOnce = true;
      return rows;
    } catch (err) {
      throw new SourceFailure(err);
    }
  }

  /** True when the source answers `SELECT 1` within 5 seconds, on a connection of its own. */
  async function probe(): Promise<boolean> {
    validateSelectSql(PROBE_SQL);
    let conn: ConnectorDb | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answered = (async () => {
      conn = await deps.open({ queryTimeoutMs: PROBE_TIMEOUT_MS });
      await conn.query(PROBE_SQL);
      return true;
    })().catch(() => false);
    const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS); });
    try {
      return await Promise.race([answered, late]);
    } finally {
      clearTimeout(timer);
      const shut = () => { if (conn) void conn.close().catch(() => undefined); };
      // An open that has not finished yet is closed when it does.
      if (conn) shut();
      else void answered.then(shut);
    }
  }

  /** Wait before try `attempt`. True when a stop was asked for during the wait. */
  async function wait(attempt: number, error: string): Promise<boolean> {
    await deps.onWaiting({ attempt, error });
    let left = retryWaitMs(attempt);
    while (left > 0) {
      if (await deps.stopWanted()) return true;
      const slice = Math.min(SLICE_MS, left);
      await sleep(slice);
      left -= slice;
    }
    await deps.onWaiting(null);
    return false;
  }

  return {
    async readPage(input) {
      const { keySql, details, after, checkRowKeys = false, readBefore = false } = input;
      let size = input.size;
      // Check every statement before opening a connection or running any of them.
      validateSelectSql(fillKeyQuery(keySql, after, size));
      for (const d of details) validateSelectSql(fillDetailQuery(d.sql, ['A']));

      /** The try number of the next wait. */
      let attempt = 0;
      let slowKey: string | null = null;
      let slowCount = 0;
      /** Losses in a row whose probe answered. Anything else between two losses sets it to 0. */
      let losses = 0;
      /** Waits on a source that may be starting up. */
      let startingTries = 0;
      for (;;) {
        let keys: string[] = [];
        let readingDetails = false;
        try {
          const keyRows = await sourceRows(fillKeyQuery(keySql, after, size));
          if (keyRows.length === 0) return { kind: 'end' };
          keys = keyRows.map(firstColumn);
          for (const key of keys) assertSafeKey(key);
          if (keys[keys.length - 1] === after) throw new Error('the key query made no progress past the last key');

          readingDetails = true;
          const rows: Record<string, Array<Record<string, unknown>>> = {};
          for (const d of details) {
            const got = (await sourceRows(fillDetailQuery(d.sql, keys))).map(toPluginRow);
            if (checkRowKeys && got.some((row) => matchPageKey(keys, firstColumn(row)) === null)) {
              throw new Error(`a row of detail query ${d.name} has a first column that is not a key of the page`);
            }
            rows[d.name] = got;
          }
          return { kind: 'page', keys, keyRows: keyRows.map(toPluginRow), rows, size };
        } catch (err) {
          if (!(err instanceof SourceFailure)) throw err;
          const error = describeSourceError(err.cause, deps.clean);
          let kind = classifySourceError(err.cause);
          if (kind === 'refused') {
            // After a restart SQL Server takes logins before its databases have recovered (R45).
            // A run that has read this source before waits on that, like a lost link.
            const mayBeStarting = (readBefore || readOnce) && isSourceStartingUp(err.cause);
            if (!mayBeStarting || startingTries >= STARTING_UP_TRIES) throw new Error(error);
            startingTries += 1;
            losses = 0;
            drop();
            attempt += 1;
            if (await wait(attempt, deps.clean(`${STARTING_UP_LEAD}${error}`))) return { kind: 'stopped' };
            continue;
          }
          // A timed-out connection may be dead even when a fresh one answers (a half-open
          // socket), so it is dropped on a timeout as well as on a lost link.
          drop();
          // The probe tells an outage from a page that is too big or a link that keeps dropping.
          const answered = await probe();
          if (kind === 'timeout' && !answered) kind = 'lost';
          // Counted only when the source still answers. A loss whose probe failed is an outage.
          losses = kind === 'lost' && answered ? losses + 1 : 0;

          if (kind === 'timeout' && size > 1) {
            if (await deps.stopWanted()) return { kind: 'stopped' };
            size = shrinkPage(size);
            continue;
          }
          if (kind === 'timeout' && readingDetails) {
            // A page of 1: this one key is too slow to read.
            const key = keys[0];
            if (key !== slowKey) { slowKey = key; slowCount = 0; }
            slowCount += 1;
            if (slowCount >= SKIP_AFTER) return { kind: 'skipped', key };
            if (await deps.stopWanted()) return { kind: 'stopped' };
            continue;
          }
          // R40. A page lost twice in a row while the source answers is halved, so a link that drops
          // more often than one page takes can still finish a page. The wait starts again at 5 s.
          // At a page of 1 nothing is halved and no key is skipped: the wait keeps growing.
          if (losses >= HALVE_AFTER_LOSSES && size > 1) {
            size = shrinkPage(size);
            losses = 0;
            attempt = 0;
          }
          // A lost link, or a key query that times out at a page of 1. No key is known to skip,
          // so it is waited on and retried. The wait asks for a stop before each slice.
          attempt += 1;
          if (await wait(attempt, error)) return { kind: 'stopped' };
        }
      }
    },

    /** A close after a cut link can hang, so the caller's `finally` is not held up by it. */
    async close() {
      drop();
    },
  };
}
