import { validateSelectSql } from '@openldr/dashboards';
import type { ConnectorDb } from './connector-db';
import { classifySourceError, retryWaitMs, shrinkPage } from './import-retry';
import { assertSafeKey, fillDetailQuery, fillKeyQuery, toPluginRow } from './import-sql';

// Reads one page of a source database: the key query, then every detail query for those keys.
// It is used by the one-pass import and by the copy, and it decides what a failed query means:
//  - a lost link: close the connection, wait, open a new one and read the same page again;
//  - a timeout: send the source `SELECT 1` with a 5-second limit. No answer means the link is
//    down, so it is a lost link and the page size stays. An answer means the page was too big,
//    so the page is halved and read again, down to 1;
//  - a key whose details time out 3 times at a page of 1 is handed back as skipped;
//  - an error the source returned, such as a missing table, is thrown to the caller.
// The reader keeps no position. The caller passes `after` and `size` on every call.

export type PageResult =
  | {
    kind: 'page';
    keys: string[];
    /** The key query's own rows, through toPluginRow, in order. */
    keyRows: Array<Record<string, unknown>>;
    /** Keyed by detail query name, as the plugin's `map` expects. */
    rows: Record<string, Array<Record<string, unknown>>>;
    /** The page size this page was read at. Smaller than asked when a timeout halved it. */
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

/** An error from `open` or `db.query`. Only these are classified and may be retried. Every other
 *  error (a statement that is not one SELECT, an unsafe key, a row filed under a wrong key) is a
 *  fault of the plugin or the data and is thrown as it is. */
class SourceFailure {
  constructor(readonly cause: unknown) {}
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(err);
}

function firstColumn(row: Record<string, unknown>): string {
  return String(Object.values(row)[0] ?? '');
}

export function createSourceReader(deps: SourceReaderDeps): SourceReader {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let db: ConnectorDb | null = null;

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
      return (await db.query(sql)).rows;
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
      const { keySql, details, after, checkRowKeys = false } = input;
      let size = input.size;
      // Check every statement before opening a connection or running any of them.
      validateSelectSql(fillKeyQuery(keySql, after, size));
      for (const d of details) validateSelectSql(fillDetailQuery(d.sql, ['A']));

      let attempt = 0;
      let slowKey: string | null = null;
      let slowCount = 0;
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
          const pageKeys = new Set(keys);
          const rows: Record<string, Array<Record<string, unknown>>> = {};
          for (const d of details) {
            const got = (await sourceRows(fillDetailQuery(d.sql, keys))).map(toPluginRow);
            if (checkRowKeys && got.some((row) => !pageKeys.has(firstColumn(row)))) {
              throw new Error(`a row of detail query ${d.name} has a first column that is not a key of the page`);
            }
            rows[d.name] = got;
          }
          return { kind: 'page', keys, keyRows: keyRows.map(toPluginRow), rows, size };
        } catch (err) {
          if (!(err instanceof SourceFailure)) throw err;
          const error = deps.clean(errorText(err.cause));
          let kind = classifySourceError(err.cause);
          if (kind === 'refused') throw new Error(error);
          if (kind === 'timeout' && !(await probe())) kind = 'lost';

          if (kind === 'timeout' && size > 1) {
            size = shrinkPage(size);
            continue;
          }
          if (kind === 'timeout' && readingDetails) {
            // A page of 1: this one key is too slow to read.
            const key = keys[0];
            if (key !== slowKey) { slowKey = key; slowCount = 0; }
            slowCount += 1;
            if (slowCount >= SKIP_AFTER) return { kind: 'skipped', key };
            continue;
          }
          // A lost link, or a key query that times out at a page of 1. No key is known to skip,
          // so it is waited on and retried.
          if (kind === 'lost') drop();
          attempt += 1;
          if (await wait(attempt, error)) return { kind: 'stopped' };
        }
      }
    },

    async close() {
      const old = db;
      db = null;
      if (old) await old.close();
    },
  };
}
