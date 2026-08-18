# Audit adopts the table query grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the audit log the grammar's first real consumer — store, route, CLI and page — and close the two Importants slice A left open.

**Architecture:** The audit store gains optional `filters`/`sorts` and routes its ordering through `applySorts`. The HTTP route parses the wire format; the CLI parses flags; both produce the same validated rules and call the same store. The studio page builds its columns from `AUDIT_COLUMNS` so the popover can only offer what the server accepts.

**Tech Stack:** TypeScript, Kysely 0.28, Postgres 16 (internal store, ICU available), Fastify, commander (CLI), React 18, vitest 2.1.8, pg-mem for unit tests, live Postgres for collation and pagination.

**Spec:** `docs/superpowers/specs/2026-08-18-audit-adopts-table-query-design.md`

## Global Constraints

- **`@openldr/table-query` keeps ZERO runtime dependencies.** The browser imports it.
- **The SQL translator stays server-only.** Studio must never value-import `packages/db/src/table-query-sql.ts`.
- **Rejection is a typed 400 naming what failed.** A filter is never silently dropped.
- **Existing named params keep working** (`?action=`, `?from=`, `--actor`, `--action`) and are ANDed with the grammar. This is not a migration.
- **The route and the CLI call identical shared code** (AGENTS.md §6) — the CLI calls `ctx.audit.list()` directly, so shared logic lives in the store, not the route.
- **i18n is en + fr + pt, always all three.** `apps/studio/src/i18n/parity.test.ts` fails on any mismatch.
- **Actions live in a `⋯` dropdown; every table keeps `TablePagination`** (AGENTS.md §5).
- **pg-mem is not Postgres.** It has no ICU and a stable scan order. Collation and tiebreaker proofs must run live or they prove nothing (AGENTS.md §7).
- **No `Co-Authored-By` trailers** in commits (AGENTS.md §9).
- **Never claim done without the command and its output** (AGENTS.md §1).

---

## File Structure

**Modified — grammar (shared, also serves slice C):**
- `packages/db/src/table-query-sql.ts` — ICU collation on text sorts
- `packages/table-query/src/parse.ts` — tighter date validation
- `apps/studio/src/components/data-table/types.ts` — `ColumnDef.operators?`
- `apps/studio/src/components/data-table/FilterPopover.tsx` — honour it at three call sites

**Modified — audit:**
- `packages/audit/src/store.ts` — `AuditFilter.filters`/`.sorts`, ordering via `applySorts`
- `packages/audit/package.json` — depend on `@openldr/db` and `@openldr/table-query`
- `apps/server/src/audit-routes.ts` — parse the wire format, 400 on rejection
- `packages/cli/src/audit.ts` + `packages/cli/src/program.ts` — `--where`, `--sort`
- `apps/studio/src/pages/Audit.tsx` — toolbar, chips, pagination, columns from the map
- `apps/studio/src/i18n/{en,fr,pt}.ts` — audit column and filter labels
- `apps/studio/src/components/data-table/applyTableState.ts` — client tiebreaker
- `apps/studio/src/docs/0.1.0/{en,fr,pt}/audit.md` — the new filtering and CLI flags

**Task order:** Tasks 1-3 are grammar fixes with no audit knowledge — they must land first because everything downstream depends on the operator list and date rules being right. Task 4 is the store, which both Task 5 (route) and Task 6 (CLI) consume. Task 7 is the page. Tasks 8-9 are cleanup and the gate.

---

## Task 1: Text sorts stop depending on the base image

**Files:**
- Modify: `packages/db/src/table-query-sql.ts` (the `applySorts` loop)
- Test: `packages/db/src/table-query-collation.live.test.ts`

**Interfaces:**
- Consumes: `applySorts(qb, sorts, columns, tiebreaker, defaultSorts?)` as it exists today.
- Produces: no signature change. Behaviour change only.

**Context, all measured against the live dev database (port 5433):**

| ordering of `''`, `BETA`, `alpha`, `epsilon` | result |
|---|---|
| bare `ORDER BY x` | `''`, `BETA`, `alpha`, `epsilon` |
| `ORDER BY x COLLATE "en-US-x-icu"` | `''`, `alpha`, `BETA`, `epsilon` |
| client `localeCompare` | `''`, `alpha`, `BETA`, `epsilon` |

The database reports `datcollate = en_US.utf8`, but `postgres:16-alpine` is musl-based so locales fall back to byte order. Today's sort order is a property of the container image.

⛔ **Collate ONLY text and enum columns.** `COLLATE` on an integer or timestamp column is a Postgres error ("collations are not supported by type"). Gate on `spec.type`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/table-query-collation.live.test.ts`. Gate it exactly the way the existing `packages/db/src/table-query-pagination.live.test.ts` does — copy its skip guard and its connection helper verbatim, so it skips cleanly with no database.

```ts
import { describe, it, expect } from "vitest";
import { applySorts } from "./table-query-sql";
import type { TableColumnMap } from "@openldr/table-query";

const COLUMNS: TableColumnMap = {
  id:   { sql: "id",   type: "text", operators: ["eq"], sortable: true },
  name: { sql: "name", type: "text", operators: ["eq"], sortable: true },
};

// MIXED CASE IS THE POINT. The existing sort fixture in table-query-sql.test.ts is
// all-lowercase ("a","m","z"), so it passes with or without the collation.
const NAMES = ["", "BETA", "alpha", "epsilon"];

describe("text sorts use an explicit ICU collation", () => {
  it("orders mixed case the way the client's localeCompare does", async () => {
    const db = await makeLiveDb();
    await db.schema.createTable("tq_coll").addColumn("id", "text").addColumn("name", "text").execute();
    await db.insertInto("tq_coll")
      .values(NAMES.map((n, i) => ({ id: `id-${i}`, name: n })))
      .execute();

    const rows = await applySorts(
      db.selectFrom("tq_coll").select("name"),
      [{ column: "name", ascending: true }],
      COLUMNS,
      "id",
    ).execute();

    // What String.localeCompare produces, and what COLLATE "en-US-x-icu" produces.
    expect(rows.map((r: any) => r.name)).toEqual(["", "alpha", "BETA", "epsilon"]);
    await db.schema.dropTable("tq_coll").execute();
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

```bash
pnpm --filter @openldr/db exec vitest run src/table-query-collation.live.test.ts
```

Expected: FAIL, actual order `["", "BETA", "alpha", "epsilon"]`. If it SKIPS, the database gate is not satisfied — set `INTERNAL_DATABASE_URL` from `.env` and re-run. A skipped test proves nothing here.

- [ ] **Step 3: Add the collation**

In `applySorts`, inside the `for (const s of effective)` loop, replace the bare `sql.ref(spec.sql)` order-by expression with a collated one for collatable types only:

```ts
    // Text ordering must not depend on the database's default collation. postgres:16-alpine is
    // musl-based, so `en_US.utf8` silently falls back to byte order and 'BETA' sorts before
    // 'alpha'; a glibc or managed-cloud Postgres would order it differently again. An explicit
    // ICU collation makes the order a property of the query, and matches applyTableState's
    // String.localeCompare. Only text-ish columns are collatable — COLLATE on an integer or
    // timestamp is a Postgres error.
    const collatable = spec.type === "text" || spec.type === "enum";
    const target = collatable
      ? sql`${sql.ref(spec.sql)} collate "en-US-x-icu"`
      : sql.ref(spec.sql);
    out = out.orderBy(target, (ob: OrderByItemBuilder) =>
      s.ascending ? ob.asc().nullsFirst() : ob.desc().nullsLast(),
    );
```

Apply the same treatment to the tiebreaker order-by below the loop, using the tiebreaker column's own `spec.type`.

- [ ] **Step 4: Run both the new test and the existing SQL suite**

```bash
pnpm --filter @openldr/db exec vitest run src/table-query-collation.live.test.ts src/table-query-sql.test.ts src/table-query-parity.test.ts
```

Expected: all pass. The pg-mem suites must still pass — if pg-mem rejects the `collate` clause, do NOT weaken the SQL to suit it. pg-mem is not Postgres. Move the affected assertion into the live file and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/table-query-sql.ts packages/db/src/table-query-collation.live.test.ts
git commit -m "fix(db): text sorts use an explicit ICU collation, not the image's libc"
```

---

## Task 2: The popover offers only operators the server accepts

**Files:**
- Modify: `apps/studio/src/components/data-table/types.ts` (`ColumnDef`)
- Modify: `apps/studio/src/components/data-table/FilterPopover.tsx` (three call sites)
- Test: `apps/studio/src/components/data-table/column-map-agreement.test.ts`

**Interfaces:**
- Consumes: `TableColumnMap`, `AUDIT_COLUMNS`, `FACILITY_COLUMNS` from `@openldr/table-query`.
- Produces: `ColumnDef.operators?: FilterOperator[]`. Task 7 sets it from the column map.

**Context:** `AUDIT_COLUMNS.id` is `type: "text"` with `operators: ["eq","in"]` (`packages/table-query/src/columns.ts:22`), but the popover derives its list from `validOperators(col.type)`, which returns six operators for text. Picking `like` on an id column produces a 400 the user cannot act on.

⛔ **There are THREE call sites, not one.** `FilterPopover.tsx:144` seeds a new rule, `:194` renders the operator list for an existing rule, `:226` re-picks an operator when the column changes. Patching one leaves the defect alive on the other paths.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/components/data-table/column-map-agreement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AUDIT_COLUMNS, FACILITY_COLUMNS, type TableColumnMap } from "@openldr/table-query";
import { validOperators } from "./types";

// The server's column map is the authority. The UI may offer FEWER operators than the type
// allows, never more — offering more produces a 400 the user cannot act on. Nothing enforced
// this agreement before, which is how AUDIT_COLUMNS.id drifted.
const MAPS: [string, TableColumnMap][] = [["AUDIT_COLUMNS", AUDIT_COLUMNS], ["FACILITY_COLUMNS", FACILITY_COLUMNS]];

describe("column maps agree with what the UI can offer", () => {
  for (const [label, map] of MAPS) {
    it(`${label}: every allowed operator is valid for the column's type`, () => {
      for (const [id, spec] of Object.entries(map)) {
        const allowedByType = validOperators(spec.type);
        for (const op of spec.operators) {
          expect(allowedByType, `${label}.${id} allows "${op}" but type "${spec.type}" does not`).toContain(op);
        }
      }
    });

    it(`${label}: a column narrower than its type is expressible as ColumnDef.operators`, () => {
      for (const [id, spec] of Object.entries(map)) {
        const narrower = spec.operators.length < validOperators(spec.type).length;
        if (narrower) {
          // This is the case the popover used to get wrong. The ColumnDef the page builds must
          // carry the narrowed list, or the popover falls back to the type's full six.
          expect(spec.operators.length, `${label}.${id}`).toBeGreaterThan(0);
        }
      }
    });
  }
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/studio exec vitest run src/components/data-table/column-map-agreement.test.ts
```

Expected: PASS if the maps are already consistent, FAIL naming the offending column if not. Either outcome is information — if it passes immediately, the maps were fine and the defect is purely in the popover, which Step 4 covers.

- [ ] **Step 3: Add the field and honour it**

In `apps/studio/src/components/data-table/types.ts`, add to `ColumnDef`:

```ts
  /**
   * Operators this column actually accepts, overriding the type's default list. Server-backed
   * pages set this from their column map so the popover cannot offer something the endpoint
   * rejects with a 400. Omit it and the column falls back to validOperators(type).
   */
  operators?: FilterOperator[];
```

In `FilterPopover.tsx`, replace all three derivations:

```ts
// line ~144, in addFilter
const ops = col.operators ?? validOperators(col.type);
// line ~194, rendering an existing rule
const ops = col.operators ?? validOperators(col.type);
// line ~226, when the column changes
const nextOps = next.operators ?? validOperators(next.type);
```

- [ ] **Step 4: Write a popover test that proves the narrowing**

Add to `apps/studio/src/components/data-table/FilterPopover.test.tsx` (create it if absent, modelling the render harness on `DataTableToolbar.test.tsx`):

```tsx
it("offers only the operators a column declares, not its type's full list", async () => {
  const columns: ColumnDef<{ id: string }>[] = [
    { id: "id", labelKey: "users.username", accessor: (r) => r.id, type: "text",
      operators: ["eq", "in"], defaultVisible: true },
  ];
  render(<FilterPopover columns={columns} filters={[]} onApply={vi.fn()} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: /^filter$/i }), { button: 0, pointerType: "mouse" });
  fireEvent.click(await screen.findByRole("button", { name: /add filter/i }));

  fireEvent.pointerDown(screen.getByRole("combobox", { name: /operator/i }), { button: 0, pointerType: "mouse" });
  // "Contains" is validOperators("text") but NOT in this column's list.
  expect(screen.queryByRole("option", { name: "Contains" })).toBeNull();
  expect(screen.getByRole("option", { name: "Equals" })).toBeInTheDocument();
});
```

Radix opens on `pointerdown`, not `click` — copy the `openDropdown` helper from `apps/studio/src/pages/Users.test.tsx` if the raw events prove flaky.

- [ ] **Step 5: Run both, then commit**

```bash
pnpm --filter @openldr/studio exec vitest run src/components/data-table/
```
Expected: PASS.

```bash
git add apps/studio/src/components/data-table/
git commit -m "fix(studio): the filter popover offers only operators a column declares"
```

---

## Task 3: Date filters reject what Postgres will reject

**Files:**
- Modify: `packages/table-query/src/parse.ts` (`typedValueError`, the `date` branch at ~line 34)
- Test: `packages/table-query/src/parse.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. Stricter validation only.

**Context, measured against the live database:**

| value | `Date.parse` | `::timestamptz` |
|---|---|---|
| `2026` | valid | **ERROR: invalid input syntax** |
| `2026-08` | valid | **ERROR: invalid input syntax** |
| `2026-08-18` | valid | ok |
| `2026-08-18T12:00:00Z` | valid | ok |
| `2026-08-18 12:00:00+03` | valid | ok |

`parse.ts:35` validates with `Date.parse`, so `"2026"` passes the parser and then 500s in Postgres. The honest answer is a 400. **Postgres requires at least `YYYY-MM-DD`.**

- [ ] **Step 1: Write the failing test**

Add to `packages/table-query/src/parse.test.ts`:

```ts
it("rejects a date Postgres cannot parse, even though Date.parse accepts it", () => {
  // Date.parse("2026") is valid; `select '2026'::timestamptz` is an error. Accepting it here
  // turns a user's bad input into a 500 instead of a 400.
  for (const bad of ["2026", "2026-08"]) {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: bad, combine: "and" }]) };
    const r = parseTableQuery(raw, AUDIT_COLUMNS);
    expect(r.ok, `expected "${bad}" to be rejected`).toBe(false);
    if (!r.ok) expect(r.error).toContain(bad);
  }
});

it("accepts the date forms Postgres does parse", () => {
  for (const good of ["2026-08-18", "2026-08-18T12:00:00Z", "2026-08-18 12:00:00+03"]) {
    const raw = { filters: JSON.stringify([{ column: "occurredAt", operator: "gte", value: good, combine: "and" }]) };
    expect(parseTableQuery(raw, AUDIT_COLUMNS).ok, `expected "${good}" to be accepted`).toBe(true);
  }
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/table-query exec vitest run src/parse.test.ts
```
Expected: FAIL — `"2026"` is currently accepted.

- [ ] **Step 3: Tighten the date branch**

In `packages/table-query/src/parse.ts`, replace the `date` branch of `typedValueError`:

```ts
// Postgres needs at least YYYY-MM-DD. Date.parse is far looser — it accepts "2026" and
// "2026-08", which then fail as `invalid input syntax for type timestamp with time zone`
// and surface as a 500. Measured: '2026'::timestamptz and '2026-08'::timestamptz both error;
// '2026-08-18', '2026-08-18T12:00:00Z' and '2026-08-18 12:00:00+03' all parse.
const PG_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

  if (type === "date") {
    if (value.trim() === "" || !PG_DATE.test(value.trim()) || Number.isNaN(Date.parse(value))) {
      return `value "${value}" for column "${column}" is not a valid date`;
    }
  }
```

Keep the `Date.parse` check as well — the regex admits `2026-13-45`, which is shaped right but not a real date.

- [ ] **Step 4: Run it**

```bash
pnpm --filter @openldr/table-query exec vitest run src/parse.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/table-query/src/parse.ts packages/table-query/src/parse.test.ts
git commit -m "fix(table-query): reject dates Postgres cannot parse, as 400 not 500"
```

---

## Task 4: The audit store takes filters and sorts

**Files:**
- Modify: `packages/audit/src/store.ts` (`AuditFilter` at :23, `list` and `count`)
- Modify: `packages/audit/package.json`
- Test: `packages/audit/src/store-table-query.test.ts`, `packages/audit/src/store-pagination.live.test.ts`

**Interfaces:**
- Consumes: `buildFilterExpression(eb, filters, columns)`, `applySorts(qb, sorts, columns, tiebreaker, defaultSorts?)` from `@openldr/db`; `AUDIT_COLUMNS`, `AUDIT_TIEBREAKER`, `ParsedFilter`, `ParsedSort` from `@openldr/table-query`.
- Produces: `AuditFilter.filters?: ParsedFilter[]`, `AuditFilter.sorts?: ParsedSort[]`. Tasks 5 and 6 both populate these.

**Context:** the CLI calls `ctx.audit.list()` directly (`packages/cli/src/audit.ts:18`), so this is the shared point both surfaces reach. `packages/audit/src/store.ts:111` currently orders by `occurred_at desc` with `LIMIT`/`OFFSET` and no unique tiebreaker.

⛔ **`applySorts` already takes a `defaultSorts` parameter** (`table-query-sql.ts:119`). Audit's newest-first default must be passed through it. Reimplementing the default, or omitting it, silently changes the page's load order to UUID order.

- [ ] **Step 1: Write the failing test**

Create `packages/audit/src/store-table-query.test.ts`. Use this package's existing pg-mem harness — find it with `grep -rln "pg-mem" packages/audit/src/*.test.ts`.

```ts
import { describe, it, expect } from "vitest";
import { createAuditStore } from "./store";

async function seed(store: any) {
  await store.record({ actorType: "user", actorId: "u1", actorName: "ann", action: "form.create", entityType: "form", entityId: "f1" });
  await store.record({ actorType: "user", actorId: "u2", actorName: "bob", action: "form.delete", entityType: "form", entityId: "f2" });
  await store.record({ actorType: "cli",  actorId: null, actorName: "cli", action: "user.create", entityType: "user", entityId: "u9" });
}

describe("audit store with grammar filters", () => {
  it("applies a grammar filter", async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({ filters: [{ column: "action", operator: "like", value: "form.", combine: "and" }] });
    expect(rows.map((r: any) => r.entityId).sort()).toEqual(["f1", "f2"]);
  });

  it("ANDs a grammar filter with the existing named params", async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({
      entityType: "form",
      filters: [{ column: "action", operator: "eq", value: "form.delete", combine: "and" }],
    });
    expect(rows.map((r: any) => r.entityId)).toEqual(["f2"]);
  });

  it("counts with the same filters as list", async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const filters = [{ column: "action", operator: "like", value: "form.", combine: "and" as const }];
    expect(await store.count({ filters })).toBe((await store.list({ filters })).length);
  });

  it("keeps newest-first when the caller sends no sort", async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({});
    const times = rows.map((r: any) => r.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("honours an explicit sort instead of the default", async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({ sorts: [{ column: "action", ascending: true }] });
    expect(rows.map((r: any) => r.action)).toEqual(["form.create", "form.delete", "user.create"]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/audit exec vitest run src/store-table-query.test.ts
```
Expected: FAIL — `filters` is not part of `AuditFilter`.

- [ ] **Step 3: Wire the store**

Add to `packages/audit/package.json` dependencies: `"@openldr/db": "workspace:*"` and `"@openldr/table-query": "workspace:*"`, then `pnpm install`.

In `packages/audit/src/store.ts`, extend the interface:

```ts
export interface AuditFilter {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  /** Validated grammar rules from parseTableQuery. ANDed with the named fields above. */
  filters?: ParsedFilter[];
  sorts?: ParsedSort[];
}
```

In `filterExpressions`, append the grammar's expression when present:

```ts
    const grammar = buildFilterExpression(eb, filter.filters ?? [], AUDIT_COLUMNS);
    if (grammar) expressions.push(grammar);
```

Replace `list`'s ordering. The default must go through `applySorts`, not be reimplemented:

```ts
    async list(filter = {}) {
      const base = db
        .selectFrom("audit_events")
        .selectAll()
        .where((eb) => eb.and(filterExpressions(eb, filter)));
      const sorted = applySorts(
        base,
        filter.sorts ?? [],
        AUDIT_COLUMNS,
        AUDIT_TIEBREAKER,
        // Audit's own newest-first order. Passed as the default so an unsorted request keeps
        // today's behaviour instead of falling through to tiebreaker-only (UUID) order.
        [{ column: "occurredAt", ascending: false }],
      );
      const rows = await sorted.limit(filter.limit ?? 100).offset(filter.offset ?? 0).execute();
      return rows.map((r) => toEvent(r as unknown as Row));
    },
```

`count` takes the same `filterExpressions` and needs no ordering change.

- [ ] **Step 4: Run it**

```bash
pnpm --filter @openldr/audit exec vitest run
```
Expected: PASS, including the package's pre-existing audit tests.

- [ ] **Step 5: Add the live pagination proof**

Create `packages/audit/src/store-pagination.live.test.ts`, gated exactly like `packages/db/src/table-query-pagination.live.test.ts`. Insert 40 events sharing one `occurred_at`, page through in tens, and assert 40 distinct ids.

Then temporarily change the `AUDIT_TIEBREAKER` argument in `list` to a different sortable column and re-run: it must FAIL with fewer than 40 distinct ids. Restore, re-run to green, and put both outputs in the commit message. pg-mem's stable scan order means this test passes with or without the fix, so the mutation check is what makes it real.

- [ ] **Step 6: Commit**

```bash
git add packages/audit/ pnpm-lock.yaml
git commit -m "feat(audit): the store takes grammar filters and sorts, with a stable tiebreaker"
```

---

## Task 5: The route parses the wire format

**Files:**
- Modify: `apps/server/src/audit-routes.ts:12-22`
- Test: `apps/server/src/audit-routes.test.ts`

**Interfaces:**
- Consumes: `parseTableQuery(raw, columns)` returning `{ ok: true, query } | { ok: false, error }`; `AUDIT_COLUMNS`; `AuditFilter.filters`/`.sorts` from Task 4.
- Produces: `GET /api/audit?filters=<json>&sorts=<json>`.

**Context:** `typecheck` green does not pin a wire shape. Route tests are the only thing that does.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/audit-routes.test.ts` (model the app harness on whatever the neighbouring route tests in that file already build):

```ts
it("passes parsed filters through to the store", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/audit?filters=${encodeURIComponent(JSON.stringify([{ column: "action", operator: "eq", value: "form.create", combine: "and" }]))}`,
  });
  expect(res.statusCode).toBe(200);
});

it("400s on an unknown filter column, naming it", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/audit?filters=${encodeURIComponent(JSON.stringify([{ column: "password", operator: "eq", value: "x", combine: "and" }]))}`,
  });
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain("password");
});

it("400s on malformed JSON rather than treating it as no filter", async () => {
  const res = await app.inject({ method: "GET", url: "/api/audit?filters=%7Bnot-json" });
  expect(res.statusCode).toBe(400);
});

it("still honours the existing named params", async () => {
  const res = await app.inject({ method: "GET", url: "/api/audit?action=form.create" });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/server exec vitest run src/audit-routes.test.ts
```
Expected: FAIL — the unknown column currently returns 200, because the param is ignored.

- [ ] **Step 3: Parse in the route**

In `apps/server/src/audit-routes.ts`, after reading `q` and before building `filter`:

```ts
      const parsed = parseTableQuery(
        { filters: q.filters, sorts: q.sorts },
        AUDIT_COLUMNS,
      );
      // Never silently drop: a dropped filter gives a table that disagrees with its own chips row.
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
```

then add `filters: parsed.query.filters, sorts: parsed.query.sorts,` to the `filter` object.

⚠ `apps/server` is the only package with real lint, and it enforces the return/await `reply.send` gzip-clobber invariant. Follow the surrounding handlers' style exactly and run the linter.

- [ ] **Step 4: Run tests and lint**

```bash
pnpm --filter @openldr/server exec vitest run src/audit-routes.test.ts
pnpm --filter @openldr/server lint
```
Expected: tests PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/audit-routes.ts apps/server/src/audit-routes.test.ts
git commit -m "feat(server): the audit route accepts grammar filters and sorts"
```

---

## Task 6: The CLI gets --where and --sort

**Files:**
- Create: `packages/cli/src/table-query-flags.ts`
- Modify: `packages/cli/src/audit.ts`, `packages/cli/src/program.ts:725-737`
- Test: `packages/cli/src/table-query-flags.test.ts`

**Interfaces:**
- Consumes: `ParsedFilter`, `ParsedSort`, `TableColumnMap`, `parseTableQuery` from `@openldr/table-query`.
- Produces: `parseWhereFlags(where: string[], sort: string[], columns: TableColumnMap): { ok: true; query: ParsedTableQuery } | { ok: false; error: string }`.

**Context:** a headless lab is the CLI's reason for existing (AGENTS.md §6). Flags must go through the same validator as the route, so an invalid column fails identically on both surfaces.

Flag grammar: `--where column:operator:value` (repeatable), `--sort column` or `--sort -column` for descending (repeatable).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/table-query-flags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseWhereFlags } from "./table-query-flags";
import { AUDIT_COLUMNS } from "@openldr/table-query";

const ok = (r: ReturnType<typeof parseWhereFlags>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.query;
};

describe("parseWhereFlags", () => {
  it("parses a where flag into a rule", () => {
    expect(ok(parseWhereFlags(["action:eq:form.create"], [], AUDIT_COLUMNS)).filters).toEqual([
      { column: "action", operator: "eq", value: "form.create", combine: "and" },
    ]);
  });

  it("keeps colons in the value", () => {
    // entityIds and URLs contain colons; only the first two are delimiters.
    expect(ok(parseWhereFlags(["entityId:eq:urn:tz:hfr"], [], AUDIT_COLUMNS)).filters[0]!.value).toBe("urn:tz:hfr");
  });

  it("reads a leading dash as descending", () => {
    expect(ok(parseWhereFlags([], ["-occurredAt"], AUDIT_COLUMNS)).sorts).toEqual([
      { column: "occurredAt", ascending: false },
    ]);
    expect(ok(parseWhereFlags([], ["action"], AUDIT_COLUMNS)).sorts).toEqual([
      { column: "action", ascending: true },
    ]);
  });

  it("rejects an unknown column the same way the route does", () => {
    const r = parseWhereFlags(["password:eq:x"], [], AUDIT_COLUMNS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("password");
  });

  it("rejects a malformed where flag", () => {
    expect(parseWhereFlags(["justacolumn"], [], AUDIT_COLUMNS).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/cli exec vitest run src/table-query-flags.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the flag parser**

Create `packages/cli/src/table-query-flags.ts`:

```ts
import { parseTableQuery, type ParseResult, type TableColumnMap } from "@openldr/table-query";

/**
 * Turn CLI flags into the same validated rules the HTTP route produces.
 *
 * Both surfaces end at parseTableQuery, so an unknown column or a disallowed operator fails
 * identically whether the operator used the studio or a headless shell (AGENTS.md §6).
 *
 * `--where column:operator:value` — only the FIRST TWO colons are delimiters, so values may
 * contain colons (entityIds and URLs routinely do).
 * `--sort column` / `--sort -column` — a leading dash means descending.
 */
export function parseWhereFlags(
  where: string[],
  sort: string[],
  columns: TableColumnMap,
): ParseResult {
  const filters = [];
  for (const raw of where) {
    const first = raw.indexOf(":");
    const second = raw.indexOf(":", first + 1);
    if (first < 1 || second < 0) {
      return { ok: false, error: `--where "${raw}" must be column:operator:value` };
    }
    filters.push({
      column: raw.slice(0, first),
      operator: raw.slice(first + 1, second),
      value: raw.slice(second + 1),
      combine: "and",
    });
  }
  const sorts = sort.map((s) =>
    s.startsWith("-") ? { column: s.slice(1), ascending: false } : { column: s, ascending: true },
  );
  return parseTableQuery({ filters: JSON.stringify(filters), sorts: JSON.stringify(sorts) }, columns);
}
```

Add `"@openldr/table-query": "workspace:*"` to `packages/cli/package.json` and run `pnpm install`.

- [ ] **Step 4: Wire the command**

In `packages/cli/src/audit.ts`, add `where?: string[]` and `sort?: string[]` to `ListOpts`, call `parseWhereFlags`, and on `!ok` write the error to stderr and return exit code 1. On success pass `filters` and `sorts` into `ctx.audit.list({...})`.

In `packages/cli/src/program.ts`, on the `audit list` command (around :726) add:

```ts
      .option('--where <rule...>', 'filter as column:operator:value (repeatable)')
      .option('--sort <column...>', 'sort by column; prefix with - for descending (repeatable)')
```

- [ ] **Step 5: Run the CLI suite and commit**

```bash
pnpm --filter @openldr/cli exec vitest run
```
Expected: PASS, including the package's existing `read-commands.test.ts`.

```bash
git add packages/cli/ pnpm-lock.yaml
git commit -m "feat(cli): audit list gains --where and --sort, validated like the route"
```

---

## Task 7: The Audit page adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/Audit.tsx`, `apps/studio/src/api.ts` (`AuditQuery`)
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts`
- Test: `apps/studio/src/pages/Audit.test.tsx`

**Interfaces:**
- Consumes: `AUDIT_COLUMNS` from `@openldr/table-query`; `ColumnDef.operators` from Task 2; the route's `filters`/`sorts` params from Task 5.
- Produces: nothing later tasks depend on.

**Context:** the page has a bespoke draft-then-apply form (`AuditFilters` at `Audit.tsx:19`) with four text inputs and a date range. The popover has the same draft-then-apply shape, so no capability is lost. Its labels — `"Action"`, `"Entity type"`, `"Entity ID"`, `"Actor"` at `Audit.tsx:158-161` — are hardcoded English and become i18n keys.

⛔ **This page is server-paginated. Do NOT call `applyTableState`.** Filters and sorts go to the server; the page renders exactly what comes back. `TablePagination` is driven by the response's `total`.

⛔ **Build `ColumnDef.operators` from `AUDIT_COLUMNS`**, or the popover offers six operators on `id` and the server 400s.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/Audit.test.tsx`:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard toolbar and sends filters to the server', async () => {
  render(<MemoryRouter><Audit /></MemoryRouter>);
  await screen.findByRole('table');

  await addFilterViaPopover('form.create');
  expectStandardTableToolbar();

  // Server-paginated: the filter must reach queryAudit, not be applied in the browser.
  await waitFor(() => {
    const last = (api.queryAudit as any).mock.calls.at(-1)[0];
    expect(last.filters).toEqual([
      expect.objectContaining({ column: expect.any(String), operator: expect.any(String) }),
    ]);
  });
});
```

Use the file's existing `vi.mock('@/api', ...)` block and fixtures; add `queryAudit` to it if absent.

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Audit.test.tsx
```
Expected: FAIL — no Filter button.

- [ ] **Step 3: Extend the API client**

In `apps/studio/src/api.ts`, add to `AuditQuery`:

```ts
  filters?: ParsedFilter[];
  sorts?: ParsedSort[];
```

and in `queryAudit`, JSON-encode them rather than letting `String(v)` produce `[object Object]`:

```ts
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    p.set(k, k === 'filters' || k === 'sorts' ? JSON.stringify(v) : String(v));
  }
```

- [ ] **Step 4: Rewrite the page**

Build columns from the map so the popover cannot exceed it:

```tsx
const columns: ColumnDef<AuditEvent>[] = useMemo(() => ([
  { id: 'occurredAt', labelKey: 'audit.colOccurred', accessor: (e) => formatDate(e.occurredAt), type: 'date', defaultVisible: true, operators: AUDIT_COLUMNS.occurredAt!.operators },
  { id: 'actorName',  labelKey: 'audit.colActor',    accessor: (e) => e.actorName,              type: 'text', defaultVisible: true, operators: AUDIT_COLUMNS.actorName!.operators },
  { id: 'action',     labelKey: 'audit.colAction',   accessor: (e) => e.action,                 type: 'text', defaultVisible: true, operators: AUDIT_COLUMNS.action!.operators },
  { id: 'entityType', labelKey: 'audit.colEntityType', accessor: (e) => e.entityType,           type: 'text', defaultVisible: true, operators: AUDIT_COLUMNS.entityType!.operators },
  { id: 'entityId',   labelKey: 'audit.colEntityId', accessor: (e) => e.entityId,               type: 'text', defaultVisible: true, operators: AUDIT_COLUMNS.entityId!.operators },
]), []);
```

Delete `AuditFilters`, `EMPTY_FILTERS`, `AuditFilterField` and the draft form. Drive the fetch from `table.filters`, `table.sorts`, `table.page`, `table.pageSize`, and render the toolbar, chips and `TablePagination` following `apps/studio/src/pages/settings/Sites.tsx`.

Add these i18n keys to en, fr and pt:

```ts
// en
colOccurred: 'When', colActor: 'Actor', colAction: 'Action',
colEntityType: 'Entity type', colEntityId: 'Entity ID',
searchPlaceholder: 'Search audit events', noMatch: 'No audit events match.',
```

```ts
// fr
colOccurred: 'Quand', colActor: 'Acteur', colAction: 'Action',
colEntityType: 'Type d’entité', colEntityId: 'ID d’entité',
searchPlaceholder: 'Rechercher des événements d’audit', noMatch: 'Aucun événement d’audit ne correspond.',
```

```ts
// pt
colOccurred: 'Quando', colActor: 'Ator', colAction: 'Ação',
colEntityType: 'Tipo de entidade', colEntityId: 'ID da entidade',
searchPlaceholder: 'Pesquisar eventos de auditoria', noMatch: 'Nenhum evento de auditoria corresponde.',
```

Reuse any of these that already exist under `audit` rather than duplicating — check first with `grep -n "audit:" -A 30 apps/studio/src/i18n/en.ts`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Audit.test.tsx src/i18n/parity.test.ts
```
Expected: PASS.

```bash
git add apps/studio/src/pages/Audit.tsx apps/studio/src/pages/Audit.test.tsx apps/studio/src/api.ts apps/studio/src/i18n/
git commit -m "feat(studio): the audit page filters and sorts on the server"
```

---

## Task 8: The client sorter gets a tiebreaker

**Files:**
- Modify: `apps/studio/src/components/data-table/applyTableState.ts` (the sort block, ~line 114)
- Test: `apps/studio/src/components/data-table/applyTableState.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change.

**Context:** the client relies on `Array.sort` stability while the server appends `id asc`. Rows with equal sort keys come back in the same set but a different order on the two kinds of page.

- [ ] **Step 1: Write the failing test**

```ts
it("breaks ties by id, matching the server's appended tiebreaker", () => {
  const rows = [
    { id: "c", name: "same" },
    { id: "a", name: "same" },
    { id: "b", name: "same" },
  ];
  const columns: ColumnDef<{ id: string; name: string }>[] = [
    { id: "name", labelKey: "x", accessor: (r) => r.name, type: "text", defaultVisible: true },
  ];
  const out = applyTableState(rows, { filters: [], sorts: [{ id: "s", column: "name", ascending: true }], page: 0, pageSize: 10 }, columns);
  expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/studio exec vitest run src/components/data-table/applyTableState.test.ts
```
Expected: FAIL — input order `c, a, b` is preserved by the stable sort.

- [ ] **Step 3: Append the tiebreaker**

In the comparator, after every sort rule compares equal, fall back to the row's `id`:

```ts
      // The server appends `id asc` to every sort (table-query-sql.ts applySorts). Without the
      // same fallback here, tied keys give the same rows in a different order depending on
      // whether the page is client- or server-paginated.
      const aId = String((a as Record<string, unknown>).id ?? "");
      const bId = String((b as Record<string, unknown>).id ?? "");
      return aId.localeCompare(bId);
```

- [ ] **Step 4: Run the whole data-table suite**

```bash
pnpm --filter @openldr/studio exec vitest run src/components/data-table/
```
Expected: PASS. If an existing test asserted an order that depended on input order, the test was pinning the old behaviour — update it and note that in the commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/components/data-table/
git commit -m "fix(studio): the client sorter breaks ties by id like the server does"
```

---

## Task 9: Docs, and the full gate

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/audit.md`
- Modify: `apps/web/src/docs/0.1.0/audit.md` if the same prose appears there

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence to call slice B done.

- [ ] **Step 1: Update the docs in all three languages**

Describe the toolbar (search, Filter, Sort, Columns, Reset, chips) and the new CLI flags with a worked example:

```bash
openldr audit list --where action:like:form. --sort -occurredAt
```

- [ ] **Step 2: Check no locale was missed**

```bash
for l in en fr pt; do echo "== $l"; grep -c "where" apps/studio/src/docs/0.1.0/$l/audit.md; done
```
Expected: a comparable count in all three. A missing locale ships a visibly broken page.

- [ ] **Step 3: Run every affected package**

```bash
pnpm --filter @openldr/table-query test
pnpm --filter @openldr/db test
pnpm --filter @openldr/audit test
pnpm --filter @openldr/cli test
pnpm --filter @openldr/server test
pnpm --filter @openldr/studio test
```
Expected: all pass. Grep any failure for `Test timed out` and re-run that package alone before blaming a change — a gate failure here is usually a timeout.

- [ ] **Step 4: Run the live tests with a database**

```bash
pnpm --filter @openldr/db exec vitest run src/table-query-collation.live.test.ts
pnpm --filter @openldr/audit exec vitest run src/store-pagination.live.test.ts
```
Expected: PASS, **not skipped**. A skipped live test proves nothing. Set `INTERNAL_DATABASE_URL` from `.env` if they skip.

- [ ] **Step 5: State plainly what was not proven**

`AUTH_DEV_BYPASS=false`, so the studio needs a real Keycloak login and the Audit page will not be seen in a browser. Say so. Layout and mobile at 375px are unverified — the same gap RegistriesTab shipped with. Do not report them as verified.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/docs apps/web/src/docs
git commit -m "docs(audit): filtering, sorting and the new CLI flags in en, fr and pt"
```

---

## Self-review notes

**Spec coverage.** Fix 1 → Task 1. Fix 2 → Task 2. Date validation → Task 3. Store integration and tiebreaker → Task 4. Route → Task 5. CLI → Task 6. Page and i18n → Task 7. Client tiebreaker → Task 8. Docs and gate → Task 9.

**Two mutation checks are deliberate.** Task 4 Step 5 breaks the tiebreaker to prove the live test can fail, and Task 1 Step 2 requires seeing the wrong order before the fix. pg-mem cannot demonstrate either, so a test that was never seen failing is not evidence.

**Places the plan says "find it first" rather than inventing.** The pg-mem harness in `@openldr/audit`, the route-test app harness in `audit-routes.test.ts`, and the existing `audit` i18n keys. Naming the check beats inventing a helper that does not exist — that cost a review round in an earlier slice.

**`ParsedFilter.combine` is typed as `FilterCombine`, not `string`.** Task 6's flag parser builds object literals; if TypeScript widens `combine: "and"` to `string`, add `as const` or an explicit type annotation.
