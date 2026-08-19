import { DATE_ONLY } from "@openldr/table-query";
import type { ColumnDef, ColumnType, FilterOperator, FilterRule, SortRule } from "./types";

// Client-side filter/sort/pagination for pages that fetch the full row set in one call.
// Server-side pagination (patient:query, audit:query) bypasses this entirely.

function getFieldValue<T>(row: T, columnId: string, getter?: (r: T) => unknown): unknown {
  if (getter) return getter(row);
  return (row as Record<string, unknown>)[columnId];
}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ms since epoch for a value that Date.parse can read, or null if it can't. */
function parseDateMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `[start, end)` ms bounds for a bare calendar date, so a day-aware filter selects the whole day
 * rather than the single midnight instant a bare comparison would. Mirrors table-query-sql.ts's
 * `col >= day::timestamptz and col < day::timestamptz + interval '1 day'`. `Date.parse` reads a
 * bare `YYYY-MM-DD` as UTC midnight per the ECMA-262 date-time string spec.
 *
 * ASSUMPTION, not enforced here: this resolves the day boundary in UTC, always. The SQL side
 * resolves `day::timestamptz` in the database connection's `TimeZone`, which `createInternalDb`
 * leaves unset. The two agree only because the shipped compose sets no `TZ` (session default is
 * UTC) — an externally provisioned Postgres with a non-UTC default shifts the whole day window,
 * and this function and the SQL side would then select different rows for the same filter. No
 * test can catch that: pg-mem has no timezone support. Do not "fix" this without checking with
 * the operator first — it needs a coordinated change on both sides, not a silent one here.
 */
function dayBoundsMs(day: string): [number, number] {
  const start = Date.parse(day);
  return [start, start + 24 * 60 * 60 * 1000];
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;

  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;

  // Fallback to locale string comparison (covers dates as ISO strings and text).
  return String(a).localeCompare(String(b));
}

function matchesRule(
  value: unknown,
  operator: FilterOperator,
  target: FilterRule["value"],
  columnType?: ColumnType,
): boolean {
  switch (operator) {
    case "eq": {
      // A date column's "eq 2026-08-06" means the whole day, not the single midnight instant a
      // string comparison would match — `value` is a full timestamp string once it round-trips
      // through the server, so a plain `String(value) === "2026-08-06"` never matches. Only
      // expand when the target is date-only. Mirrors table-query-sql.ts's "eq".
      if (columnType === "date" && typeof target === "string") {
        if (DATE_ONLY.test(target.trim())) {
          const valueMs = parseDateMs(value);
          if (valueMs !== null) {
            const [start, end] = dayBoundsMs(target.trim());
            return valueMs >= start && valueMs < end;
          }
        } else {
          // A full-timestamp target: compare as instants, not strings — `value` and `target` can
          // both be valid ISO representations of the same instant with different text (e.g.
          // differing millisecond precision), which a plain `String(value) === String(target)`
          // would wrongly call a mismatch. Falls through to the string comparison below only
          // when either side isn't Date.parse-able.
          const valueMs = parseDateMs(value);
          const targetMs = parseDateMs(target);
          if (valueMs !== null && targetMs !== null) return valueMs === targetMs;
        }
      }
      return String(value ?? "") === String(target);
    }
    case "ne": {
      // Negation of "eq" above, with the same NULL/empty-is-a-mismatch rule the plain string
      // comparison already gives every other "ne": a null/undefined/"" value stays included.
      if (columnType === "date" && typeof target === "string") {
        if (value === null || value === undefined || value === "") return true;
        if (DATE_ONLY.test(target.trim())) {
          const valueMs = parseDateMs(value);
          if (valueMs !== null) {
            const [start, end] = dayBoundsMs(target.trim());
            return !(valueMs >= start && valueMs < end);
          }
        } else {
          // Same full-timestamp reasoning as "eq" above, negated.
          const valueMs = parseDateMs(value);
          const targetMs = parseDateMs(target);
          if (valueMs !== null && targetMs !== null) return valueMs !== targetMs;
        }
      }
      return String(value ?? "") !== String(target);
    }
    case "like": {
      const needle = (Array.isArray(target) ? target.join(",") : String(target ?? "")).toLowerCase();
      if (!needle) return true;
      return String(value ?? "").toLowerCase().includes(needle);
    }
    case "gt":  return compareValues(value, Array.isArray(target) ? target[0] : target) > 0;
    case "gte": return compareValues(value, Array.isArray(target) ? target[0] : target) >= 0;
    case "lt":  return compareValues(value, Array.isArray(target) ? target[0] : target) < 0;
    case "lte": return compareValues(value, Array.isArray(target) ? target[0] : target) <= 0;
    case "between": {
      if (!Array.isArray(target) || target.length !== 2) return false;
      // Date columns: the lower bound needs no change — a date-only `lo` already means "from the
      // start of that day" under a plain `>=`. Only the upper bound needs adjusting: a date-only
      // `hi` compared with `<=` stops at that day's midnight, excluding almost all of the end
      // day. Expand a date-only `hi` to "before the start of the following day". A full-timestamp
      // `hi` is honoured exactly via the plain compareValues fallback. Mirrors table-query-sql.ts.
      if (columnType === "date") {
        const [lo, hi] = target;
        const valueMs = parseDateMs(value);
        const loMs = parseDateMs(lo);
        if (valueMs !== null && loMs !== null) {
          if (typeof hi === "string" && DATE_ONLY.test(hi.trim())) {
            const [, hiEnd] = dayBoundsMs(hi.trim());
            return valueMs >= loMs && valueMs < hiEnd;
          }
        }
      }
      return compareValues(value, target[0]) >= 0 && compareValues(value, target[1]) <= 0;
    }
    case "in": {
      const set = Array.isArray(target)
        ? target.map((s) => String(s))
        : String(target ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (set.length === 0) return false;
      return set.includes(String(value ?? ""));
    }
    case "is_null":     return value === null || value === undefined || value === "";
    case "is_not_null": return !(value === null || value === undefined || value === "");
  }
}

export interface TableStateValueGetters<T> {
  /** Optional per-column getter. Defaults to row[column.id]. */
  [columnId: string]: (row: T) => unknown;
}

export function applyTableState<T>(
  allRows: T[],
  state: {
    filters: FilterRule[];
    sorts: SortRule[];
    page: number;
    pageSize: number;
  },
  columns: ColumnDef<T>[],
  valueGetters?: TableStateValueGetters<T>,
): { rows: T[]; total: number } {
  const columnsById = new Map(columns.map((c) => [c.id, c] as const));

  // ─── Filter ────────────────────────────────────────────────
  let filtered = allRows;
  if (state.filters.length > 0) {
    filtered = allRows.filter((row) => {
      // Left-to-right evaluation with explicit AND/OR. Matches the backend's
      // flat combine semantics: `A AND B OR C` == `(A AND B) OR C`.
      // First rule has no connector; subsequent rules apply their `combine`.
      let result = true;
      for (let i = 0; i < state.filters.length; i++) {
        const rule = state.filters[i]!;
        const col = columnsById.get(rule.column);
        const getter = valueGetters?.[rule.column];
        const value = col ? getFieldValue(row, rule.column, getter) : (row as Record<string, unknown>)[rule.column];
        const match = matchesRule(value, rule.operator, rule.value, col?.type);
        if (i === 0) result = match;
        else if (rule.combine === "or") result = result || match;
        else result = result && match;
      }
      return result;
    });
  }

  // ─── Sort ──────────────────────────────────────────────────
  if (state.sorts.length > 0) {
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      for (const s of state.sorts) {
        const getter = valueGetters?.[s.column];
        const av = getFieldValue(a, s.column, getter);
        const bv = getFieldValue(b, s.column, getter);
        // For dates/timestamps stored as Date-parseable strings, coerce to ms for proper order.
        const an = typeof av === "string" && !Number.isNaN(Date.parse(av)) ? Date.parse(av) : av;
        const bn = typeof bv === "string" && !Number.isNaN(Date.parse(bv)) ? Date.parse(bv) : bv;
        const num = coerceNumber(an) !== null && coerceNumber(bn) !== null
          ? (coerceNumber(an)! - coerceNumber(bn)!)
          : compareValues(av, bv);
        if (num !== 0) return s.ascending ? num : -num;
      }
      // The server appends `id asc` to every sort as a tiebreaker (table-query-sql.ts
      // applySorts), and deliberately does so without COLLATE — plain byte order, not an
      // ICU-aware order. Mirror that with `<`/`>` rather than String.localeCompare, which is
      // locale-aware and can disagree with byte order outside plain ASCII. Rows without a
      // string `id` field fall through to 0 (no tiebreak), so id-less row sets keep today's
      // stable-sort behavior instead of throwing or reordering arbitrarily.
      //
      // BLAST RADIUS: applyTableState is the shared client-side sorter for every page that fetches
      // its full row set in one call (see the file banner above) — not just the studio tables that
      // show a tiebreaker's effect on screen. apps/studio/src/reports/ReportSpreadsheetTab.tsx
      // feeds this same sort into the XLSX export. Rows there are `Record<string, unknown>`, so
      // any report whose SQL result happens to include an `id` column now exports tied rows in
      // this id-ascending order instead of whatever order the database returned them in. That is
      // a deliberate, accepted change (the operator wants deterministic tie order everywhere this
      // function runs) — noted here so the next person touching this line knows report exports
      // are downstream of it, not just on-screen studio tables.
      const aId = (a as Record<string, unknown>).id;
      const bId = (b as Record<string, unknown>).id;
      if (typeof aId === "string" && typeof bId === "string") {
        if (aId < bId) return -1;
        if (aId > bId) return 1;
      }
      return 0;
    });
    filtered = sorted;
  }

  // ─── Paginate ──────────────────────────────────────────────
  const total = filtered.length;
  const start = state.page * state.pageSize;
  const rows = filtered.slice(start, start + state.pageSize);

  return { rows, total };
}
