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

/** Order matters. An unknown error is `lost`, so it is retried and shown rather than ending the
 *  run: the complaint this answers is a run that stops and waits for a person. */
export function classifySourceError(err: unknown): SourceErrorKind {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; number?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT' || /timeout|timed out/i.test(message)) return 'timeout';
  if (code === 'ELOGIN') return 'refused';
  const hint = classifyConnectError(message);
  if (hint === 'loginFailed' || hint === 'databaseMissing') return 'refused';
  if (code === 'EREQUEST') return e.number === DEADLOCK_VICTIM ? 'lost' : 'refused';
  return 'lost';
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
