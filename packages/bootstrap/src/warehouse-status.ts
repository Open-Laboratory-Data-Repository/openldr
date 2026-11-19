import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';

// How far the warehouse is behind the records saved. Every saved record adds a row to
// `fhir.change_log`, numbered in order. The projection copies changes to the warehouse and keeps the
// number it has reached in `fhir.change_cursors`. The gap between the two is what the dashboard and
// the reports cannot see yet. During a large import that gap was half of everything saved, and no
// screen or command showed it.

/** One reading of the two numbers. */
export interface WarehouseReading {
  /** The number of the newest saved change. */
  head: number;
  /** The number the warehouse has reached. */
  cursor: number;
  /** Changes saved and not yet in the warehouse. */
  behind: number;
  /** Records the warehouse refused, which wait for another try. */
  waitingRetry: number;
  /** When the oldest change still waiting was saved. Null when nothing waits. */
  oldestWaitingAt: string | null;
  readAt: string;
}

/** A reading, with what a second reading adds: how fast the gap is closing. */
export interface WarehouseStatus extends WarehouseReading {
  /** Changes the warehouse took in a second, between the two readings. Null with one reading. */
  appliedPerSecond: number | null;
  /** Seconds until the warehouse is up to date at the rate the gap is closing. Null with one
   *  reading, when nothing waits, and when the gap is not closing. */
  secondsLeft: number | null;
  /** True when the gap grew between the two readings: records are saved faster than the warehouse
   *  takes them, as during an import. */
  fallingBehind: boolean;
}

export async function readWarehouseReading(db: Kysely<InternalSchema>, now: () => Date = () => new Date()): Promise<WarehouseReading> {
  const top = await db.selectFrom('fhir.change_log').select((eb) => eb.fn.max('seq').as('m')).executeTakeFirst();
  const cur = await db.selectFrom('fhir.change_cursors').select('last_seq').where('consumer', '=', 'projection').executeTakeFirst();
  const retries = await db.selectFrom('fhir.projection_retries').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst();
  // bigint reads back as a string on real PostgreSQL.
  const head = Number(top?.m ?? 0);
  const cursor = Number(cur?.last_seq ?? 0);
  const behind = Math.max(head - cursor, 0);
  let oldestWaitingAt: string | null = null;
  if (behind > 0) {
    const oldest = await db.selectFrom('fhir.change_log').select('recorded_at').where('seq', '>', cursor).orderBy('seq').limit(1).executeTakeFirst();
    if (oldest?.recorded_at) oldestWaitingAt = new Date(oldest.recorded_at as unknown as string | number | Date).toISOString();
  }
  return { head, cursor, behind, waitingRetry: Number(retries?.n ?? 0), oldestWaitingAt, readAt: now().toISOString() };
}

/** Two readings closer together than this say nothing reliable about a rate. */
export const MIN_RATE_WINDOW_MS = 2000;
/** An earlier reading older than this is from before whatever is happening now. */
export const MAX_RATE_WINDOW_MS = 5 * 60 * 1000;

/** Adds the rate to `current`, measured from `earlier`. One formula for the server and the CLI. */
export function withRate(earlier: WarehouseReading | null, current: WarehouseReading): WarehouseStatus {
  const none: WarehouseStatus = { ...current, appliedPerSecond: null, secondsLeft: null, fallingBehind: false };
  if (!earlier) return none;
  const ms = Date.parse(current.readAt) - Date.parse(earlier.readAt);
  if (!(ms >= MIN_RATE_WINDOW_MS) || ms > MAX_RATE_WINDOW_MS) return none;
  const seconds = ms / 1000;
  const appliedPerSecond = Math.max(current.cursor - earlier.cursor, 0) / seconds;
  const closingPerSecond = (earlier.behind - current.behind) / seconds;
  return {
    ...current,
    appliedPerSecond: Math.round(appliedPerSecond),
    secondsLeft: current.behind > 0 && closingPerSecond > 0 ? Math.ceil(current.behind / closingPerSecond) : null,
    fallingBehind: current.behind > 0 && closingPerSecond < 0,
  };
}

export interface WarehouseStatusReader {
  /** The status now. The rate comes from the reading this reader kept from an earlier call. */
  read(): Promise<WarehouseStatus>;
}

/** For a long-lived process (the server). It keeps one earlier reading to measure the rate from, and
 *  replaces it only once it is old enough to measure against, so several people watching the screen
 *  at once do not shrink the window to nothing. */
export function createWarehouseStatusReader(db: Kysely<InternalSchema>, now: () => Date = () => new Date()): WarehouseStatusReader {
  let earlier: WarehouseReading | null = null;
  let last: WarehouseStatus | null = null;
  return {
    async read() {
      const current = await readWarehouseReading(db, now);
      if (!earlier) { earlier = current; return withRate(null, current); }
      const ms = Date.parse(current.readAt) - Date.parse(earlier.readAt);
      if (ms < MIN_RATE_WINDOW_MS) {
        // Too soon to measure again: the newest numbers, with the rate of the last measurement.
        return last ? { ...current, appliedPerSecond: last.appliedPerSecond, secondsLeft: last.secondsLeft === null || current.behind === 0 ? null : last.secondsLeft, fallingBehind: current.behind > 0 && last.fallingBehind } : withRate(null, current);
      }
      const status = withRate(earlier, current);
      earlier = current;
      last = status;
      return status;
    },
  };
}
