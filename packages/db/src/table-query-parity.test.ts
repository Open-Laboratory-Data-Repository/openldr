import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import type { Kysely } from "kysely";
import { buildFilterExpression } from "./table-query-sql";
import { DATE_ONLY, type ParsedFilter, type TableColumnMap } from "@openldr/table-query";

// Cross-implementation parity test. Tasks 3/4 built a SQL translator that is supposed
// to select the same rows a server-paginated page's SQL WHERE clause would, as the
// browser-side `applyTableState` would for a client-paginated page (apps/studio/src/
// components/data-table/applyTableState.ts). Slice A ships with no live callers of the
// translator, so nothing else in the codebase would notice if the two disagreed — this
// test is that notice. If a case here fails, the SQL is wrong; the client is the
// reference, because nine studio pages already behave that way (AGENTS.md task brief).
//
// `applyTableState` lives in apps/studio; this package cannot import across the app
// boundary (AGENTS.md), so `matchesRule`/`compareValues`/the left-to-right fold below
// are a faithful line-for-line copy of applyTableState.ts:11-27 (compareValues),
// :29-56 (matchesRule), and :83-93 (the fold). Any semantic change to that file needs
// the same change made here, or this test stops meaning anything.
//
// NOT covered here: LIKE-wildcard escaping. pg-mem's SQL parser has no support at all
// for the `ESCAPE` keyword (a hard parse error, not a semantic gap — see table-query-sql.test.ts,
// same deferral), and escaping is the one case that must emit it. That proof lives in
// table-query-pagination.live.test.ts's "LIKE wildcard escaping (live Postgres)" block.
//
// NOT covered here: timezone-dependent day-boundary resolution. The day-aware eq/ne/between
// cases below all assume the SQL side's `day::timestamptz` and the client's dayBoundsMs (UTC,
// per ECMA-262) resolve the same midnight — true only when the database connection's TimeZone
// is UTC, which the shipped compose gives by default but nothing enforces. pg-mem has no
// timezone support at all, so it can never demonstrate the two sides disagreeing under a
// non-UTC connection TimeZone. See the ASSUMPTION comments at table-query-sql.ts's day-range
// branches (eq/ne/between) and applyTableState.ts's dayBoundsMs.

const COLUMNS: TableColumnMap = {
  name: { sql: "name", type: "text", operators: ["eq", "ne", "like", "in", "is_null", "is_not_null"], sortable: true },
  weight: { sql: "weight", type: "number", operators: ["gt", "gte", "lt", "lte", "between"], sortable: true },
  // Mirrors audit's occurredAt: a timestamptz-shaped column, so eq/ne/between get the day-aware
  // expansion (C1) instead of the plain string/compareValues path the other columns use.
  occurredAt: { sql: "occurredAt", type: "date", operators: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"], sortable: true },
};

const ROWS = [
  // occurredAt: day A early, day A late, null, day B exact midnight, day C (before A).
  { id: "1", name: "alpha", weight: 10, occurredAt: "2026-08-06T01:18:19.491Z" as string | null },
  { id: "2", name: "BETA", weight: 5, occurredAt: "2026-08-06T23:59:59.999Z" as string | null },
  { id: "3", name: null as string | null, weight: 1, occurredAt: null as string | null },
  { id: "4", name: "", weight: 7, occurredAt: "2026-08-07T00:00:00.000Z" as string | null },
  // NULL weight: exercises compareValues' null-handling branch for gt/gte/lt/lte, which none of
  // the rows above did. This is the same fixture gap that hid Fix 2 (NULLS ordering) — a filter
  // or sort that never sees a null in its test data can look correct while disagreeing on real
  // nullable columns (eight nullable facility columns, audit's actorId).
  { id: "5", name: "epsilon", weight: null as number | null, occurredAt: "2026-08-05T12:00:00.000Z" as string | null },
];

// --- copied from applyTableState.ts:17-27 ---
function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b));
}

// --- copied from applyTableState.ts:35-70 (parseDateMs, dayBoundsMs, matchesRule) ---
function parseDateMs(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function dayBoundsMs(day: string): [number, number] {
  const start = Date.parse(day);
  return [start, start + 24 * 60 * 60 * 1000];
}

function matchesRule(value: unknown, operator: string, target: unknown, columnType?: string): boolean {
  switch (operator) {
    case "eq": {
      if (columnType === "date" && typeof target === "string") {
        if (DATE_ONLY.test(target.trim())) {
          const valueMs = parseDateMs(value);
          if (valueMs !== null) {
            const [start, end] = dayBoundsMs(target.trim());
            return valueMs >= start && valueMs < end;
          }
        } else {
          const valueMs = parseDateMs(value);
          const targetMs = parseDateMs(target);
          if (valueMs !== null && targetMs !== null) return valueMs === targetMs;
        }
      }
      return String(value ?? "") === String(target);
    }
    case "ne": {
      if (columnType === "date" && typeof target === "string") {
        if (value === null || value === undefined || value === "") return true;
        if (DATE_ONLY.test(target.trim())) {
          const valueMs = parseDateMs(value);
          if (valueMs !== null) {
            const [start, end] = dayBoundsMs(target.trim());
            return !(valueMs >= start && valueMs < end);
          }
        } else {
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
    case "gt":
      return compareValues(value, Array.isArray(target) ? target[0] : target) > 0;
    case "gte":
      return compareValues(value, Array.isArray(target) ? target[0] : target) >= 0;
    case "lt":
      return compareValues(value, Array.isArray(target) ? target[0] : target) < 0;
    case "lte":
      return compareValues(value, Array.isArray(target) ? target[0] : target) <= 0;
    case "between": {
      if (!Array.isArray(target) || target.length !== 2) return false;
      if (columnType === "date") {
        const [lo, hi] = target;
        const valueMs = parseDateMs(value);
        const loMs = parseDateMs(lo);
        if (valueMs !== null && loMs !== null && typeof hi === "string" && DATE_ONLY.test(hi.trim())) {
          const [, hiEnd] = dayBoundsMs(hi.trim());
          return valueMs >= loMs && valueMs < hiEnd;
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
    case "is_null":
      return value === null || value === undefined || value === "";
    case "is_not_null":
      return !(value === null || value === undefined || value === "");
    default:
      throw new Error(`unhandled operator ${operator}`);
  }
}

// --- copied from applyTableState.ts:83-93 (the left-to-right fold) ---
function clientIds(filters: ParsedFilter[]): string[] {
  return ROWS.filter((row) => {
    if (filters.length === 0) return true;
    let result = true;
    for (let i = 0; i < filters.length; i++) {
      const rule = filters[i]!;
      const value = (row as Record<string, unknown>)[rule.column];
      const match = matchesRule(value, rule.operator, rule.value, COLUMNS[rule.column]?.type);
      if (i === 0) result = match;
      else if (rule.combine === "or") result = result || match;
      else result = result && match;
    }
    return result;
  }).map((r) => r.id);
}

// Same pg-mem-backed-Kysely harness Task 4 uses in table-query-sql.test.ts.
function makeDb(): Kysely<any> {
  const mem = newDb();
  return mem.adapters.createKysely();
}

async function sqlIds(filters: ParsedFilter[]): Promise<string[]> {
  const db = makeDb();
  await db.schema.createTable("t")
    .addColumn("id", "text")
    .addColumn("name", "text")
    .addColumn("weight", "integer")
    .addColumn("occurredAt", "timestamptz")
    .execute();
  // pg-mem's timestamptz column needs a Date, not the ISO string ROWS carries for the client side.
  await db.insertInto("t").values(ROWS.map((r) => ({ ...r, occurredAt: r.occurredAt === null ? null : new Date(r.occurredAt) }))).execute();
  const rows = await db
    .selectFrom("t")
    .select("id")
    .where((eb: any) => buildFilterExpression(eb, filters, COLUMNS) ?? eb.val(true))
    .orderBy("id")
    .execute();
  return rows.map((r: any) => r.id);
}

const CASES: { label: string; filters: ParsedFilter[] }[] = [
  { label: "eq", filters: [{ column: "name", operator: "eq", value: "alpha", combine: "and" }] },
  { label: "ne over a null", filters: [{ column: "name", operator: "ne", value: "alpha", combine: "and" }] },
  { label: "like mixed case", filters: [{ column: "name", operator: "like", value: "bet", combine: "and" }] },
  { label: "like empty needle", filters: [{ column: "name", operator: "like", value: "", combine: "and" }] },
  { label: "in empty set", filters: [{ column: "name", operator: "in", value: [], combine: "and" }] },
  { label: "in non-empty set", filters: [{ column: "name", operator: "in", value: ["alpha", "BETA"], combine: "and" }] },
  { label: "is_null", filters: [{ column: "name", operator: "is_null", value: "", combine: "and" }] },
  { label: "is_not_null", filters: [{ column: "name", operator: "is_not_null", value: "", combine: "and" }] },
  { label: "gt", filters: [{ column: "weight", operator: "gt", value: "5", combine: "and" }] },
  { label: "gte", filters: [{ column: "weight", operator: "gte", value: "5", combine: "and" }] },
  { label: "lt", filters: [{ column: "weight", operator: "lt", value: "7", combine: "and" }] },
  { label: "lte", filters: [{ column: "weight", operator: "lte", value: "7", combine: "and" }] },
  { label: "between inclusive", filters: [{ column: "weight", operator: "between", value: ["5", "10"], combine: "and" }] },
  {
    // Contract table row: "non-2-element target returns FALSE" on both sides. `value` is typed
    // [string, string], but that's a compile-time guarantee only — a caller that builds a
    // ParsedFilter by hand (or a parser bug) could still hand this a 1-element array, so the
    // cast below is deliberate, not a typo.
    label: "between with a malformed (non-2-element) target",
    filters: [{ column: "weight", operator: "between", value: ["5"] as unknown as [string, string], combine: "and" }],
  },
  {
    label: "A and B or C",
    filters: [
      { column: "name", operator: "eq", value: "alpha", combine: "and" },
      { column: "weight", operator: "gt", value: "100", combine: "and" },
      { column: "name", operator: "eq", value: "BETA", combine: "or" },
    ],
  },
  {
    label: "A or B and C",
    filters: [
      { column: "name", operator: "eq", value: "alpha", combine: "and" },
      { column: "name", operator: "eq", value: "BETA", combine: "or" },
      { column: "weight", operator: "gt", value: "100", combine: "and" },
    ],
  },
  // C1: date-only eq/ne/between must select the whole day, not the single midnight instant a
  // bare comparison would. Rows 1+2 fall on 2026-08-06, row 4 is the very next midnight, row 5 is
  // the day before, and row 3 has a null occurredAt (exercises ne's null-still-included rule).
  { label: "date eq on a date-only value matches the whole day", filters: [{ column: "occurredAt", operator: "eq", value: "2026-08-06", combine: "and" }] },
  { label: "date ne on a date-only value excludes the whole day but keeps null", filters: [{ column: "occurredAt", operator: "ne", value: "2026-08-06", combine: "and" }] },
  { label: "date between with date-only bounds includes the end day in full", filters: [{ column: "occurredAt", operator: "between", value: ["2026-08-06", "2026-08-06"], combine: "and" }] },
  { label: "date between spanning multiple date-only days", filters: [{ column: "occurredAt", operator: "between", value: ["2026-08-05", "2026-08-06"], combine: "and" }] },
  // C1 fix: eq/ne with a *full timestamp* value on a date column is reachable — the CLI's
  // `--where` flag passes a raw value straight through parseTableQuery, which accepts any
  // PG_DATE-shaped string, not just DATE_ONLY. Row 1 is the only row at this exact instant.
  { label: "date eq on a full-timestamp value matches only that instant", filters: [{ column: "occurredAt", operator: "eq", value: "2026-08-06T01:18:19.491Z", combine: "and" }] },
  { label: "date ne on a full-timestamp value excludes only that instant but keeps null", filters: [{ column: "occurredAt", operator: "ne", value: "2026-08-06T01:18:19.491Z", combine: "and" }] },
];

describe("client and SQL filters select the same rows", () => {
  for (const c of CASES) {
    it(c.label, async () => {
      expect(await sqlIds(c.filters)).toEqual(clientIds(c.filters));
    });
  }
});
