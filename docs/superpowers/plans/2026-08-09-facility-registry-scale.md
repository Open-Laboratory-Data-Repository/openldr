# Registry at national scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Facilities Registry tab navigable at national scale — server-side offset paging with an exact total, search, filters including mapping/projection health, and linkable URL state.

**Architecture:** `facility_registry` lives in the INTERNAL database, which is always Postgres, so there is no dialect matrix here. The store's `list()` gains paging/search/filter options and returns `{ rows, total }`; the route exposes them; the client replaces its 2 000-row fetch-everything with a paged request whose state lives in the URL. Mapping/projection health joins through `facility_concept_projection.concept_code` to `term_mappings.to_code` **via an uncorrelated derived-table aggregate**, never a plain join.

**Tech Stack:** TypeScript, Kysely (Postgres only for this slice), Fastify, React + shadcn/ui, Vitest, pg-mem, i18next (en/fr/pt).

**Spec:** `docs/superpowers/specs/2026-08-09-facility-registry-scale-design.md`

## Global Constraints

- **Gate:** `pnpm turbo run typecheck test --force`. **NEVER pipe turbo through `tail`.** Whole-package vitest runs need `--testTimeout=30000`.
- **Commits:** never add a `Co-Authored-By` trailer. **Never `git add -A`** — the working directory is shared with concurrent sessions; always `git add` explicit paths.
- **Never revert an edit with `git checkout -- <file>`** — it reverts the whole file and has destroyed a task's work before. Use in-place reverse edits.
- **Never write a raw control character into a source file.** A NUL byte has made a file binary to git twice in this repo.
- **Mutation-prove every test:** break the behaviour it pins, watch it fail, restore in place. Record the observed failure message in the task report.
- **If you cannot verify a claim, do not write it.** Predecessor branches on this workstream were caught overclaiming in comments 6, 13 and 4 times respectively.
- **`facility_registry` is INTERNAL = always Postgres.** `internalMigrations` takes no engine argument. Do not add dialect branching.
- **pg-mem has ZERO correlated-subquery support** (measured). No `EXISTS (… where x = outer.y)` anywhere in this slice.
- **This slice adds NO action controls** — only inputs (search box, filter selects, pager). Do not add buttons to headers or footers; the app's standing convention is that every *action* lives in a `⋯` `DropdownMenu`, and FAC-P1-20 is deliberately deferred to a separate app-wide decision.
- **i18n has a parity test** (`apps/studio/src/i18n/parity.test.ts`). Every key added or removed must be applied to **all three** of `en.ts`, `fr.ts`, `pt.ts`.
- **No new database indexes** unless Task 5's measurement justifies one.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/facility-registry-store.ts` | **Modify** — `FacilityListOptions`, `list()` → `{rows,total}`, search + filters | 1 |
| `packages/db/src/facility-registry-store.test.ts` | **Modify** — paging/total/search/filter tests | 1 |
| `packages/db/src/facility-registry-store.ts` | **Modify** — health join + `health` filter + `mappingCount` | 2 |
| `packages/db/src/facility-registry-store.test.ts` | **Modify** — health states + the fan-out guard | 2 |
| `apps/server/src/facilities-routes.ts` | **Modify** — `parseOffset`, new params, `{rows,total,limit,offset}` | 3 |
| `apps/server/src/facilities-routes.test.ts` | **Modify** — route contract tests | 3 |
| `apps/studio/src/api.ts` | **Modify** — delete `FACILITIES_LIST_LIMIT`, paged `listFacilities` | 4 |
| `apps/studio/src/pages/Facilities.tsx` | **Modify** — delete truncation banner, add search/filter/pager + URL state | 4 |
| `apps/studio/src/pages/Facilities.test.tsx` | **Modify** — client behaviour tests | 4 |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | **Modify** — remove `facilities.truncated`, add new keys | 4 |
| — | Index measurement on real Postgres (report only, no diff unless justified) | 5 |

---

### Task 1: Store — paging, exact total, search, filters

**Files:**
- Modify: `packages/db/src/facility-registry-store.ts`
- Test: `packages/db/src/facility-registry-store.test.ts`

**Interfaces:**
- Consumes: `makeMigratedDb` from `./migrations/internal/test-helpers`; `createFacilityRegistryStore(db)`; the existing `FacilityRecord` and private `toRecord(r)`.
- Produces:
  - `FacilityListOptions` with `offset?`, `q?`, `country?`, `zone?`, `level?`, `ownership?`, `nationalSystem?`, `managedOrigin?`, `source?` added to the existing `region?`, `district?`, `council?`, `status?`, `limit?`.
  - `list(opts?): Promise<{ rows: FacilityRecord[]; total: number }>` — **a breaking change to an exported interface.**

**Context you need:**

`list()` currently returns a bare `FacilityRecord[]`:

```ts
    async list(opts = {}) {
      let q = db.selectFrom('facility_registry').selectAll();
      if (opts.region) q = q.where('region', '=', opts.region);
      if (opts.district) q = q.where('district', '=', opts.district);
      if (opts.council) q = q.where('council', '=', opts.council);
      if (opts.status) q = q.where('status', '=', opts.status);
      q = q.orderBy('name', 'asc');
      q = q.limit(opts.limit ?? DEFAULT_LIST_LIMIT);
      return (await q.execute()).map((r) => toRecord(r as Row));
    },
```

`DEFAULT_LIST_LIMIT = 200` stays. Real columns available: `id`, `local_code`, `national_system`, `national_code`, `name`, `level`, `ownership`, `status`, `country`, `zone`, `region`, `district`, `council`, `ward`, `village`, `address_text`, `phone`, `latitude`, `longitude`, `extras` (jsonb), `managed_origin`, `source`, `created_at`, `updated_at`.

⚠ **There is exactly ONE production caller**: `apps/server/src/facilities-routes.ts:388`. Task 3 updates it. Between Task 1 and Task 3 the workspace typecheck will fail on that one line — that is expected and is Task 3's job. Do **not** paper over it by returning an array-like object.

⚠ **Search covers `name`, `local_code`, `national_code`, `region`, `district`, `council` only.** The audit also asks for aliases; **there is no alias column** and `extras` is an untyped jsonb bag. Do not invent an alias convention — the spec records this as an unmet requirement belonging to sub-project B.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/facility-registry-store.test.ts`, inside the existing `describe('createFacilityRegistryStore', ...)`:

```ts
  /** Seeds `n` facilities named "Facility 001".."Facility n", alternating region/status so filter
   *  and search tests have something to discriminate. Returns the store. */
  async function seedMany(n: number) {
    const { s } = await store();
    for (let i = 1; i <= n; i += 1) {
      const p = String(i).padStart(3, '0');
      await s.upsert({
        id: `f${p}`,
        name: `Facility ${p}`,
        localCode: `LC-${p}`,
        nationalSystem: i % 2 === 0 ? 'urn:hfr' : 'urn:mfl',
        nationalCode: `NC-${p}`,
        region: i % 2 === 0 ? 'Dodoma' : 'Mwanza',
        status: i % 3 === 0 ? 'Closed' : 'Active',
        level: 'dispensary',
        source: 'manual' as const,
      });
    }
    return s;
  }

  it('pages with an exact total that is independent of the page size', async () => {
    const s = await seedMany(25);
    const first = await s.list({ limit: 10, offset: 0 });
    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.rows[0].name).toBe('Facility 001');

    const last = await s.list({ limit: 10, offset: 20 });
    expect(last.rows).toHaveLength(5);
    expect(last.total).toBe(25);
    expect(last.rows[0].name).toBe('Facility 021');
  });

  it('returns an empty page rather than erroring when offset runs past the end', async () => {
    const s = await seedMany(5);
    const past = await s.list({ limit: 10, offset: 500 });
    expect(past.rows).toEqual([]);
    expect(past.total).toBe(5);
  });

  it('total reflects the filters, not the page size', async () => {
    const s = await seedMany(25);
    const dodoma = await s.list({ region: 'Dodoma', limit: 5 });
    expect(dodoma.total).toBe(12);
    expect(dodoma.rows).toHaveLength(5);
    expect(dodoma.rows.every((r) => r.region === 'Dodoma')).toBe(true);
  });

  it('searches name, local code, national code and admin area, case-insensitively', async () => {
    const s = await seedMany(25);
    expect((await s.list({ q: 'facility 007' })).total).toBe(1);
    expect((await s.list({ q: 'LC-008' })).total).toBe(1);
    expect((await s.list({ q: 'nc-009' })).total).toBe(1);
    expect((await s.list({ q: 'dodoma' })).total).toBe(12);
    expect((await s.list({ q: 'no such facility' })).total).toBe(0);
  });

  it('filters on every column-backed dimension', async () => {
    const s = await seedMany(25);
    expect((await s.list({ nationalSystem: 'urn:hfr' })).total).toBe(12);
    expect((await s.list({ status: 'Closed' })).total).toBe(8);
    expect((await s.list({ level: 'dispensary' })).total).toBe(25);
    expect((await s.list({ source: 'manual' })).total).toBe(25);
    expect((await s.list({ level: 'hospital' })).total).toBe(0);
  });

  it('combines search and filters conjunctively', async () => {
    const s = await seedMany(25);
    const r = await s.list({ q: 'dodoma', status: 'Closed' });
    expect(r.total).toBe(4);
    expect(r.rows.every((x) => x.region === 'Dodoma' && x.status === 'Closed')).toBe(true);
  });

  it('handles a realistically long facility name without truncating or erroring', async () => {
    const { s } = await store();
    const long = `Mwananyamala Regional Referral Hospital ${'and Community Outreach Annexe '.repeat(6)}`.trim();
    await s.upsert({ id: 'long', name: long, localCode: 'L', source: 'manual' as const });
    const r = await s.list({ q: 'Outreach' });
    expect(r.total).toBe(1);
    expect(r.rows[0].name).toBe(long);
  });
```

⚠ Verify the seeded counts against the generator before trusting them: with `n = 25`, `i % 2 === 0` gives 12 Dodoma rows, `i % 3 === 0` gives 8 Closed rows, and Dodoma∧Closed (`i` divisible by 6) gives 4. If your `upsert` shape differs from the fields above, follow the real `FacilityRecord` type rather than this snippet.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts --testTimeout=30000
```

Expected: FAIL — `list()` returns an array, so `.rows` is `undefined` and `.total` is `undefined`.

- [ ] **Step 3: Extend the options interface**

In `packages/db/src/facility-registry-store.ts`, replace `FacilityListOptions`:

```ts
export interface FacilityListOptions {
  /** Case-insensitive substring across name, local code, national code, and admin area.
   *  ⚠ NOT aliases — `facility_registry` has no alias column and `extras` is an untyped jsonb bag.
   *  The audit (FAC-P1-01) asks for alias search; it belongs with sub-project B's identity
   *  modelling, and is deliberately unmet here rather than faked. */
  q?: string;
  country?: string;
  zone?: string;
  region?: string;
  district?: string;
  council?: string;
  /** Operational status. Distinct from `source` and `managedOrigin` below — see their comments. */
  status?: string;
  level?: string;
  /** Facility ownership (public/private/…), not provenance. */
  ownership?: string;
  /** WHICH national register the row's `nationalCode` belongs to — the audit's "registry source". */
  nationalSystem?: string;
  /** HOW the row entered this registry (manual, import, …). */
  source?: string;
  /** WHO owns the row's content — central sync vs local. */
  managedOrigin?: string;
  /** Defaults to 200 when omitted — a national register runs 10-15k rows and an unbounded scan is
   *  never what a caller wants. Pass an explicit value (including a large one) to override. */
  limit?: number;
  /** Rows to skip. Offset paging, not cursor: the audit requires an authoritative total and
   *  page-jumping, which a cursor composes badly with. Drift under concurrent writes is accepted —
   *  see the spec's Known limits. */
  offset?: number;
}
```

- [ ] **Step 4: Rewrite `list()`**

Replace the `async list(opts = {})` body:

```ts
    async list(opts = {}) {
      // ⛔ ONE predicate builder shared by the rows query and the count query. Two copies would
      // drift, and a `total` that disagrees with the page it describes is worse than no total.
      const applyFilters = <Q extends { where: any }>(qb: Q): Q => {
        let q: any = qb;
        if (opts.country) q = q.where('country', '=', opts.country);
        if (opts.zone) q = q.where('zone', '=', opts.zone);
        if (opts.region) q = q.where('region', '=', opts.region);
        if (opts.district) q = q.where('district', '=', opts.district);
        if (opts.council) q = q.where('council', '=', opts.council);
        if (opts.status) q = q.where('status', '=', opts.status);
        if (opts.level) q = q.where('level', '=', opts.level);
        if (opts.ownership) q = q.where('ownership', '=', opts.ownership);
        if (opts.nationalSystem) q = q.where('national_system', '=', opts.nationalSystem);
        if (opts.source) q = q.where('source', '=', opts.source);
        if (opts.managedOrigin) q = q.where('managed_origin', '=', opts.managedOrigin);
        if (opts.q) {
          // `ilike` with a wrapped `%` — no index will serve this, and at a 10-15k-row national
          // register a sequential scan is single-digit milliseconds. Measured before adding an
          // index rather than assumed; see the plan's index-measurement task.
          const like = `%${opts.q}%`;
          q = q.where((eb: any) => eb.or([
            eb('name', 'ilike', like),
            eb('local_code', 'ilike', like),
            eb('national_code', 'ilike', like),
            eb('region', 'ilike', like),
            eb('district', 'ilike', like),
            eb('council', 'ilike', like),
          ]));
        }
        return q as Q;
      };

      const rowsQ = applyFilters(db.selectFrom('facility_registry').selectAll())
        .orderBy('name', 'asc')
        .limit(opts.limit ?? DEFAULT_LIST_LIMIT)
        .offset(opts.offset ?? 0);
      const countQ = applyFilters(
        db.selectFrom('facility_registry').select((eb) => eb.fn.countAll<number>().as('n')),
      );

      const [rows, counted] = await Promise.all([rowsQ.execute(), countQ.executeTakeFirst()]);
      return {
        rows: rows.map((r) => toRecord(r as Row)),
        total: Number(counted?.n ?? 0),
      };
    },
```

Update the `FacilityRegistryStore` interface declaration for `list`:

```ts
  /** Page of facilities plus the EXACT total matching the same search/filters (before limit/offset).
   *  Capped at 200 rows by default — see `FacilityListOptions.limit`. */
  list(opts?: FacilityListOptions): Promise<{ rows: FacilityRecord[]; total: number }>;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts --testTimeout=30000
```

Expected: PASS. Existing tests in this file that call `list()` and index it as an array must be updated to read `.rows` — a test asserting the old shape was asserting the thing this task changes.

- [ ] **Step 6: Run the package suite**

```bash
pnpm --filter @openldr/db exec vitest run --testTimeout=30000
```

Expected: PASS.

- [ ] **Step 7: Mutation-prove the total**

Change `countQ` to drop `applyFilters` (i.e. count the whole table). Expected: *"total reflects the filters, not the page size"* FAILS with `25` instead of `12`. **Restore with an in-place reverse edit, never `git checkout`.** Record the observed message.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/facility-registry-store.ts packages/db/src/facility-registry-store.test.ts
git commit -m "feat(facilities): page, search and filter the registry with an exact total

list() returns { rows, total } instead of a bare array so the page can say how
many facilities match rather than silently capping. Offset paging, not cursor:
the audit requires an authoritative total and page-jumping, which a cursor
composes badly with.

Search covers name, local code, national code and admin area. NOT aliases --
there is no alias column and extras is an untyped jsonb bag, so that audit
requirement is recorded as unmet rather than faked.

One shared predicate builder feeds both the rows query and the count query: two
copies would drift, and a total that disagrees with its own page is worse than
no total at all."
```

---

### Task 2: Store — mapping/projection health

**Files:**
- Modify: `packages/db/src/facility-registry-store.ts`
- Test: `packages/db/src/facility-registry-store.test.ts`

**Interfaces:**
- Consumes: Task 1's `FacilityListOptions` and `list(): Promise<{rows,total}>`; `FACILITY_REGISTRY_SYSTEM` (`'urn:openldr:cs:facility-registry'`) exported from `./facility-observed`.
- Produces: `FacilityListOptions.health?: 'mapped' | 'unmapped' | 'unprojected'`; each returned row carries `health` and `mappingCount`.

**Context you need — read this before writing code:**

A facility is a mapping target via its **projected concept code**, never its id. `facility_concept_projection (registry_id PK → facility_registry.id ON DELETE CASCADE, concept_code, updated_at)` holds the code; a resolution is a `term_mappings` row with `to_system = FACILITY_REGISTRY_SYSTEM`, `is_active = true`, `map_type = 'SAME-AS'`, and `to_code = facility_concept_projection.concept_code`.

⛔ **A plain `left join` to `term_mappings` is WRONG and will corrupt paging.** One facility is legitimately the target of MANY observed codes — migration 078's partial unique index constrains one active resolution per *observed* code, not per *target*. A plain join multiplies the facility row by its mapping count, inflating both the page and the total. This is the same fan-out class the `facility_of` CTE exists to prevent in the seeded reports.

⛔ **An `EXISTS`/correlated subquery is also WRONG here** — pg-mem, which this test suite runs against, has **zero correlated-subquery support** (measured: five variants all fail `column "t1.k" does not exist`). It would be untestable.

The shape that satisfies both is an **uncorrelated derived-table aggregate**, already probed working against pg-mem including paging and filtering.

- [ ] **Step 1: Write the failing tests**

```ts
  /** Projects a facility (making it selectable as a mapping target) and optionally points `n`
   *  active SAME-AS mappings at it — the many-observed-codes-to-one-facility case. */
  async function project(db: any, registryId: string, conceptCode: string, mappings = 0) {
    await db.insertInto('facility_concept_projection')
      .values({ registry_id: registryId, concept_code: conceptCode }).execute();
    for (let i = 0; i < mappings; i += 1) {
      await db.insertInto('term_mappings').values({
        id: `${registryId}-m${i}`, from_system: 'urn:openldr:default_fac', from_code: `OBS-${registryId}-${i}`,
        to_system: 'urn:openldr:cs:facility-registry', to_code: conceptCode, to_display: null,
        map_type: 'SAME-AS', relationship: null, owner: null, is_active: true,
      }).execute();
    }
  }

  it('reports unprojected, unmapped and mapped health', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', localCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', localCode: 'L-C', source: 'manual' as const });
    await project(db, 'a', 'L-A', 1);
    await project(db, 'b', 'L-B', 0);
    // 'c' is never projected — it cannot be picked as a mapping target at all.

    const { rows } = await s.list({});
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.a.health).toBe('mapped');
    expect(byId.b.health).toBe('unmapped');
    expect(byId.c.health).toBe('unprojected');
  });

  it('⭐ a facility targeted by TWO mappings appears ONCE and does not inflate the total', async () => {
    // The fan-out guard. term_mappings permits many observed codes to resolve to one facility, so a
    // plain left join would return this facility twice and report total 2.
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await project(db, 'a', 'L-A', 2);

    const r = await s.list({});
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(1);
    expect(r.rows[0].mappingCount).toBe(2);
  });

  it('an inactive or non-SAME-AS mapping does not make a facility read as mapped', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await db.insertInto('facility_concept_projection')
      .values({ registry_id: 'a', concept_code: 'L-A' }).execute();
    await db.insertInto('term_mappings').values([
      { id: 'm-inactive', from_system: 'urn:openldr:default_fac', from_code: 'O1',
        to_system: 'urn:openldr:cs:facility-registry', to_code: 'L-A', to_display: null,
        map_type: 'SAME-AS', relationship: null, owner: null, is_active: false },
      { id: 'm-narrower', from_system: 'urn:openldr:default_fac', from_code: 'O2',
        to_system: 'urn:openldr:cs:facility-registry', to_code: 'L-A', to_display: null,
        map_type: 'NARROWER-THAN', relationship: null, owner: null, is_active: true },
    ]).execute();

    const { rows } = await s.list({});
    expect(rows[0].health).toBe('unmapped');
    expect(rows[0].mappingCount).toBe(0);
  });

  it('filters by health, with a total that matches', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', localCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', localCode: 'L-C', source: 'manual' as const });
    await project(db, 'a', 'L-A', 1);
    await project(db, 'b', 'L-B', 0);

    const mapped = await s.list({ health: 'mapped' });
    expect(mapped.total).toBe(1);
    expect(mapped.rows.map((r) => r.id)).toEqual(['a']);
    expect((await s.list({ health: 'unmapped' })).total).toBe(1);
    expect((await s.list({ health: 'unprojected' })).total).toBe(1);
  });
```

⚠ Check `term_mappings`'s real NOT NULL columns before trusting the insert shapes above — its columns are `id, from_system, from_code, to_system, to_code, to_display, map_type, relationship, owner, is_active, created_at, updated_at, managed_origin`. Follow the real schema.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-registry-store.test.ts --testTimeout=30000
```

Expected: FAIL — `health` and `mappingCount` are `undefined`.

- [ ] **Step 3: Add the option and the record fields**

Add to `FacilityListOptions`:

```ts
  /** Mapping/projection health (FAC-P1-01). `unprojected` means the facility has no
   *  `facility_concept_projection` row and therefore CANNOT be selected as a mapping target at all
   *  — the FAC-P0-08 failure state, visible in a list instead of only as a failed background job. */
  health?: 'mapped' | 'unmapped' | 'unprojected';
```

Add to the type each row carries (extend the record the store returns, next to the existing fields):

```ts
/** Derived per row by `list()`, never stored. */
export type FacilityHealth = 'mapped' | 'unmapped' | 'unprojected';
```

- [ ] **Step 4: Join health into `list()`**

Import the constant at the top of `packages/db/src/facility-registry-store.ts`:

```ts
import { FACILITY_REGISTRY_SYSTEM } from './facility-observed';
```

In `list()`, build the joined base once and share it, replacing the two `db.selectFrom('facility_registry')` starts:

```ts
      // ⛔ An UNCORRELATED derived-table aggregate, and both halves of that matter.
      //
      // NOT a plain join to `term_mappings`: one facility is legitimately the target of MANY
      // observed codes (078's partial unique index constrains one active resolution per OBSERVED
      // code, not per target), so a plain join multiplies the facility by its mapping count and
      // inflates both the page and the total — the same fan-out the `facility_of` CTE exists to
      // prevent in the seeded reports.
      //
      // NOT an EXISTS/correlated subquery either: pg-mem, which this suite runs against, has zero
      // correlated-subquery support (measured), so a correlated form would be untestable here.
      const withHealth = (qb: any) => qb
        .leftJoin('facility_concept_projection as fcp', 'fcp.registry_id', 'facility_registry.id')
        .leftJoin(
          (eb: any) => eb.selectFrom('term_mappings')
            .select((e: any) => ['to_code', e.fn.countAll<number>().as('n')])
            .where('to_system', '=', FACILITY_REGISTRY_SYSTEM)
            .where('is_active', '=', true)
            .where('map_type', '=', 'SAME-AS')
            .groupBy('to_code')
            .as('m'),
          (join: any) => join.onRef('m.to_code', '=', 'fcp.concept_code'),
        );

      // Health as explicit predicates rather than filtering on a computed alias — the same three
      // conditions serve the rows query and the count query without wrapping either in a subquery.
      const applyHealth = (qb: any) => {
        if (opts.health === 'unprojected') return qb.where('fcp.registry_id', 'is', null);
        if (opts.health === 'mapped') return qb.where(sql`coalesce(m.n, 0)`, '>', 0);
        if (opts.health === 'unmapped') {
          return qb.where('fcp.registry_id', 'is not', null).where(sql`coalesce(m.n, 0)`, '=', 0);
        }
        return qb;
      };
```

⚠ **`selectAll()` must become `selectAll('facility_registry')`** now that there are joins, or `toRecord` receives the joined tables' columns too.

The rows query selects the derived fields alongside:

```ts
      const rowsQ = applyHealth(applyFilters(withHealth(
        db.selectFrom('facility_registry')
          .selectAll('facility_registry')
          .select(sql<string>`case when fcp.registry_id is null then 'unprojected'
                                   when coalesce(m.n, 0) > 0 then 'mapped'
                                   else 'unmapped' end`.as('health'))
          .select(sql<number>`coalesce(m.n, 0)`.as('mapping_count')),
      )))
        .orderBy('facility_registry.name', 'asc')
        .limit(opts.limit ?? DEFAULT_LIST_LIMIT)
        .offset(opts.offset ?? 0);

      const countQ = applyHealth(applyFilters(withHealth(
        db.selectFrom('facility_registry').select((eb: any) => eb.fn.countAll<number>().as('n')),
      )));
```

and the mapping gains the two derived fields:

```ts
        rows: rows.map((r: any) => ({
          ...toRecord(r as Row),
          health: r.health as FacilityHealth,
          mappingCount: Number(r.mapping_count ?? 0),
        })),
```

⚠ `applyFilters`'s column references may now be ambiguous across the joined tables. If Kysely or Postgres complains, qualify them as `'facility_registry.region'` etc. **Follow the compiler and the error, not this snippet.**

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run --testTimeout=30000
```

Expected: PASS, including Task 1's tests unchanged.

- [ ] **Step 6: Mutation-prove the fan-out guard**

Replace the derived-table join with a plain `.leftJoin('term_mappings as m', 'm.to_code', 'fcp.concept_code')`. Expected: *"a facility targeted by TWO mappings appears ONCE"* FAILS with 2 rows and `total: 2`. **This is the single most important test in the slice** — record the exact message, then restore in place.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/facility-registry-store.ts packages/db/src/facility-registry-store.test.ts
git commit -m "feat(facilities): report mapping/projection health per registry row

Three states from one join: unprojected (no facility_concept_projection row, so
the facility cannot be picked as a mapping target at all -- the FAC-P0-08 failure
made visible in a list rather than only as a failed job), unmapped, and mapped
with a count of how many observed codes resolve there.

An uncorrelated derived-table aggregate, deliberately. A plain join would
multiply a facility by its mapping count and inflate both the page and the total,
because term_mappings permits many observed codes to resolve to one facility --
the same fan-out the facility_of CTE prevents in reports. An EXISTS would be
untestable: pg-mem has zero correlated-subquery support."
```

---

### Task 3: HTTP route

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: Task 1/2's `list(opts) → { rows, total }` and the full `FacilityListOptions`.
- Produces: `GET /api/facilities` returning `{ rows, total, limit, offset }`.

**Context you need:**

The handler is currently:

```ts
  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as Record<string, unknown>;
    return ctx.facilityRegistry.list({
      region: ownFirstString(q, 'region'),
      district: ownFirstString(q, 'district'),
      council: ownFirstString(q, 'council'),
      status: ownFirstString(q, 'status'),
      limit: parseLimit(q.limit),
    });
  });
```

`ownFirstString(q, key)` returns a plain string or `undefined`, rejecting repeated (array-valued) params and reading only own properties. `parseLimit` rejects `NaN`, non-positive and non-string values and clamps to `MAX_LIST_LIMIT = 20000`. **This is the one production caller of `list()`** — after this task the workspace typecheck goes green again.

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/facilities-routes.test.ts` (follow the file's existing harness for building an app + seeding facilities):

```ts
  it('returns rows, total, limit and offset', async () => {
    // seed 12 facilities via the harness this file already uses
    const res = await app.inject({ method: 'GET', url: '/api/facilities?limit=5&offset=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(5);
    expect(body.total).toBe(12);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(5);
  });

  it('treats a negative, NaN or repeated offset as absent rather than passing it through', async () => {
    for (const bad of ['offset=-1', 'offset=abc', 'offset=1&offset=2']) {
      const body = (await app.inject({ method: 'GET', url: `/api/facilities?${bad}` })).json();
      expect(body.offset, bad).toBe(0);
    }
  });

  it('accepts offset=0 explicitly', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/facilities?offset=0' })).json();
    expect(body.offset).toBe(0);
  });

  it('passes search and the new filters through to the store', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/facilities?q=alpha&health=unmapped&level=dispensary' })).json();
    expect(body.total).toBeTypeOf('number');
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('ignores an unknown health value rather than passing it to the store', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/facilities?health=banana' })).json();
    expect(body.total).toBe(12);
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts --testTimeout=30000
```

Expected: FAIL — the response is a bare array, so `body.rows` is `undefined`.

- [ ] **Step 3: Add `parseOffset` and the health whitelist**

Beside `parseLimit` in `apps/server/src/facilities-routes.ts`:

```ts
/** Like `parseLimit`, but 0 is a legitimate value (the first page) — so this rejects only negative,
 *  non-finite, and non-string inputs. A repeated param arrives as an array and is not a string, so
 *  it is treated as absent, exactly as `parseLimit` treats it. Not clamped to MAX_LIST_LIMIT: an
 *  offset past the end is a legitimate empty page, not an error. */
function parseOffset(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** The three health values the store understands. A closed whitelist, not a cast: an arbitrary
 *  query string must never reach the store's health branch as an unhandled value. */
const HEALTH_VALUES = ['mapped', 'unmapped', 'unprojected'] as const;
function parseHealth(raw: unknown): 'mapped' | 'unmapped' | 'unprojected' | undefined {
  return typeof raw === 'string' && (HEALTH_VALUES as readonly string[]).includes(raw)
    ? (raw as 'mapped' | 'unmapped' | 'unprojected')
    : undefined;
}
```

- [ ] **Step 4: Rewrite the handler**

```ts
  app.get('/api/facilities', VIEW, async (req) => {
    const q = req.query as Record<string, unknown>;
    const limit = parseLimit(q.limit);
    const offset = parseOffset(q.offset) ?? 0;
    // A repeated query param (`?region=A&region=B`) arrives as an array; only a plain string is a
    // valid filter value, so anything else is treated as "not specified" rather than reaching
    // Kysely as `where(col, '=', [...])`. `ownFirstString` additionally keeps this reading only
    // `q`'s OWN properties — see its doc comment.
    const { rows, total } = await ctx.facilityRegistry.list({
      q: ownFirstString(q, 'q'),
      country: ownFirstString(q, 'country'),
      zone: ownFirstString(q, 'zone'),
      region: ownFirstString(q, 'region'),
      district: ownFirstString(q, 'district'),
      council: ownFirstString(q, 'council'),
      status: ownFirstString(q, 'status'),
      level: ownFirstString(q, 'level'),
      ownership: ownFirstString(q, 'ownership'),
      nationalSystem: ownFirstString(q, 'nationalSystem'),
      source: ownFirstString(q, 'source'),
      managedOrigin: ownFirstString(q, 'managedOrigin'),
      health: parseHealth(ownFirstString(q, 'health')),
      limit,
      offset,
    });
    // `limit` echoed as what the store actually applied, so a client never has to re-derive the
    // default it did not send.
    return { rows, total, limit: limit ?? rows.length, offset };
  });
```

⚠ Check what the store's `DEFAULT_LIST_LIMIT` is and decide deliberately what `limit` to echo when the client sent none. **`rows.length` is wrong on a short last page** — prefer importing/exporting the store's default, or echo `limit ?? null` and let the client treat null as "server default". Pick one, make it explicit, and say which in your report.

- [ ] **Step 5: Run to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts --testTimeout=30000
pnpm turbo run typecheck --force
```

Expected: PASS, and typecheck green across the workspace now that the sole `list()` caller matches.

- [ ] **Step 6: Mutation-prove the offset guard**

Change `parseOffset` to `return Math.floor(n)` without the `n < 0` check. Expected: *"treats a negative, NaN or repeated offset as absent"* FAILS for `offset=-1`. Restore in place; record the message.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): expose paging, search and filters on GET /api/facilities

Response becomes { rows, total, limit, offset }. parseOffset mirrors parseLimit's
discipline -- reject NaN, negative and repeated params -- but allows 0, which is
a legitimate first page rather than a missing value, and does not clamp: an
offset past the end is an empty page, not an error.

health goes through a closed whitelist so an arbitrary query string can never
reach the store's health branch as an unhandled value."
```

---

### Task 4: Client — paged table, search, filters, URL state

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/pages/Facilities.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/pages/Facilities.test.tsx`

**Interfaces:**
- Consumes: Task 3's `GET /api/facilities` → `{ rows, total, limit, offset }`.
- Produces: no exported API beyond the page itself.

**Context you need:**

`apps/studio/src/api.ts` currently has a `FACILITIES_LIST_LIMIT = 2000` constant with a long comment explaining the trade-off, and:

```ts
export const listFacilities = (): Promise<Facility[]> =>
  apiGet(`/api/facilities?limit=${FACILITIES_LIST_LIMIT}`, 'list facilities');
```

`apps/studio/src/pages/Facilities.tsx` holds `const [truncated, setTruncated] = useState(false)`, sets it via `setTruncated(data.length >= FACILITIES_LIST_LIMIT)` in `reload()`, resets it to `false` in the `catch`, and renders an amber banner using `t('facilities.truncated', { limit: FACILITIES_LIST_LIMIT })`.

**Delete all of that.** With an exact total the banner conveys nothing, and it was itself defective: inferred from `data.length >= 2000`, so exactly 2 000 real rows produced a false warning.

⛔ **Add NO buttons.** Search, filter selects and the pager are *inputs*, not actions. This app's standing convention puts every action in a `⋯` `DropdownMenu`, and the page already has one on its tab strip. Do not add a header or footer button; FAC-P1-20 is a separate, deferred, app-wide decision.

⛔ **Use shadcn/ui primitives, never a native `<select>`.** If a primitive you need does not exist, create it following the existing ones.

- [ ] **Step 1: Write the failing tests**

Add to `apps/studio/src/pages/Facilities.test.tsx`, following the file's existing mocking pattern for `listFacilities`:

```ts
  it('requests a page and shows the total, not a truncation warning', async () => {
    listFacilitiesMock.mockResolvedValue({ rows: makeRows(50), total: 13000, limit: 50, offset: 0 });
    render(<Facilities />);
    expect(await screen.findByText(/13000|13,000/)).toBeInTheDocument();
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it('puts search, filter and page state in the URL', async () => {
    listFacilitiesMock.mockResolvedValue({ rows: makeRows(50), total: 13000, limit: 50, offset: 0 });
    render(<Facilities />);
    await userEvent.type(await screen.findByRole('searchbox'), 'dodoma');
    await waitFor(() => expect(window.location.search).toContain('q=dodoma'));
  });

  it('restores search and page from the URL on mount', async () => {
    window.history.replaceState({}, '', '/facilities?q=dodoma&offset=100');
    listFacilitiesMock.mockResolvedValue({ rows: makeRows(50), total: 13000, limit: 50, offset: 100 });
    render(<Facilities />);
    await waitFor(() => expect(listFacilitiesMock).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'dodoma', offset: 100 }),
    ));
  });
```

⚠ `makeRows(n)` is a helper you write to produce `n` plausible `Facility` objects — check the real `Facility` type in `apps/studio/src/api.ts` and build from it rather than guessing fields.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx --testTimeout=30000
```

Expected: FAIL — `listFacilities` takes no arguments and returns an array.

- [ ] **Step 3: Rewrite the API client**

In `apps/studio/src/api.ts`, **delete `FACILITIES_LIST_LIMIT` and its comment block entirely**, and replace `listFacilities`:

```ts
export interface FacilityListQuery {
  q?: string;
  country?: string; zone?: string; region?: string; district?: string; council?: string;
  status?: string; level?: string; ownership?: string;
  nationalSystem?: string; source?: string; managedOrigin?: string;
  health?: 'mapped' | 'unmapped' | 'unprojected';
  limit?: number; offset?: number;
}
export interface FacilityPage { rows: Facility[]; total: number; limit: number | null; offset: number }

export const listFacilities = (query: FacilityListQuery = {}): Promise<FacilityPage> => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const qs = p.toString();
  return apiGet(`/api/facilities${qs ? `?${qs}` : ''}`, 'list facilities');
};
```

Add `health` and `mappingCount` to the `Facility` interface in the same file, matching Task 2's row shape.

- [ ] **Step 4: Rewrite the page**

In `apps/studio/src/pages/Facilities.tsx`:

1. Delete the `truncated` state, its `setTruncated` calls (both the success and `catch` paths), and the amber banner block.
2. Hold `query` state (`q`, filters, `offset`) initialised from `window.location.search`, and write it back with `history.replaceState` when it changes.
3. `reload()` calls `listFacilities(query)` and sets `rows` from `page.rows` and a new `total` state from `page.total`.
4. Render a search input (`role="searchbox"`), filter selects using the app's shadcn `Select` primitive, and a pager showing `total` with previous/next controls.
5. Page size constant: `const PAGE_SIZE = 50;` — with a comment saying why 50 and that virtualization is deliberately not used (the audit permits it only as a rendering optimization, and at 50 rows it earns nothing).

- [ ] **Step 5: Update i18n in all three locales**

Remove `truncated` from the `facilities` block of `apps/studio/src/i18n/en.ts` (line ~769), `fr.ts` (~765) and `pt.ts` (~765). Add keys for the search placeholder, each filter label, the health values, and the pager summary. **All three files must gain and lose exactly the same keys** — `apps/studio/src/i18n/parity.test.ts` enforces this.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx src/i18n --testTimeout=30000
pnpm --filter @openldr/studio exec vitest run --testTimeout=30000
```

Expected: PASS, including the i18n parity test.

- [ ] **Step 7: Mutation-prove the URL state**

Remove the `history.replaceState` write. Expected: *"puts search, filter and page state in the URL"* FAILS. Restore in place; record the message.

- [ ] **Step 8: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/pages/Facilities.tsx apps/studio/src/pages/Facilities.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(facilities): page the registry table with search, filters and URL state

Replaces the fetch-2000-and-render-them-all approach. The truncation banner is
deleted rather than fixed: with an exact total it conveys nothing, and it was
itself defective -- inferred from data.length >= 2000, so exactly 2000 real rows
produced a false warning.

Search, filters and page live in the URL so a filtered view is linkable and
survives reload. No virtualization: the audit permits it only as a rendering
optimization and at 50 rows a page it earns nothing.

No action controls added -- search, filters and the pager are inputs. Every
action in this app lives in a dots menu, and FAC-P1-20 is a separate deferred
decision."
```

---

### Task 5: Measure whether an index is needed

**Files:** none unless the measurement justifies one — this task produces a written report.

**Context you need:**

`facility_registry` carries only a PK on `id` and one btree on `council`. The spec commits to adding an index **only if a measurement calls for one**, rather than on principle. The store's search uses `ilike '%q%'`, which no btree can serve; the question is whether that matters at national scale.

The dev registry holds **1 row**, so you must seed. Reach the internal database with:

```bash
INT=$(grep -E "^INTERNAL_DATABASE_URL=" .env | cut -d= -f2-)
docker compose exec -T postgres psql "${INT/127.0.0.1:5433/localhost:5432}" -c "select 1"
```

- [ ] **Step 1: Seed 13 000 synthetic facilities into a throwaway schema**

Use `generate_series` so nothing depends on an external fixture, and put it in its own schema so the dev registry is untouched:

```sql
create schema if not exists scale_probe;
create table scale_probe.facility_registry (like public.facility_registry including all);
insert into scale_probe.facility_registry (id, name, local_code, national_system, national_code, level, status, region, district, council, source)
select 'f'||i, 'Facility '||i||' Regional Referral Hospital', 'LC-'||i, 'urn:mfl', 'NC-'||i,
       'dispensary', case when i % 3 = 0 then 'Closed' else 'Active' end,
       'Region '||(i % 30), 'District '||(i % 200), 'Council '||(i % 400), 'import'
from generate_series(1, 13000) i;
```

- [ ] **Step 2: Time the three query shapes**

Run each with `explain (analyze, buffers)` and record the actual execution time:

1. an unfiltered page: `... order by name limit 50 offset 0`
2. a deep page: `... order by name limit 50 offset 12000`
3. a search: `... where name ilike '%outreach%' or local_code ilike '%outreach%' ... order by name limit 50`
4. the count query behind `total`, filtered and unfiltered.

- [ ] **Step 3: Decide, and say why**

If every shape is comfortably fast (single- to low-double-digit milliseconds), **add no index** and record the measurements as the evidence. If one is slow, propose the specific index that fixes it, re-measure with it, and show both numbers.

⛔ **Do not add an index "because it seems sensible."** The spec's commitment is that an index appears only with a measurement attached. An unjustified index is a claim this repo would treat as an overclaim.

- [ ] **Step 4: Clean up**

```sql
drop schema scale_probe cascade;
```

Confirm `select count(*) from public.facility_registry` is back to its original value.

- [ ] **Step 5: Write the report and commit any justified index**

Record every command, its actual output, and the decision. If an index is justified, it needs a new **internal** migration (next number after the highest in `packages/db/src/migrations/internal/`) plus its own test.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 health states, fan-out trap, no correlated subquery | 2 |
| §2 offset pagination with exact total | 1 |
| §3 store options, `{rows,total}`, search fields, aliases unmet | 1, 2 |
| §4 HTTP params + response shape | 3 |
| §5 client: delete cap + banner, page size, URL state, no virtualization | 4 |
| Testing 1-2 paging arithmetic, exact filter-aware total | 1 |
| Testing 3 ⭐ fan-out guard | 2 |
| Testing 4 each health state, inactive/non-SAME-AS | 2 |
| Testing 5-6 search per field, long names | 1 |
| Testing 7 URL state | 4 |
| Known limit: no index pending measurement | 5 |
| Known limit: no live demo at 13k / aliases / offset drift | stated in spec, no task (deliberate) |
| Out of scope: A2, B, C, D, P1-19/20 | no task (deliberate) |

**Placeholder scan:** none. Three steps deliberately instruct the implementer to check reality over the snippet (the seeded-count arithmetic, `term_mappings`' NOT NULL columns, the `Facility` type) — those are verification instructions, not placeholders.

**Type consistency:** `FacilityListOptions` field names (`q`, `nationalSystem`, `managedOrigin`, `health`) are spelled identically in Tasks 1, 2, 3 and 4. `list()` returns `{ rows, total }` in Tasks 1, 2 and 3. The route returns `{ rows, total, limit, offset }` in Tasks 3 and 4. `health` is `'mapped' | 'unmapped' | 'unprojected'` everywhere; the row field is `mappingCount` in TypeScript and `mapping_count` in SQL, and Task 2 shows the mapping between them.

**One open decision handed to the implementer, deliberately:** Task 3 Step 4 asks what `limit` to echo when the client sends none. `rows.length` is wrong on a short last page; the plan names that trap and requires an explicit choice with a stated reason rather than pretending there is one obvious answer.
