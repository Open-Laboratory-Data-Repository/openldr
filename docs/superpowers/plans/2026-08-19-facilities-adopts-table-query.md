# Facilities adopts the table query grammar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the facility registry — the largest page in the app and the last table off the shared toolbar — onto the grammar, across store, route, CLI and page.

**Architecture:** The facility store gains optional `filters`/`sorts`, ANDed with its fourteen existing named params and routed through `applySorts`. The route parses the wire format; a new `facilities list` CLI command parses flags; both end at the same validator. The page builds columns from `FACILITY_COLUMNS`, keeps `health` as its own control because the grammar cannot express a join predicate, and keeps its filters in the URL.

**Tech Stack:** TypeScript, Kysely 0.28, Postgres 16 (internal store, ICU available), Fastify, commander, React 18, vitest 2.1.8, pg-mem for unit tests, live Postgres for collation and paging.

**Spec:** `docs/superpowers/specs/2026-08-19-facilities-adopts-table-query-design.md`

## Global Constraints

- **`@openldr/table-query` keeps ZERO runtime dependencies.** The browser imports it.
- **The SQL translator is server-only.** Studio must never value-import `packages/db/src/table-query-sql.ts`.
- **Rejection is a typed 400 naming what failed.** A filter is never silently dropped.
- **All fourteen existing named params keep working** and are ANDed with the grammar. This is not a migration.
- **The route and the CLI call identical shared code** — both terminate at `parseTableQuery`.
- **`health` is NOT a grammar column.** It is computed across two joins and applies three different predicates. It stays a named param with its own UI control.
- **The page is server-paginated — never call `applyTableState` there.**
- **i18n is en + fr + pt, always all three.**
- **Actions live in a `⋯` dropdown; every table keeps `TablePagination`.**
- **pg-mem is not Postgres.** No ICU, no `COLLATE`, stable scan order, and it cannot cast timestamptz to text. Collation and paging proofs run live or they prove nothing.
- **No `Co-Authored-By` trailers** in commits.
- **Never claim done without the command and its output.**

---

## File Structure

**Modified:**
- `packages/table-query/src/columns.ts` — three columns added to `FACILITY_COLUMNS`
- `packages/db/src/facility-registry-store.ts` — `FacilityListOptions.filters`/`.sorts`, ordering via `applySorts`
- `apps/server/src/facilities-routes.ts` — parse the wire format, 400 on rejection
- `packages/cli/src/facilities.ts` + `packages/cli/src/program.ts` — new `facilities list`
- `apps/studio/src/pages/Facilities.tsx` — toolbar, chips, pagination, URL state; `health` retained
- `apps/studio/src/api.ts` — `FacilityListQuery` gains `filters`/`sorts`, JSON-encoded
- `apps/studio/src/i18n/{en,fr,pt}.ts` — any new column labels
- `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`

**Created:**
- `packages/table-query/src/facility-join-safety.test.ts` — the ambiguity guard
- `packages/db/src/facility-registry-live.test.ts` — live collation + paging

**Task order:** Task 1 fixes the map, which everything downstream reads. Task 2 is the store, consumed by both Task 3 (route) and Task 4 (CLI). Task 5 is the page. Task 6 is docs and the gate.

---

## Task 1: The map gains its missing columns, and a guard against join ambiguity

**Files:**
- Modify: `packages/table-query/src/columns.ts` (`FACILITY_COLUMNS`)
- Test: `packages/table-query/src/columns.test.ts`, and new `packages/table-query/src/facility-join-safety.test.ts`

**Interfaces:**
- Consumes: `TableColumnSpec`, `TableColumnMap`, the shared `ENUM_OPS` constant.
- Produces: `FACILITY_COLUMNS` with `source`, `managedOrigin`, `registerState` added. Tasks 2-5 all read it.

**Context.** `FacilityListOptions` (`packages/db/src/facility-registry-store.ts:82-107`) accepts `source`, `managedOrigin` and `registerState`, and the page filters on all three today. `FACILITY_COLUMNS` does not carry them — it was written from the client's query type before anything consumed it.

Verified against the live database: all three are real columns on `facility_registry` (`source`, `managed_origin`, `register_state`), all `text`.

- [ ] **Step 1: Write the failing test**

Add to `packages/table-query/src/columns.test.ts`:

```ts
it("carries every filter the facility list route already accepts", () => {
  // These three are named params on FacilityListOptions and filters on the page today.
  // Omitting them from the map means the toolbar cannot offer what the page already does.
  for (const id of ["source", "managedOrigin", "registerState"]) {
    expect(FACILITY_COLUMNS[id], `FACILITY_COLUMNS is missing "${id}"`).toBeDefined();
  }
  expect(FACILITY_COLUMNS.source!.sql).toBe("source");
  expect(FACILITY_COLUMNS.managedOrigin!.sql).toBe("managed_origin");
  expect(FACILITY_COLUMNS.registerState!.sql).toBe("register_state");
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/table-query exec vitest run src/columns.test.ts
```
Expected: FAIL — `FACILITY_COLUMNS is missing "source"`.

- [ ] **Step 3: Add the three columns**

In `packages/table-query/src/columns.ts`, inside `FACILITY_COLUMNS`:

```ts
  source:        { sql: "source",         type: "enum", operators: ENUM_OPS,     sortable: true },
  managedOrigin: { sql: "managed_origin", type: "enum", operators: ENUM_OPS,     sortable: true },
  registerState: { sql: "register_state", type: "enum", operators: ENUM_OPS,     sortable: true },
```

`enum` rather than `text` because each holds a small closed set the page already renders as a picker, and `ENUM_OPS` excludes `like`, which is meaningless on them.

- [ ] **Step 4: Write the join-ambiguity guard**

Create `packages/table-query/src/facility-join-safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FACILITY_COLUMNS } from "./columns";

// The grammar emits UNQUALIFIED column references (sql.ref("name")). The facility list query
// joins facility_concept_projection and a derived aggregate, so a mapped sql name that also
// exists on a joined table makes every query ambiguous and 500s.
//
// Checked live at design time: facility_concept_projection has exactly registry_id,
// concept_code, updated_at; the derived table exposes to_code and n. `updated_at` is the live
// wire here -- it exists on facility_registry TOO, so mapping it would break everything.
const JOINED_TABLE_COLUMNS = ["registry_id", "concept_code", "updated_at", "to_code", "n"];

describe("FACILITY_COLUMNS is safe against the list query's joins", () => {
  it("maps no column name that a joined table also exposes", () => {
    for (const [id, spec] of Object.entries(FACILITY_COLUMNS)) {
      expect(
        JOINED_TABLE_COLUMNS,
        `FACILITY_COLUMNS.${id} maps "${spec.sql}", which a joined table also exposes — ` +
          `unqualified references would be ambiguous`,
      ).not.toContain(spec.sql);
    }
  });
});
```

- [ ] **Step 5: Run both, then commit**

```bash
pnpm --filter @openldr/table-query exec vitest run
```
Expected: PASS.

```bash
git add packages/table-query/src/columns.ts packages/table-query/src/columns.test.ts packages/table-query/src/facility-join-safety.test.ts
git commit -m "feat(table-query): facility map carries source, managedOrigin and registerState"
```

---

## Task 2: The facility store takes filters and sorts

**Files:**
- Modify: `packages/db/src/facility-registry-store.ts` (`FacilityListOptions` at `:82`, `applyFilters` at `:345`, ordering at `:435-441`)
- Test: `packages/db/src/facility-registry-store.test.ts`, new `packages/db/src/facility-registry-live.test.ts`

**Interfaces:**
- Consumes: `buildFilterExpression`, `applySorts` from `./table-query-sql`; `FACILITY_COLUMNS`, `FACILITY_TIEBREAKER`, `ParsedFilter`, `ParsedSort` from `@openldr/table-query`.
- Produces: `FacilityListOptions.filters?: ParsedFilter[]`, `.sorts?: ParsedSort[]`. Tasks 3 and 4 both populate these.

⛔ **The store already has a correct tiebreaker.** It orders `facility_registry.name asc` then `facility_registry.id asc` (`:435-441`). Unlike audit, nothing is broken here. That default MUST be passed to `applySorts` as its `defaultSorts` argument — `[{ column: "name", ascending: true }]`. Omit it and an unsorted request falls through to tiebreaker-only, silently changing the page's load order from alphabetical to UUID order.

⛔ **`health` is not a grammar column.** Leave `joinHealth` exactly as it is. Do not try to route it through `buildFilterExpression`.

⛔ **`applyFilters` runs BEFORE the joins**, deliberately — see the comment at `:390-400`. Keep that order so its column references stay unqualified and its type stays `SelectQueryBuilder<InternalSchema, 'facility_registry', O>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/facility-registry-store.test.ts`, reusing that file's existing pg-mem harness and fixtures:

```ts
it("applies a grammar filter", async () => {
  const store = await seededStore();  // whatever this file's helper is called
  const { rows } = await store.list({
    filters: [{ column: "level", operator: "eq", value: "hospital", combine: "and" }],
  });
  expect(rows.every((r) => r.level === "hospital")).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
});

it("ANDs a grammar filter with the existing named params", async () => {
  const store = await seededStore();
  const both = await store.list({
    status: "active",
    filters: [{ column: "level", operator: "eq", value: "hospital", combine: "and" }],
  });
  expect(both.rows.every((r) => r.status === "active" && r.level === "hospital")).toBe(true);
});

it("counts with the same filters as list", async () => {
  const store = await seededStore();
  const filters = [{ column: "level", operator: "eq", value: "hospital", combine: "and" as const }];
  const { rows, total } = await store.list({ filters, limit: 1000 });
  expect(total).toBe(rows.length);
});

it("keeps alphabetical order when the caller sends no sort", async () => {
  const store = await seededStore();
  const { rows } = await store.list({ limit: 1000 });
  const names = rows.map((r) => r.name);
  expect([...names].sort()).toEqual(names);
});

it("honours an explicit sort instead of the default", async () => {
  const store = await seededStore();
  const { rows } = await store.list({ sorts: [{ column: "level", ascending: true }], limit: 1000 });
  const levels = rows.map((r) => r.level ?? "");
  expect([...levels].sort()).toEqual(levels);
});

it("still filters health, which is not a grammar column", async () => {
  const store = await seededStore();
  const { rows } = await store.list({ health: "unprojected" });
  expect(rows.every((r) => r.health === "unprojected")).toBe(true);
});
```

Read the file first and adapt the fixture helper name and the seeded values — do not invent a `seededStore()` that does not exist.

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts
```
Expected: FAIL — `filters` is not part of `FacilityListOptions`.

- [ ] **Step 3: Wire the store**

Add to `FacilityListOptions`:

```ts
  /** Validated grammar rules from parseTableQuery. ANDed with the named fields above.
   *  `health` is deliberately NOT expressible here — it is a join predicate, not a column. */
  filters?: ParsedFilter[];
  sorts?: ParsedSort[];
```

At the end of `applyFilters`, before `return q`:

```ts
        // Grammar rules, ANDed with the named params above. `applyFilters` uses the chained
        // q.where(col, op, val) form, which gives no ExpressionBuilder — Kysely's callback form
        // does, and that is what buildFilterExpression needs. Guarded on length because
        // buildFilterExpression returns undefined for an empty list.
        if (opts.filters?.length) {
          q = q.where((eb) => buildFilterExpression(eb, opts.filters!, FACILITY_COLUMNS)!);
        }
```

Replace the two `orderBy` calls on `rowsQ` with `applySorts`:

```ts
      const sorted = applySorts(
        joinHealth(applyFilters(/* the existing select */)),
        opts.sorts ?? [],
        FACILITY_COLUMNS,
        FACILITY_TIEBREAKER,
        // The registry's own alphabetical default. Passed as defaultSorts so an unsorted
        // request keeps today's order instead of falling through to tiebreaker-only (id) order.
        [{ column: "name", ascending: true }],
      );
      const rowsQ = sorted.limit(opts.limit ?? DEFAULT_LIST_LIMIT).offset(opts.offset ?? 0);
```

`countQ` takes the same `applyFilters` and needs no ordering change.

- [ ] **Step 4: Run it**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts
```
Expected: PASS, including the file's pre-existing tests.

- [ ] **Step 5: Add the live proofs**

Create `packages/db/src/facility-registry-live.test.ts`, gated exactly like `packages/db/src/table-query-pagination.live.test.ts` — copy its skip guard and connection helper.

Two tests:
1. **Collation** — insert facilities with mixed-case names (`''`, `BETA Clinic`, `alpha Clinic`, `epsilon Clinic`), sort by `name` ascending through `store.list`, assert `['', 'alpha Clinic', 'BETA Clinic', 'epsilon Clinic']`. pg-mem cannot run this: no ICU.
2. **Paging over duplicate names** — insert 40 facilities all named `Same Name`, page through in tens, assert 40 distinct ids. Sharing a name is the norm in a national register, not an edge case.

Then break the tiebreaker argument, confirm test 2 FAILS with fewer than 40 distinct ids, restore, confirm it passes. Report all three outputs. pg-mem's stable scan order means this test passes with or without the fix, so the mutation check is what makes it real.

Export `INTERNAL_DATABASE_URL` from the repo-root `.env` before running — a skipped live test proves nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/facility-registry-store.ts packages/db/src/facility-registry-store.test.ts packages/db/src/facility-registry-live.test.ts
git commit -m "feat(db): the facility store takes grammar filters and sorts"
```

---

## Task 3: The route parses the wire format

**Files:**
- Modify: `apps/server/src/facilities-routes.ts:881-908`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `parseTableQuery`, `FACILITY_COLUMNS` from `@openldr/table-query`; `FacilityListOptions.filters`/`.sorts` from Task 2.
- Produces: `GET /api/facilities?filters=<json>&sorts=<json>`.

**Context.** The handler reads fourteen named params via `ownFirstString(q, 'name')`, a helper that reads only own properties. All fourteen must keep working.

⚠ `apps/server` is the only package with real lint, enforcing a return/await discipline on `reply.send` that prevents a gzip-clobbering bug. The existing handler returns a plain object rather than calling `reply.send`. Your 400 path must follow the form the surrounding 4xx handlers use — `return reply.code(400).send({ error: … })` — and you must run the linter.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/src/facilities-routes.test.ts`, reusing its existing app harness:

```ts
it("passes parsed filters through to the store", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/facilities?filters=${encodeURIComponent(JSON.stringify([{ column: "level", operator: "eq", value: "hospital", combine: "and" }]))}`,
  });
  expect(res.statusCode).toBe(200);
  // Prove it REACHED the store, not merely that the route did not crash.
  const lastCall = (listSpy as any).mock.calls.at(-1)[0];
  expect(lastCall.filters).toEqual([
    { column: "level", operator: "eq", value: "hospital", combine: "and" },
  ]);
});

it("400s on an unknown filter column, naming it", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/api/facilities?filters=${encodeURIComponent(JSON.stringify([{ column: "password", operator: "eq", value: "x", combine: "and" }]))}`,
  });
  expect(res.statusCode).toBe(400);
  expect(res.body).toContain("password");
});

it("400s on malformed JSON rather than treating it as no filter", async () => {
  const res = await app.inject({ method: "GET", url: "/api/facilities?filters=%7Bnot-json" });
  expect(res.statusCode).toBe(400);
});

it("still honours the existing named params", async () => {
  const res = await app.inject({ method: "GET", url: "/api/facilities?status=active&health=mapped" });
  expect(res.statusCode).toBe(200);
});
```

`listSpy` must be whatever spy the file already uses for `ctx.facilityRegistry.list`. If none exists, add one — asserting only the status code would not catch a route that parses correctly then drops the result, which is a real defect class this slice has already seen.

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
```
Expected: FAIL — the unknown column currently returns 200, because the param is ignored.

- [ ] **Step 3: Parse in the route**

In `apps/server/src/facilities-routes.ts`, after reading `q` and before calling `list`:

```ts
    const parsed = parseTableQuery(
      { filters: ownFirstString(q, 'filters'), sorts: ownFirstString(q, 'sorts') },
      FACILITY_COLUMNS,
    );
    // Never silently drop: a dropped filter gives a table that disagrees with its own chips row.
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
```

The handler signature currently takes only `req`. Add `reply` to it, matching the other handlers in this file.

Then add `filters: parsed.query.filters, sorts: parsed.query.sorts,` to the `list({...})` call.

- [ ] **Step 4: Run tests and lint**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
pnpm --filter @openldr/server lint
```
Expected: tests PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(server): the facilities route accepts grammar filters and sorts"
```

---

## Task 4: A `facilities list` CLI command

**Files:**
- Modify: `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts` (facilities group at `:281`)
- Test: `packages/cli/src/facilities.test.ts`

**Interfaces:**
- Consumes: `parseWhereFlags(where, sort, columns)` from `./table-query-flags` — already built and unchanged; `FACILITY_COLUMNS`.
- Produces: `runFacilitiesList(opts)`.

**Context.** There is no `facilities list` command today. The group has `import`, `suggest-map`, `suggest-values`, `import-runs`, `scan-observed`, `publish`, `conflicts`, `jobs`. Read `runFacilitiesConflicts` in `packages/cli/src/facilities.ts` first — it is the closest existing read command, and yours should match its shape for context creation, output and exit codes.

`parseWhereFlags` is reused **unchanged**, so an unknown column fails identically on the CLI and the route.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/src/facilities.test.ts`:

```ts
it("passes parsed where/sort flags to the store", async () => {
  const list = vi.fn().mockResolvedValue({ rows: [], total: 0 });
  // mock createAppContext the way this file's other tests do
  await runFacilitiesList({ where: ["level:eq:hospital"], sort: ["-name"], json: true });
  expect(list).toHaveBeenCalledWith(expect.objectContaining({
    filters: [{ column: "level", operator: "eq", value: "hospital", combine: "and" }],
    sorts: [{ column: "name", ascending: false }],
  }));
});

it("exits non-zero and names the column on a bad --where", async () => {
  const code = await runFacilitiesList({ where: ["password:eq:x"], sort: [], json: true });
  expect(code).toBe(1);
});
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts
```
Expected: FAIL — `runFacilitiesList` is not exported.

- [ ] **Step 3: Implement**

In `packages/cli/src/facilities.ts`:

```ts
interface FacilitiesListOpts {
  where?: string[];
  sort?: string[];
  limit?: string;
  json: boolean;
}

export async function runFacilitiesList(opts: FacilitiesListOpts): Promise<number> {
  const parsed = parseWhereFlags(opts.where ?? [], opts.sort ?? [], FACILITY_COLUMNS);
  if (!parsed.ok) {
    process.stderr.write(`facilities list failed: ${parsed.error}\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const { rows, total } = await ctx.facilityRegistry.list({
      filters: parsed.query.filters.length ? parsed.query.filters : undefined,
      sorts: parsed.query.sorts.length ? parsed.query.sorts : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify({ rows, total }, null, 2) + '\n');
    } else {
      const lines = rows.map((r) => `${r.facilityCode ?? '-'}\t${r.name}\t${r.region ?? '-'}\t${r.status ?? '-'}`);
      process.stdout.write((lines.length ? lines.join('\n') : '(no facilities)') + '\n');
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
```

Check the real field names on the store's row type before writing the text output — `facilityCode` is an assumption and must be verified against `FacilityListRow`.

Register it in `packages/cli/src/program.ts`, in the existing `facilities` group:

```ts
  facilities
    .command('list')
    .description('List facilities from the registry')
    .option('--where <rule...>', 'filter as column:operator:value (repeatable)')
    .option('--sort <column...>', 'sort by column; prefix with - for descending (repeatable)')
    .option('--limit <n>', 'maximum rows to return')
    .option('--json', 'emit JSON', false)
    .action(async (opts: FacilitiesListOpts) => {
      try { process.exitCode = await runFacilitiesList(opts); }
      catch (err) { process.stderr.write(`facilities list failed: ${redactError(err)}\n`); process.exitCode = 1; }
    });
```

- [ ] **Step 4: Run the CLI suite**

```bash
pnpm --filter @openldr/cli exec vitest run
pnpm --filter @openldr/cli typecheck
```
Expected: PASS, including the package's pre-existing facility tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/facilities.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): facilities list with --where and --sort"
```

---

## Task 5: The Facilities page adopts the toolbar

**Files:**
- Modify: `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/api.ts` (`FacilityListQuery`)
- Modify: `apps/studio/src/i18n/{en,fr,pt}.ts` if any column label is missing
- Test: `apps/studio/src/pages/Facilities.test.tsx`

**Interfaces:**
- Consumes: `FACILITY_COLUMNS`; `ColumnDef.operators`; the route's `filters`/`sorts` params from Task 3.
- Produces: nothing later tasks depend on.

**This is the largest page in the app — 1126 lines. If the adoption fights the existing panel, stop and report rather than forcing it.**

⛔ **Server-paginated. Do NOT call `applyTableState`.**

⛔ **`health` keeps its own control.** It is not a grammar column. Leave its picker where it is, beside the toolbar, and keep sending it as the named param.

⛔ **`q` becomes the toolbar's search box.** Wire `DataTableToolbar`'s `onSearchChange` to the existing `q` param — do NOT pre-filter rows in the browser. This is the first adopted page with a genuinely server-side search.

⛔ **Filters live in the URL today.** `FacilitiesUrlState` (`Facilities.tsx:36`) is a `Pick<FacilityListQuery, …>` synced to the query string, so a filtered view is shareable. That capability must survive: serialise the grammar's `filters`/`sorts` into the URL as the same JSON the wire format uses, alongside the named params that remain. Losing it would be a silent regression nobody asked for.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/pages/Facilities.test.tsx`, reusing its `vi.mock('@/api', …)` block:

```tsx
import { addFilterViaPopover, expectStandardTableToolbar } from '@/components/data-table/expectStandardTableToolbar';

it('renders the standard toolbar and sends filters to the server', async () => {
  render(<MemoryRouter><Facilities /></MemoryRouter>);
  await screen.findByRole('table');

  await addFilterViaPopover('hospital', 'Level');
  expectStandardTableToolbar();

  await waitFor(() => {
    const last = (api.listFacilities as any).mock.calls.at(-1)[0];
    expect(last.filters).toEqual([
      expect.objectContaining({ column: 'level', operator: expect.any(String) }),
    ]);
  });
});

it('keeps health as a named param, not a grammar filter', async () => {
  render(<MemoryRouter><Facilities /></MemoryRouter>);
  await screen.findByRole('table');
  // drive the health control the way the page's existing tests do
  await waitFor(() => {
    const last = (api.listFacilities as any).mock.calls.at(-1)[0];
    expect(last.health).toBeDefined();
    expect(last.filters ?? []).not.toContainEqual(expect.objectContaining({ column: 'health' }));
  });
});
```

`addFilterViaPopover` takes an optional second argument naming the column to filter on — use it, because the page's first filterable column may render a picker rather than a text input.

- [ ] **Step 2: Run it**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx
```
Expected: FAIL — no Filter button.

- [ ] **Step 3: Extend the API client**

In `apps/studio/src/api.ts`, add to `FacilityListQuery`:

```ts
  filters?: ParsedFilter[];
  sorts?: ParsedSort[];
```

and in `listFacilities`, JSON-encode them rather than letting `String(v)` produce `[object Object]`:

```ts
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, k === 'filters' || k === 'sorts' ? JSON.stringify(v) : String(v));
  }
```

- [ ] **Step 4: Rewrite the page's filter surface**

Build columns from the map so the popover cannot exceed what the server accepts:

```tsx
const columns: ColumnDef<Facility>[] = useMemo(() => ([
  { id: 'code',   labelKey: 'facilities.code',   accessor: (f) => f.facilityCode ?? '-', type: 'text', defaultVisible: true, operators: FACILITY_COLUMNS.code!.operators },
  { id: 'name',   labelKey: 'facilities.name',   accessor: (f) => f.name,                type: 'text', defaultVisible: true, operators: FACILITY_COLUMNS.name!.operators },
  { id: 'region', labelKey: 'facilities.region', accessor: (f) => f.region ?? '-',       type: 'enum', defaultVisible: true, operators: FACILITY_COLUMNS.region!.operators },
  { id: 'district', labelKey: 'facilities.district', accessor: (f) => f.district ?? '-', type: 'enum', defaultVisible: true, operators: FACILITY_COLUMNS.district!.operators },
  { id: 'status', labelKey: 'facilities.status', accessor: (f) => f.status ?? '-',       type: 'enum', defaultVisible: true, operators: FACILITY_COLUMNS.status!.operators },
  { id: 'source', labelKey: 'facilities.filters.sourceLabel', accessor: (f) => f.source ?? '-', type: 'enum', defaultVisible: true, operators: FACILITY_COLUMNS.source!.operators },
]), []);
```

Those six match the page's existing `<TableHead>` list at `Facilities.tsx:946-956`, so the visible table does not change shape. Add `enumOptions` from whatever the page already uses to populate its pickers — do not invent value sets, and do not hardcode them (AGENTS.md §8).

Replace the bespoke filter panel's column-backed controls with the toolbar, keep the `health` picker, and drive the fetch from `table.filters`, `table.sorts`, `table.page`, `table.pageSize` plus the surviving named params. Follow `apps/studio/src/pages/Audit.tsx` for the server-paginated wiring — it is the closest model and does not call `applyTableState`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx src/i18n/parity.test.ts
pnpm --filter @openldr/studio typecheck
```
Expected: PASS.

```bash
git add apps/studio/src/pages/Facilities.tsx apps/studio/src/pages/Facilities.test.tsx apps/studio/src/api.ts apps/studio/src/i18n/
git commit -m "feat(studio): the facilities page filters and sorts on the server"
```

---

## Task 6: Docs, and the gate

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence to call slice C done.

- [ ] **Step 1: Update the docs in all three locales**

Check first whether `fr`/`pt` copies exist — at the time of writing, only `audit.md` had translations, and the resolver falls back per-slug to `en`, so a missing file is not broken, merely untranslated. Follow whatever `apps/studio/src/docs/0.1.0/` actually contains.

Cover: the toolbar (Filter, Sort, Columns, Reset, chips, and a search box that searches on the server), that `health` is a separate control because it is computed rather than stored, and the new CLI command with a worked example:

```bash
openldr facilities list --where level:eq:hospital --sort -name
```

- [ ] **Step 2: Run every affected package**

```bash
pnpm --filter @openldr/table-query test
pnpm --filter @openldr/db test
pnpm --filter @openldr/cli test
pnpm --filter @openldr/server test
pnpm --filter @openldr/studio test
```
Expected: all pass. Grep any failure for `Test timed out` and re-run that file alone before blaming a change — `packages/db` migration tests `025`, `054` and `083` have timed out under parallel load before and pass standalone.

- [ ] **Step 3: Run the live tests with a database**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-live.test.ts
```
Expected: PASS, **not skipped**. Export `INTERNAL_DATABASE_URL` from the repo-root `.env` first. The database is container `openldr_ce-postgres-1` on port 5433.

- [ ] **Step 4: State plainly what was not proven**

`AUTH_DEV_BYPASS=false`, so the studio needs a real Keycloak login and the Facilities page will not be opened in a browser. Layout and mobile at 375px are unverified. On the largest page in the app, say so explicitly rather than letting a green suite imply otherwise.

Also state that `q` remains an unindexed sequential scan — the store's own comment at `facility-registry-store.ts:361-368` says a leading `%` means no btree index can serve it, and it has never been benchmarked at the ~13,000-row scale of a national register.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/src/docs
git commit -m "docs(facilities): filtering, sorting and the new CLI command"
```

---

## Self-review notes

**Spec coverage.** Missing map columns → Task 1. Join-ambiguity guard → Task 1. Store filters/sorts and the `defaultSorts` trap → Task 2. Live collation and duplicate-name paging → Task 2. Route → Task 3. CLI → Task 4. Page, `health` separate, `q` as server-side search, URL state → Task 5. Docs and gate → Task 6.

**One thing the spec did not name, added here.** The page keeps its filters in the URL (`FacilitiesUrlState`, `Facilities.tsx:36`), so a filtered view is shareable. Task 5 requires that to survive the rewrite. Dropping it would be a silent regression, and no spec section would have caught it.

**Places the plan says "verify first" rather than inventing.** The store test's fixture helper, the route test's list spy, the CLI row type's field names, and the page's existing `enumOptions` sources. Every one carries an instruction to read the real thing — naming a check beats inventing a helper that does not exist, which cost a review round in an earlier slice.

**`health` appears in three tasks as a negative requirement** — Task 2 (leave `joinHealth` alone), Task 5 (keep its control, keep it out of `filters`). That repetition is deliberate: it is the single most likely thing for an implementer to "tidy up" into the grammar, and it cannot go there.
