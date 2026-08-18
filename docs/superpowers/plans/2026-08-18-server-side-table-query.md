# Server-side table filters and sorts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared filter/sort grammar that lets a server-paginated endpoint run exactly the filters the studio toolbar offers — with no consumers wired up yet.

**Architecture:** A new zero-dependency package `@openldr/table-query` holds the rule types, one column map per resource, and the query parser. A separate server-only module in `@openldr/db` turns a parsed query into Kysely expressions. The studio and the server both read the same column map, so the UI cannot offer a filter the server will reject.

**Tech Stack:** TypeScript, Kysely 0.28, Postgres (internal store only), vitest 2.1.8, pg-mem for unit tests, live Postgres for the pagination test.

**Spec:** `docs/superpowers/specs/2026-08-18-server-side-table-query-design.md`

## Global Constraints

- **`@openldr/table-query` has ZERO runtime dependencies.** It is imported by the browser. No Kysely, no `pg`, no Node built-ins.
- **The SQL translator is server-only.** It lives in `@openldr/db` and the studio must never value-import it.
- **The server's fold must match `applyTableState` exactly** — flat, left-to-right: `A AND B OR C` is `(A AND B) OR C` (`apps/studio/src/components/data-table/applyTableState.ts:80-92`).
- **Every sort appends a unique tiebreaker** (the resource primary key), or `ORDER BY` + `OFFSET` is unstable across pages.
- **Rejection is always a typed 400 naming what failed.** A filter is never silently dropped.
- **`FilterRule.id` is never sent to the server** — it is a React key (`types.ts:19`). The wire schema omits it.
- **The internal DB is Postgres only** (`packages/db/src/internal-db.ts:12` hardcodes `PostgresDialect`), so `ILIKE` and `IS DISTINCT FROM` are safe. The multi-dialect target store is out of scope.
- **No `Co-Authored-By` trailers** in commits (AGENTS.md §9).
- **Never claim done without the command and its output** (AGENTS.md §1).
- Test command: `pnpm --filter <pkg> exec vitest run <path>`

---

## File Structure

**Created — `packages/table-query/`** (modelled on `packages/rbac/`):
- `package.json` — private, `type: module`, `exports: { ".": "./src/index.ts" }`, devDeps typescript + vitest only
- `tsconfig.json` — copy `packages/rbac/tsconfig.json`
- `src/types.ts` — the rule types, moved from the studio
- `src/columns.ts` — `TableColumnSpec`, `TableColumnMap`, `AUDIT_COLUMNS`, `FACILITY_COLUMNS`
- `src/parse.ts` — `parseTableQuery`
- `src/index.ts` — barrel

**Created — server-only:**
- `packages/db/src/table-query-sql.ts` — Kysely translation

**Modified:**
- `apps/studio/src/components/data-table/types.ts` — re-export the moved types instead of declaring them
- `apps/studio/package.json` — add `@openldr/table-query`
- `packages/db/package.json` — add `@openldr/table-query`
- `packages/db/src/index.ts` — export the translator

**Task order:** Task 1 moves the types and proves the nine adopted pages still pass. Task 2 adds the column maps. Task 3 is the parser. Task 4 is the SQL. Task 5 is the cross-implementation test that makes Tasks 3 and 4 trustworthy. Task 6 is the live-Postgres pagination test.

---

## The operator semantics table

`applyTableState` already defines what every operator means (`applyTableState.ts:29-56`). The SQL must reproduce it, and several cases do NOT translate to the obvious SQL. This table is the contract for Task 4 — read it before writing any SQL.

| Operator | Client behaviour (`matchesRule`) | Postgres |
|---|---|---|
| `eq` | `String(value ?? "") === String(target)` — NULL compares as `""` | `coalesce(col::text, '') = $1` |
| `ne` | `String(value ?? "") !== String(target)` — NULL is `""`, so NULL ≠ 'x' is **true** | `coalesce(col::text, '') <> $1` |
| `like` | case-insensitive substring; **empty needle returns true** | empty needle → `TRUE`; else `col::text ILIKE '%' \|\| $1 \|\| '%'` with `%`, `_`, `\` escaped |
| `gt` `gte` `lt` `lte` | numeric compare if both parse as numbers, else `localeCompare` | typed comparison on the real column: `col > $1` |
| `between` | inclusive both ends; non-2-element target returns **false** | `col >= $1 AND col <= $2`; non-2-element → `FALSE` |
| `in` | member of the set; **empty set returns false** | empty → `FALSE`; else `coalesce(col::text,'') = ANY($1)` |
| `is_null` | true when null, undefined **or empty string** | `col IS NULL OR col::text = ''` |
| `is_not_null` | negation of the above | `col IS NOT NULL AND col::text <> ''` |

**Why `eq`/`ne`/`in` cast to text but the ordering operators do not:** the client stringifies both sides for equality, so text comparison reproduces it exactly. The ordering operators compare numerically or by date, so they must use the column's real type or `10` sorts before `9`.

**The `ne` row is the one that bites.** Plain SQL `col <> 'x'` evaluates to NULL for a NULL column, so the row is excluded — but the client includes it. `coalesce` is what makes the two agree.

---

## Task 1: The package, and the rule types move into it

**Files:**
- Create: `packages/table-query/package.json`, `packages/table-query/tsconfig.json`, `packages/table-query/src/types.ts`, `packages/table-query/src/index.ts`
- Modify: `apps/studio/src/components/data-table/types.ts`, `apps/studio/package.json`
- Test: `pnpm --filter @openldr/studio test` (the existing suite is the test — nothing may break)

**Interfaces:**
- Consumes: nothing.
- Produces: `FilterOperator`, `FilterCombine`, `FilterRule`, `SortRule`, `ColumnType` from `@openldr/table-query`.

- [ ] **Step 1: Create the package**

`packages/table-query/package.json` — copied from `packages/rbac/package.json`, which is the zero-dependency template:

```json
{
  "name": "@openldr/table-query",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run --testTimeout 30000 --hookTimeout 30000"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

Copy `packages/rbac/tsconfig.json` to `packages/table-query/tsconfig.json` unchanged.

- [ ] **Step 2: Move the rule types**

`packages/table-query/src/types.ts` — these are moved verbatim from `apps/studio/src/components/data-table/types.ts:3-33`. `ColumnDef` stays in the studio: it holds `accessor: (row: T) => ReactNode`, which would drag React into this package.

```ts
export type FilterOperator =
  | "eq" | "ne" | "like" | "gt" | "gte" | "lt" | "lte"
  | "between" | "in" | "is_null" | "is_not_null";

export type FilterCombine = "and" | "or";

export interface FilterRule {
  /** Client-side unique id for React keys. Never sent to the server. */
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | [string, string] | string[];
  combine: FilterCombine;
}

export interface SortRule {
  id: string;
  column: string;
  ascending: boolean;
}

export type ColumnType = "text" | "number" | "date" | "enum";
```

`packages/table-query/src/index.ts`:

```ts
export * from "./types";
```

- [ ] **Step 3: Re-export from the studio, delete the local declarations**

In `apps/studio/src/components/data-table/types.ts`, delete the five moved declarations and put this at the top, keeping `ColumnDef`, `FILTER_OPERATORS`, `validOperators`, `COMBINE_OPTIONS` and `newId` exactly as they are:

```ts
import type { ReactNode } from "react";
export type {
  FilterOperator, FilterCombine, FilterRule, SortRule, ColumnType,
} from "@openldr/table-query";
import type { FilterOperator, ColumnType } from "@openldr/table-query";
```

Add `"@openldr/table-query": "workspace:*"` to `apps/studio/package.json` dependencies, then run `pnpm install`.

- [ ] **Step 4: Run the full studio suite**

Run: `pnpm --filter @openldr/studio test`
Expected: PASS, same count as before the change (200+ files). The nine adopted pages import these types through the `@/components/data-table` barrel, so a broken re-export shows up here immediately.

Also run: `pnpm --filter @openldr/studio typecheck` — expected no output.

- [ ] **Step 5: Commit**

```bash
git add packages/table-query apps/studio/src/components/data-table/types.ts apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(table-query): shared rule types for client and server filtering"
```

---

## Task 2: Column maps for audit and facilities

**Files:**
- Create: `packages/table-query/src/columns.ts`
- Modify: `packages/table-query/src/index.ts`
- Test: `packages/table-query/src/columns.test.ts`

**Interfaces:**
- Consumes: `FilterOperator`, `ColumnType` from Task 1.
- Produces:
  - `interface TableColumnSpec { sql: string; type: ColumnType; operators: FilterOperator[]; sortable: boolean }`
  - `type TableColumnMap = Record<string, TableColumnSpec>`
  - `AUDIT_COLUMNS: TableColumnMap`, `FACILITY_COLUMNS: TableColumnMap`
  - `AUDIT_TIEBREAKER = "id"`, `FACILITY_TIEBREAKER = "id"`

**Context:** the wire id is the key; `sql` is the physical column. They differ where the SQL name is snake_case. Column ids are a public contract — renaming one breaks saved URLs.

- [ ] **Step 1: Write the failing test**

`packages/table-query/src/columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AUDIT_COLUMNS, FACILITY_COLUMNS, AUDIT_TIEBREAKER } from "./columns";

describe("column maps", () => {
  it("names the physical column for every audit entry", () => {
    for (const [id, spec] of Object.entries(AUDIT_COLUMNS)) {
      expect(spec.sql, `${id} must name a SQL column`).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(spec.operators.length, `${id} must allow at least one operator`).toBeGreaterThan(0);
    }
  });

  it("includes the tiebreaker as a sortable column", () => {
    expect(AUDIT_COLUMNS[AUDIT_TIEBREAKER]).toBeDefined();
    expect(AUDIT_COLUMNS[AUDIT_TIEBREAKER]!.sortable).toBe(true);
  });

  it("allows range operators only on date and number columns", () => {
    for (const map of [AUDIT_COLUMNS, FACILITY_COLUMNS]) {
      for (const [id, spec] of Object.entries(map)) {
        if (spec.operators.includes("between")) {
          expect(["date", "number"], `${id} allows between`).toContain(spec.type);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/table-query exec vitest run src/columns.test.ts`
Expected: FAIL — `Failed to resolve import "./columns"`.

- [ ] **Step 3: Write the implementation**

`packages/table-query/src/columns.ts`. The audit columns mirror `audit_events` as read in `packages/audit/src/store.ts:55-70`; the facility columns mirror the equality fields already in `FacilityListQuery` (`apps/studio/src/api.ts:826-835`).

```ts
import type { ColumnType, FilterOperator } from "./types";

export interface TableColumnSpec {
  /** Physical SQL column. May differ from the wire id. */
  sql: string;
  type: ColumnType;
  /** Exactly the operators the server will run. The UI offers no more than this. */
  operators: FilterOperator[];
  sortable: boolean;
}

export type TableColumnMap = Record<string, TableColumnSpec>;

const TEXT_OPS: FilterOperator[] = ["eq", "ne", "like", "in", "is_null", "is_not_null"];
const ENUM_OPS: FilterOperator[] = ["eq", "ne", "in", "is_null", "is_not_null"];
const DATE_OPS: FilterOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "between"];

export const AUDIT_COLUMNS: TableColumnMap = {
  id:         { sql: "id",          type: "text", operators: ["eq", "in"], sortable: true },
  occurredAt: { sql: "occurred_at", type: "date", operators: DATE_OPS,     sortable: true },
  actorType:  { sql: "actor_type",  type: "enum", operators: ENUM_OPS,     sortable: true },
  actorId:    { sql: "actor_id",    type: "text", operators: TEXT_OPS,     sortable: true },
  actorName:  { sql: "actor_name",  type: "text", operators: TEXT_OPS,     sortable: true },
  action:     { sql: "action",      type: "text", operators: TEXT_OPS,     sortable: true },
  entityType: { sql: "entity_type", type: "text", operators: TEXT_OPS,     sortable: true },
  entityId:   { sql: "entity_id",   type: "text", operators: TEXT_OPS,     sortable: true },
};

export const FACILITY_COLUMNS: TableColumnMap = {
  id:            { sql: "id",             type: "text", operators: ["eq", "in"], sortable: true },
  name:          { sql: "name",           type: "text", operators: TEXT_OPS,     sortable: true },
  code:          { sql: "facility_code",  type: "text", operators: TEXT_OPS,     sortable: true },
  country:       { sql: "country",        type: "enum", operators: ENUM_OPS,     sortable: true },
  zone:          { sql: "zone",           type: "enum", operators: ENUM_OPS,     sortable: true },
  region:        { sql: "region",         type: "enum", operators: ENUM_OPS,     sortable: true },
  district:      { sql: "district",       type: "enum", operators: ENUM_OPS,     sortable: true },
  council:       { sql: "council",        type: "enum", operators: ENUM_OPS,     sortable: true },
  status:        { sql: "status",         type: "enum", operators: ENUM_OPS,     sortable: true },
  level:         { sql: "level",          type: "enum", operators: ENUM_OPS,     sortable: true },
  ownership:     { sql: "ownership",      type: "enum", operators: ENUM_OPS,     sortable: true },
  facilitySystem:{ sql: "facility_system",type: "text", operators: TEXT_OPS,     sortable: true },
};

/** Appended to every sort so ORDER BY + OFFSET is stable across pages. */
export const AUDIT_TIEBREAKER = "id";
export const FACILITY_TIEBREAKER = "id";
```

**Before committing, verify every `sql` value against the real schema:**

```bash
grep -n "audit_events" -A 20 packages/db/src/schema/internal.ts
grep -n "facility_registry" -A 30 packages/db/src/schema/internal.ts
```

Correct any name that does not exist and delete any column the schema does not have. A wrong `sql` value is a runtime SQL error, not a type error.

Add `export * from "./columns";` to `packages/table-query/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/table-query exec vitest run src/columns.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/table-query/src/columns.ts packages/table-query/src/columns.test.ts packages/table-query/src/index.ts
git commit -m "feat(table-query): column maps for audit and facility list queries"
```

---

## Task 3: The query parser

**Files:**
- Create: `packages/table-query/src/parse.ts`
- Modify: `packages/table-query/src/index.ts`
- Test: `packages/table-query/src/parse.test.ts`

**Interfaces:**
- Consumes: `TableColumnMap` (Task 2), `FilterRule`, `SortRule` (Task 1).
- Produces:
  - `type ParsedFilter = Omit<FilterRule, "id">`
  - `type ParsedSort = Omit<SortRule, "id">`
  - `interface ParsedTableQuery { filters: ParsedFilter[]; sorts: ParsedSort[] }`
  - `type ParseResult = { ok: true; query: ParsedTableQuery } | { ok: false; error: string }`
  - `parseTableQuery(raw: { filters?: string; sorts?: string }, columns: TableColumnMap): ParseResult`
  - `MAX_QUERY_CHARS = 4096`, `MAX_FILTER_RULES = 25`, `MAX_SORT_RULES = 5`

**Context:** `id` is stripped — it is a React key and the spec forbids sending it. The parser is the security boundary: nothing reaches SQL unless it is in the column map.

- [ ] **Step 1: Write the failing test**

`packages/table-query/src/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTableQuery, MAX_QUERY_CHARS } from "./parse";
import { AUDIT_COLUMNS } from "./columns";

const ok = (r: ReturnType<typeof parseTableQuery>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.query;
};

describe("parseTableQuery", () => {
  it("returns an empty query when nothing is supplied", () => {
    expect(ok(parseTableQuery({}, AUDIT_COLUMNS))).toEqual({ filters: [], sorts: [] });
  });

  it("parses a valid filter and strips the client-only id", () => {
    const raw = { filters: JSON.stringify([{ id: "f1", column: "action", operator: "eq", value: "login", combine: "and" }]) };
    expect(ok(parseTableQuery(raw, AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "eq", value: "login", combine: "and" },
    ]);
  });

  it("rejects a column that is not in the map, naming it", () => {
    const raw = { filters: JSON.stringify([{ column: "password", operator: "eq", value: "x", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("password");
  });

  it("rejects an operator the column does not allow, naming it", () => {
    // occurredAt is a date column: `like` is not in DATE_OPS
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "like", value: "x", combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("like");
  });

  it("rejects sorting an unsortable column", () => {
    const columns = { ...AUDIT_COLUMNS, action: { ...AUDIT_COLUMNS.action!, sortable: false } };
    const raw = { sorts: JSON.stringify([{ column: "action", ascending: true }]) };
    expect(parseTableQuery(raw, columns).ok).toBe(false);
  });

  it("rejects malformed JSON rather than treating it as empty", () => {
    const r = parseTableQuery({ filters: "{not json" }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
  });

  it("rejects an oversized payload", () => {
    const r = parseTableQuery({ filters: "x".repeat(MAX_QUERY_CHARS + 1) }, AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too (large|long)/i);
  });

  it("rejects too many rules", () => {
    const many = Array.from({ length: 26 }, () => ({ column: "action", operator: "eq", value: "a", combine: "and" }));
    expect(parseTableQuery({ filters: JSON.stringify(many) }, AUDIT_COLUMNS).ok).toBe(false);
  });

  it("rejects a between rule whose value is not a 2-element array", () => {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "between", value: "2026-01-01", combine: "and" }]) };
    expect(parseTableQuery(raw, AUDIT_COLUMNS).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/table-query exec vitest run src/parse.test.ts`
Expected: FAIL — `Failed to resolve import "./parse"`.

- [ ] **Step 3: Write the implementation**

`packages/table-query/src/parse.ts`:

```ts
import type { FilterCombine, FilterOperator, FilterRule, SortRule } from "./types";
import type { TableColumnMap } from "./columns";

export type ParsedFilter = Omit<FilterRule, "id">;
export type ParsedSort = Omit<SortRule, "id">;
export interface ParsedTableQuery { filters: ParsedFilter[]; sorts: ParsedSort[] }
export type ParseResult =
  | { ok: true; query: ParsedTableQuery }
  | { ok: false; error: string };

export const MAX_QUERY_CHARS = 4096;
export const MAX_FILTER_RULES = 25;
export const MAX_SORT_RULES = 5;

const NO_VALUE: FilterOperator[] = ["is_null", "is_not_null"];

function fail(error: string): ParseResult { return { ok: false, error }; }

function decode(raw: string | undefined, what: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, value: [] };
  if (raw.length > MAX_QUERY_CHARS) {
    return { ok: false, error: `${what} is too large (${raw.length} chars, max ${MAX_QUERY_CHARS})` };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: `${what} is not valid JSON` }; }
  if (!Array.isArray(parsed)) return { ok: false, error: `${what} must be a JSON array` };
  return { ok: true, value: parsed };
}

export function parseTableQuery(
  raw: { filters?: string; sorts?: string },
  columns: TableColumnMap,
): ParseResult {
  const f = decode(raw.filters, "filters");
  if (!f.ok) return fail(f.error);
  const s = decode(raw.sorts, "sorts");
  if (!s.ok) return fail(s.error);

  if (f.value.length > MAX_FILTER_RULES) {
    return fail(`too many filter rules (${f.value.length}, max ${MAX_FILTER_RULES})`);
  }
  if (s.value.length > MAX_SORT_RULES) {
    return fail(`too many sort rules (${s.value.length}, max ${MAX_SORT_RULES})`);
  }

  const filters: ParsedFilter[] = [];
  for (const entry of f.value) {
    const r = entry as Partial<FilterRule>;
    if (typeof r.column !== "string") return fail("a filter rule is missing its column");
    const spec = columns[r.column];
    if (!spec) return fail(`unknown filter column "${r.column}"`);
    if (typeof r.operator !== "string" || !spec.operators.includes(r.operator as FilterOperator)) {
      return fail(`operator "${String(r.operator)}" is not allowed on column "${r.column}"`);
    }
    const operator = r.operator as FilterOperator;
    const combine: FilterCombine = r.combine === "or" ? "or" : "and";

    if (NO_VALUE.includes(operator)) {
      filters.push({ column: r.column, operator, value: "", combine });
      continue;
    }
    if (operator === "between") {
      if (!Array.isArray(r.value) || r.value.length !== 2) {
        return fail(`operator "between" on column "${r.column}" needs exactly two values`);
      }
      filters.push({ column: r.column, operator, value: [String(r.value[0]), String(r.value[1])], combine });
      continue;
    }
    if (operator === "in") {
      const list = Array.isArray(r.value) ? r.value.map(String) : String(r.value ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      filters.push({ column: r.column, operator, value: list, combine });
      continue;
    }
    if (Array.isArray(r.value)) return fail(`operator "${operator}" on column "${r.column}" takes a single value`);
    filters.push({ column: r.column, operator, value: String(r.value ?? ""), combine });
  }

  const sorts: ParsedSort[] = [];
  for (const entry of s.value) {
    const r = entry as Partial<SortRule>;
    if (typeof r.column !== "string") return fail("a sort rule is missing its column");
    const spec = columns[r.column];
    if (!spec) return fail(`unknown sort column "${r.column}"`);
    if (!spec.sortable) return fail(`column "${r.column}" is not sortable`);
    sorts.push({ column: r.column, ascending: r.ascending !== false });
  }

  return { ok: true, query: { filters, sorts } };
}
```

Add `export * from "./parse";` to `packages/table-query/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/table-query exec vitest run src/parse.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/table-query/src/parse.ts packages/table-query/src/parse.test.ts packages/table-query/src/index.ts
git commit -m "feat(table-query): validating parser for wire filters and sorts"
```

---

## Task 4: The Kysely translator

**Files:**
- Create: `packages/db/src/table-query-sql.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json`
- Test: `packages/db/src/table-query-sql.test.ts`

**Interfaces:**
- Consumes: `ParsedTableQuery`, `ParsedFilter`, `ParsedSort`, `TableColumnMap` (Tasks 2-3).
- Produces:
  - `buildFilterExpression(eb, filters: ParsedFilter[], columns: TableColumnMap): Expression<SqlBool> | undefined`
  - `applySorts<QB>(qb: QB, sorts: ParsedSort[], columns: TableColumnMap, tiebreaker: string): QB`

**Read the operator semantics table at the top of this plan before writing any SQL.** Several operators do not translate to the obvious expression.

- [ ] **Step 1: Write the failing test**

`packages/db/src/table-query-sql.test.ts`. Use pg-mem, as the other db tests in this package do — copy the harness from whichever existing `packages/db/src/*.test.ts` sets one up.

```ts
import { describe, it, expect } from "vitest";
import { buildFilterExpression } from "./table-query-sql";
import type { TableColumnMap } from "@openldr/table-query";

const COLUMNS: TableColumnMap = {
  name:   { sql: "name",   type: "text", operators: ["eq", "ne", "like", "in", "is_null", "is_not_null"], sortable: true },
  weight: { sql: "weight", type: "number", operators: ["gt", "gte", "lt", "lte", "between"], sortable: true },
};

// Rows: one with a NULL name, to pin the coalesce behaviour the client requires.
async function seed(db: any) {
  await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
  await db.insertInto("t").values([
    { id: "1", name: "alpha",  weight: 10 },
    { id: "2", name: "BETA",   weight: 5 },
    { id: "3", name: null,     weight: 1 },
  ]).execute();
}

async function idsMatching(db: any, filters: any[]): Promise<string[]> {
  const rows = await db.selectFrom("t").select("id")
    .where((eb: any) => buildFilterExpression(eb, filters, COLUMNS) ?? eb.val(true))
    .orderBy("id").execute();
  return rows.map((r: any) => r.id);
}

describe("buildFilterExpression", () => {
  it("ne includes a NULL row, matching the client", async () => {
    // client: String(null ?? "") !== "alpha" -> true. Plain SQL `name <> 'alpha'` would drop row 3.
    const db = await makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "ne", value: "alpha", combine: "and" }])).toEqual(["2", "3"]);
  });

  it("like is case-insensitive substring", async () => {
    const db = await makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "like", value: "bet", combine: "and" }])).toEqual(["2"]);
  });

  it("like with an empty needle matches everything", async () => {
    const db = await makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "like", value: "", combine: "and" }])).toEqual(["1", "2", "3"]);
  });

  it("in with an empty set matches nothing", async () => {
    const db = await makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "in", value: [], combine: "and" }])).toEqual([]);
  });

  it("is_null treats an empty string as null", async () => {
    const db = await makeDb(); await seed(db);
    expect(await idsMatching(db, [{ column: "name", operator: "is_null", value: "", combine: "and" }])).toEqual(["3"]);
  });

  it("folds left to right: A AND B OR C", async () => {
    const db = await makeDb(); await seed(db);
    const ids = await idsMatching(db, [
      { column: "name",   operator: "eq", value: "alpha", combine: "and" },
      { column: "weight", operator: "gt", value: "100",   combine: "and" },
      { column: "name",   operator: "eq", value: "BETA",  combine: "or"  },
    ]);
    // (alpha AND weight>100) OR BETA  ->  just row 2
    expect(ids).toEqual(["2"]);
  });

  it("escapes LIKE wildcards so they match literally", async () => {
    const db = await makeDb();
    await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
    await db.insertInto("t").values([{ id: "1", name: "50%", weight: 1 }, { id: "2", name: "5000", weight: 1 }]).execute();
    expect(await idsMatching(db, [{ column: "name", operator: "like", value: "50%", combine: "and" }])).toEqual(["1"]);
  });
});
```

Replace `makeDb()` with this package's existing pg-mem helper — find it with:

```bash
grep -rln "pg-mem" packages/db/src/*.test.ts | head -3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openldr/db exec vitest run src/table-query-sql.test.ts`
Expected: FAIL — `Failed to resolve import "./table-query-sql"`.

- [ ] **Step 3: Write the implementation**

`packages/db/src/table-query-sql.ts`:

```ts
import { sql, type ExpressionBuilder, type Expression, type SqlBool } from "kysely";
import type { ParsedFilter, ParsedSort, TableColumnMap } from "@openldr/table-query";

/** Escape the LIKE metacharacters so a user's `%` matches a literal percent sign. */
function escapeLike(input: string): string {
  return input.replace(/([\\%_])/g, "\\$1");
}

function ruleExpression(
  eb: ExpressionBuilder<any, any>,
  rule: ParsedFilter,
  columns: TableColumnMap,
): Expression<SqlBool> {
  const spec = columns[rule.column];
  // Unreachable via parseTableQuery, which rejects unknown columns first.
  if (!spec) throw new Error(`unknown column "${rule.column}"`);
  const col = sql.ref(spec.sql);
  const asText = sql<string>`coalesce(${col}::text, '')`;

  switch (rule.operator) {
    case "eq":  return sql<SqlBool>`${asText} = ${String(rule.value)}`;
    case "ne":  return sql<SqlBool>`${asText} <> ${String(rule.value)}`;
    case "like": {
      const needle = Array.isArray(rule.value) ? rule.value.join(",") : String(rule.value ?? "");
      if (needle === "") return sql<SqlBool>`true`;
      return sql<SqlBool>`${col}::text ilike ${"%" + escapeLike(needle) + "%"} escape '\\'`;
    }
    case "gt":  return sql<SqlBool>`${col} > ${rule.value}`;
    case "gte": return sql<SqlBool>`${col} >= ${rule.value}`;
    case "lt":  return sql<SqlBool>`${col} < ${rule.value}`;
    case "lte": return sql<SqlBool>`${col} <= ${rule.value}`;
    case "between": {
      const [lo, hi] = rule.value as [string, string];
      return sql<SqlBool>`${col} >= ${lo} and ${col} <= ${hi}`;
    }
    case "in": {
      const list = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value)];
      if (list.length === 0) return sql<SqlBool>`false`;
      return sql<SqlBool>`${asText} = any(${list})`;
    }
    case "is_null":     return sql<SqlBool>`${col} is null or ${col}::text = ''`;
    case "is_not_null": return sql<SqlBool>`${col} is not null and ${col}::text <> ''`;
  }
}

/**
 * Fold the rules exactly as the client does — flat, left to right, so
 * `A AND B OR C` is `(A AND B) OR C`. See applyTableState.ts:80-92. A different
 * association here makes the same filter set select different rows on a
 * server-paginated page than on a client-side one.
 */
export function buildFilterExpression(
  eb: ExpressionBuilder<any, any>,
  filters: ParsedFilter[],
  columns: TableColumnMap,
): Expression<SqlBool> | undefined {
  if (filters.length === 0) return undefined;
  let acc = ruleExpression(eb, filters[0]!, columns);
  for (let i = 1; i < filters.length; i++) {
    const next = ruleExpression(eb, filters[i]!, columns);
    acc = filters[i]!.combine === "or" ? eb.or([acc, next]) : eb.and([acc, next]);
  }
  return acc;
}

/**
 * Apply sorts, always appending the resource's unique tiebreaker. Without it,
 * ORDER BY + OFFSET can repeat or skip rows between pages when the sort key
 * has duplicates — and pg-mem's stable scan order can never demonstrate that.
 */
export function applySorts<QB extends { orderBy: (c: any, d: "asc" | "desc") => QB }>(
  qb: QB,
  sorts: ParsedSort[],
  columns: TableColumnMap,
  tiebreaker: string,
): QB {
  let out = qb;
  for (const s of sorts) {
    const spec = columns[s.column];
    if (!spec) continue;
    out = out.orderBy(sql.ref(spec.sql), s.ascending ? "asc" : "desc");
  }
  const tb = columns[tiebreaker];
  if (tb) out = out.orderBy(sql.ref(tb.sql), "asc");
  return out;
}
```

Add `export * from "./table-query-sql";` to `packages/db/src/index.ts`, and `"@openldr/table-query": "workspace:*"` to `packages/db/package.json` dependencies. Run `pnpm install`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openldr/db exec vitest run src/table-query-sql.test.ts`
Expected: PASS, 7 tests.

If pg-mem rejects `escape '\\'` or `= any(...)`, do NOT weaken the SQL to suit pg-mem — it is not Postgres (AGENTS.md §7). Move that specific assertion to the live-Postgres file created in Task 6 and note it in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/table-query-sql.ts packages/db/src/table-query-sql.test.ts packages/db/src/index.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): translate parsed table filters and sorts into Kysely"
```

---

## Task 5: The cross-implementation test

**Files:**
- Test: `packages/db/src/table-query-parity.test.ts`

**Interfaces:**
- Consumes: `buildFilterExpression` (Task 4), `applyTableState` (existing, in the studio).
- Produces: nothing. This is the test that makes Tasks 3 and 4 trustworthy.

**Why this exists:** slice A has no live callers, so nothing else would catch a divergence between the browser filter and the SQL filter. Same rules, same rows, or the grammar is not shared in any meaningful sense.

`applyTableState` lives in `apps/studio`. Importing across an app boundary is not something this repo does, so **copy** the row set and rule lists into the test and assert both sides independently: run the rules through a local re-implementation of the client fold, and through SQL, and compare. If that proves awkward, the honest alternative is to assert SQL results against a hand-written expected set derived from `matchesRule` — and say so in the test's header comment.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildFilterExpression } from "./table-query-sql";
import type { ParsedFilter, TableColumnMap } from "@openldr/table-query";

const COLUMNS: TableColumnMap = {
  name:   { sql: "name",   type: "text",   operators: ["eq", "ne", "like", "in", "is_null", "is_not_null"], sortable: true },
  weight: { sql: "weight", type: "number", operators: ["gt", "gte", "lt", "lte", "between"], sortable: true },
};

const ROWS = [
  { id: "1", name: "alpha", weight: 10 },
  { id: "2", name: "BETA",  weight: 5 },
  { id: "3", name: null,    weight: 1 },
  { id: "4", name: "",      weight: 7 },
];

/** The client's matchesRule + fold, copied from applyTableState.ts:29-92. */
function clientIds(filters: ParsedFilter[]): string[] {
  const match = (v: unknown, op: string, t: unknown): boolean => {
    const S = (x: unknown) => String(x ?? "");
    switch (op) {
      case "eq":  return S(v) === S(t);
      case "ne":  return S(v) !== S(t);
      case "like": {
        const n = (Array.isArray(t) ? t.join(",") : S(t)).toLowerCase();
        return n === "" ? true : S(v).toLowerCase().includes(n);
      }
      case "gt":  return Number(v) >  Number(t);
      case "gte": return Number(v) >= Number(t);
      case "lt":  return Number(v) <  Number(t);
      case "lte": return Number(v) <= Number(t);
      case "in":  return Array.isArray(t) && t.length > 0 && t.map(String).includes(S(v));
      case "is_null":     return v === null || v === undefined || v === "";
      case "is_not_null": return !(v === null || v === undefined || v === "");
      default: throw new Error(`unhandled ${op}`);
    }
  };
  return ROWS.filter((row) => {
    let acc = true;
    filters.forEach((f, i) => {
      const m = match((row as any)[f.column], f.operator, f.value);
      acc = i === 0 ? m : f.combine === "or" ? acc || m : acc && m;
    });
    return filters.length === 0 ? true : acc;
  }).map((r) => r.id);
}

const CASES: { label: string; filters: ParsedFilter[] }[] = [
  { label: "eq",                filters: [{ column: "name", operator: "eq", value: "alpha", combine: "and" }] },
  { label: "ne over a null",    filters: [{ column: "name", operator: "ne", value: "alpha", combine: "and" }] },
  { label: "like mixed case",   filters: [{ column: "name", operator: "like", value: "bet", combine: "and" }] },
  { label: "like empty needle", filters: [{ column: "name", operator: "like", value: "", combine: "and" }] },
  { label: "in empty set",      filters: [{ column: "name", operator: "in", value: [], combine: "and" }] },
  { label: "is_null",           filters: [{ column: "name", operator: "is_null", value: "", combine: "and" }] },
  { label: "is_not_null",       filters: [{ column: "name", operator: "is_not_null", value: "", combine: "and" }] },
  { label: "A and B or C",      filters: [
    { column: "name",   operator: "eq", value: "alpha", combine: "and" },
    { column: "weight", operator: "gt", value: "100",   combine: "and" },
    { column: "name",   operator: "eq", value: "BETA",  combine: "or"  },
  ] },
];

describe("client and SQL filters select the same rows", () => {
  for (const c of CASES) {
    it(c.label, async () => {
      const db = await makeDb();
      await db.schema.createTable("t").addColumn("id", "text").addColumn("name", "text").addColumn("weight", "integer").execute();
      await db.insertInto("t").values(ROWS).execute();
      const rows = await db.selectFrom("t").select("id")
        .where((eb: any) => buildFilterExpression(eb, c.filters, COLUMNS) ?? eb.val(true))
        .orderBy("id").execute();
      expect(rows.map((r: any) => r.id)).toEqual(clientIds(c.filters));
    });
  }
});
```

Use the same pg-mem helper as Task 4 for `makeDb()`.

- [ ] **Step 2: Run test to verify it fails or reveals a divergence**

Run: `pnpm --filter @openldr/db exec vitest run src/table-query-parity.test.ts`
Expected: any case that fails is a real divergence between the two implementations. Fix `table-query-sql.ts` to match the client — the client is the reference, because nine pages already behave that way.

- [ ] **Step 3: Reconcile until all cases pass**

Run the same command until green. Do not change `clientIds` to match the SQL; that inverts the contract.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/table-query-parity.test.ts
git commit -m "test(db): client and SQL filters select the same rows"
```

---

## Task 6: The live-Postgres pagination test

**Files:**
- Test: `packages/db/src/table-query-pagination.live.test.ts`

**Interfaces:**
- Consumes: `applySorts` (Task 4).
- Produces: nothing.

**Why a live test:** pg-mem has a stable scan order and cannot demonstrate `ORDER BY` tie non-determinism, so a pg-mem test passes whether or not the tiebreaker is present. It would be a test that cannot fail. This is the AGENTS.md §7 case, stated explicitly.

- [ ] **Step 1: Find how other live tests gate on a database**

```bash
grep -rln "live" packages/*/src/*.test.ts | head -5
grep -rn "INTERNAL_DATABASE_URL\|describe.skipIf\|it.skipIf" packages/reporting/src/**/*.test.ts | head -5
```

Follow whatever gating those use. A live test must skip cleanly when no database is configured, never fail.

- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applySorts } from "./table-query-sql";
import type { TableColumnMap } from "@openldr/table-query";

const URL = process.env.INTERNAL_DATABASE_URL;
const COLUMNS: TableColumnMap = {
  id:         { sql: "id",          type: "text", operators: ["eq"], sortable: true },
  occurredAt: { sql: "occurred_at", type: "date", operators: ["eq"], sortable: true },
};

describe.skipIf(!URL)("pagination is stable when the sort key ties", () => {
  // 40 rows, ALL sharing one occurred_at. Without a tiebreaker, Postgres may
  // return them in any order per query, so paging can repeat or skip rows.
  it("walks every row exactly once across pages", async () => {
    const db = await makeLiveDb(URL!);
    await db.schema.createTable("tq_tie").addColumn("id", "text").addColumn("occurred_at", "timestamptz").execute();
    const stamp = new Date("2026-08-18T12:00:00Z");
    await db.insertInto("tq_tie")
      .values(Array.from({ length: 40 }, (_, i) => ({ id: `id-${String(i).padStart(3, "0")}`, occurred_at: stamp })))
      .execute();

    const seen: string[] = [];
    for (let offset = 0; offset < 40; offset += 10) {
      const q = applySorts(
        db.selectFrom("tq_tie").select("id"),
        [{ column: "occurredAt", ascending: false }],
        COLUMNS,
        "id",
      ).limit(10).offset(offset);
      seen.push(...(await q.execute()).map((r: any) => r.id));
    }

    expect(seen.length).toBe(40);
    expect(new Set(seen).size).toBe(40); // no repeats, nothing skipped
    await db.schema.dropTable("tq_tie").execute();
  });
});
```

Replace `makeLiveDb` with whatever the repo's live tests already use to open a real connection.

- [ ] **Step 3: Run it against the live database**

The dev Postgres is on port 5433 (`docker ps` shows `openldr_ce-postgres-1`).

Run: `pnpm --filter @openldr/db exec vitest run src/table-query-pagination.live.test.ts`
Expected: PASS with the database up.

- [ ] **Step 4: Prove the test can fail**

Temporarily delete the tiebreaker lines at the end of `applySorts` and re-run. Expected: FAIL, with fewer than 40 distinct ids. Restore the code and re-run to green.

A test that passes both with and without the fix proves nothing — this step is what makes it real. Record both outputs in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/table-query-pagination.live.test.ts
git commit -m "test(db): live-Postgres proof that sorting appends a unique tiebreaker"
```

---

## Self-review notes

**Spec coverage.** Package with zero deps → Task 1. Column maps → Task 2. Parser with size caps and typed rejection → Task 3. Kysely translation, fold, tiebreaker → Task 4. Cross-implementation test → Task 5. HONEST NON-PROOF resolved with a live test → Task 6. Backward compatibility needs no task: the named params are untouched because no route changes in this slice.

**Three places the plan says "verify first."** Task 2's `sql` values are written from the schema as understood at planning time and carry a `grep` to confirm each against `packages/db/src/schema/internal.ts` — a wrong column name is a runtime SQL error, not a type error. Tasks 4-6 need this package's existing pg-mem and live-DB helpers, which were not read at planning time; each carries the command to find them. Naming a check is better than inventing a helper that does not exist.

**`ColumnDef` deliberately stays in the studio.** It holds `accessor: (row: T) => ReactNode`. Moving it would put React in a package the server imports.
