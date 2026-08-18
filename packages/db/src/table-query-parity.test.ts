import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import type { Kysely } from "kysely";
import { buildFilterExpression } from "./table-query-sql";
import type { ParsedFilter, TableColumnMap } from "@openldr/table-query";

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
// for the `ESCAPE` keyword (a hard parse error, not a semantic gap — see Task 4's
// table-query-sql.test.ts, same deferral), and escaping is the one case that must emit
// it. Deferred to Task 6's live-Postgres test.

const COLUMNS: TableColumnMap = {
  name: { sql: "name", type: "text", operators: ["eq", "ne", "like", "in", "is_null", "is_not_null"], sortable: true },
  weight: { sql: "weight", type: "number", operators: ["gt", "gte", "lt", "lte", "between"], sortable: true },
};

const ROWS = [
  { id: "1", name: "alpha", weight: 10 },
  { id: "2", name: "BETA", weight: 5 },
  { id: "3", name: null as string | null, weight: 1 },
  { id: "4", name: "", weight: 7 },
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

// --- copied from applyTableState.ts:29-56 ---
function matchesRule(value: unknown, operator: string, target: unknown): boolean {
  switch (operator) {
    case "eq":
      return String(value ?? "") === String(target);
    case "ne":
      return String(value ?? "") !== String(target);
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
      const match = matchesRule(value, rule.operator, rule.value);
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
  await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
  await db.insertInto("t").values(ROWS).execute();
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
];

describe("client and SQL filters select the same rows", () => {
  for (const c of CASES) {
    it(c.label, async () => {
      expect(await sqlIds(c.filters)).toEqual(clientIds(c.filters));
    });
  }
});
