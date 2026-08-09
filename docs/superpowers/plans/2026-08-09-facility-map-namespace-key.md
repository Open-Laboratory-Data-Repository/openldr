# `facility_map` keyed by the observed coding namespace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `facility_map` hold one row per raw observed wire tuple `(source_system, performer_system, source_code)` so a report join can distinguish two facilities that share a code under different coding namespaces, and so a second feed's reports stop silently missing the dimension.

**Architecture:** The resolver already folds on `(resolvedSystem, code)` where `resolvedSystem = performer_system ?? observedSystemForFeed(source_system)`. `observedSystemForFeed` is TypeScript with no SQL equivalent, so a report join can never compute that fold key — it can only match raw wire columns. The dimension's grain therefore moves to the raw tuple, which is a strict *refinement* of the fold (never coarser), making the `facility_map.id` collision impossible by construction rather than merely rarer. Migration 015 adds the column and relabels existing rows; a boot-time rebuild produces the actual fan-out.

**Tech Stack:** TypeScript, Kysely (Postgres / MSSQL / MySQL via `TargetEngine`), Vitest, pg-mem for in-memory Postgres, pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-08-09-facility-map-namespace-key-design.md`

## Global Constraints

- **Gate:** `pnpm turbo run typecheck test --force`. **NEVER pipe turbo through `tail`.** Whole-package vitest runs need `--testTimeout=30000`.
- **Commits:** never add a `Co-Authored-By` trailer. **Never `git add -A`** — the working directory is shared with concurrent sessions; always `git add` explicit paths.
- **Never revert an edit with `git checkout -- <file>`** — it reverts the whole file and has destroyed a task's work before. Use in-place reverse edits.
- **Never write a raw control character into a source file.** A NUL byte has made a file binary to git twice.
- **Mutation-prove every test:** break the behaviour it pins, watch it fail, restore in place. Record the observed failure message in the task report.
- **If you cannot verify a claim, do not write it.** The two predecessor branches were caught overclaiming in comments 6 and 13 times respectively. Treat any confident comment near changed code as suspect.
- **pg-mem lies.** It has hidden a bound parameter in a `CREATE INDEX` predicate that would have failed every real install; `numInsertedOrUpdatedRows` returns 1 after a skipped `onConflict().doNothing()`; insertion order is load-bearing; it does not roll back on a thrown error. External-migration tests are Postgres-only. If pg-mem cannot execute something, say so in the task report — do not weaken the SQL to suit it.
- **This defect is LATENT, not live.** 1 distinct `performer_system`, 1 feed, 88 dimension rows. No current report is wrong. Do not describe this work as fixing broken reports.
- Column name is exactly **`performer_system`**, matching `diagnostic_reports`. Absent namespace is stored and joined as **`''`**, never NULL.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/external/015_facility_map_performer_system.ts` | **Create** — add the column, backfill it | 1 |
| `packages/db/src/migrations/external/015_facility_map_performer_system.test.ts` | **Create** — migration tests | 1 |
| `packages/db/src/migrations/external/index.ts` | **Modify** — register 015 | 1 |
| `packages/db/src/schema/external.ts` | **Modify** — `FacilityMapTable` field + `EXTERNAL_TABLE_COLUMNS.facility_map` | 1 |
| `packages/db/src/export-data.test.ts` | **Modify** — the exhaustive column test | 1 |
| `packages/db/src/facility-observed.ts` | **Modify** — `facilityMapId` takes the namespace | 2 |
| `packages/db/src/facility-observed.test.ts` | **Modify** — id tests | 2 |
| `packages/bootstrap/src/facility-reconcile.ts` | **Modify** — `ResolvedFacility.observations`, fold, publish fan-out, throw-not-filter | 2 |
| `packages/bootstrap/src/facility-reconcile.test.ts` | **Modify** — fold + publish tests | 2 |
| `packages/reporting/src/seed/report-seeds.ts` | **Modify** — 9 SQL strings + 2 CTEs | 3 |
| `packages/reporting/src/seed/report-seeds.test.ts` | **Modify** — 4 pinned join tests | 3 |
| `packages/bootstrap/src/index.ts` | **Modify** — boot-time rebuild enqueue | 4 |
| `packages/bootstrap/src/facility-map-namespace.e2e.test.ts` | **Create** — both failure directions through the shipped SQL | 5 |

---

### Task 1: Migration 015 — the column and its backfill

**Files:**
- Create: `packages/db/src/migrations/external/015_facility_map_performer_system.ts`
- Create: `packages/db/src/migrations/external/015_facility_map_performer_system.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts` (`FacilityMapTable`, `EXTERNAL_TABLE_COLUMNS`)
- Modify: `packages/db/src/export-data.test.ts`

**Interfaces:**
- Consumes: `keyType(engine)` and `TargetEngine` from `packages/db/src/migrations/external/dialect.ts` and `../../engine`; `makeMigratedExternalDb()` from `packages/db/src/test-helpers-external.ts`.
- Produces: a `facility_map.performer_system` column, `NOT NULL DEFAULT ''`; `FacilityMapTable.performer_system: string`; `EXTERNAL_TABLE_COLUMNS.facility_map` containing `'performer_system'`. Task 2 writes this column; Task 3 joins on it.

**Context you need:**

`014_facility_location.ts` is the last external migration — verified. `facility_map` was created by `012_facility_map.ts`, whose header explains why `id` is synthetic (MSSQL clustered PK caps at 900 bytes and two `keyType` columns land on exactly that). **We are not touching the PK and not widening `facility_map_source_idx`.** Leaving the index at two columns is deliberate: three `keyType` columns would put MySQL at roughly 3066 of its 3072-byte utf8mb4 index limit, and that figure is arithmetic, not a measurement.

⛔ **MSSQL cannot `MIN()` an `nvarchar(max)` column**, and `performer_system` on `diagnostic_reports` is `textType` = `nvarchar(max)` there. MySQL's `CAST` spells the type `char(n)`, not `varchar(n)`. So the aggregate must be narrowed to a key-sized string first, per dialect. This is why the migration has a local `castKeyType` helper rather than one literal SQL string.

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/migrations/external/015_facility_map_performer_system.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedExternalDb } from '../../test-helpers-external';
import { backfillPerformerSystem } from './015_facility_map_performer_system';

// `makeMigratedExternalDb` has already run the whole external migration set, so the column exists
// and its backfill has already run over an EMPTY warehouse. Each test seeds the state it cares
// about and then re-runs the backfill alone — `up()` cannot be re-invoked wholesale because
// `addColumn` would fail. Calling the exported statement keeps the tested SQL and the shipped SQL
// as one copy.
describe('015_facility_map_performer_system', () => {
  it('backfills the namespace observed for a (feed, code) pair', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, performer, performer_system, source_system)
      values ('dr-1', 'BAMAA', 'urn:openldr:default_fac', 'webhook-ingest')`.execute(db);
    await sql`insert into facility_map (id, source_system, source_code)
      values ('webhook-ingest|BAMAA', 'webhook-ingest', 'BAMAA')`.execute(db);

    await backfillPerformerSystem(db as never, 'postgres');

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: 'urn:openldr:default_fac' }]);
  });

  it("leaves '' when no diagnostic_reports row matches the dimension row", async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into facility_map (id, source_system, source_code)
      values ('webhook-ingest|ORPHAN', 'webhook-ingest', 'ORPHAN')`.execute(db);

    await backfillPerformerSystem(db as never, 'postgres');

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: '' }]);
  });

  it('matches a NULL source_system dimension row stored as the empty string', async () => {
    const db = await makeMigratedExternalDb();
    await sql`insert into diagnostic_reports (id, performer, performer_system, source_system)
      values ('dr-2', 'NOFEED', 'urn:x:ns', null)`.execute(db);
    await sql`insert into facility_map (id, source_system, source_code)
      values ('|NOFEED', '', 'NOFEED')`.execute(db);

    await backfillPerformerSystem(db as never, 'postgres');

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: 'urn:x:ns' }]);
  });
});
```

⚠ This requires the migration to export the backfill as a named function, which the implementation in Step 3 does. That is deliberate: it is the only way to exercise the backfill against seeded state without re-running `addColumn`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/db vitest run src/migrations/external/015_facility_map_performer_system.test.ts
```

Expected: FAIL — cannot resolve `./015_facility_map_performer_system`.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/external/015_facility_map_performer_system.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// `facility_map`'s natural key omitted the observed coding namespace, so two facilities sharing a
// code under different namespaces collided on one synthetic `id` and publish dropped one; and two
// feeds sharing a namespace folded onto ONE feed's row, so the other feed's reports matched nothing.
// Both are closed by re-keying the dimension on the raw observed wire tuple
// (source_system, performer_system, source_code) — the only grain a report join can match on, since
// `observedSystemForFeed` is TypeScript with no SQL equivalent.
//
// ⛔ NOT NULL DEFAULT '': `performer_system` is nullable on `diagnostic_reports`, and `NULL = NULL`
// is false in SQL. The whole dimension already spells an absent feed as '' for exactly this reason
// (see every `coalesce(dr.source_system, '')` in the seeded report joins); the namespace follows the
// same convention rather than inventing a second one.
//
// ⛔ The index is deliberately NOT widened. `facility_map_source_idx` stays (source_system,
// source_code): the pair already narrows to about one row, and a third `keyType` column would put
// MySQL at roughly 3066 of its 3072-byte utf8mb4 index limit — a bound established by arithmetic,
// not measurement. The synthetic PK is untouched, so 012's 900-byte clustered-key reasoning still
// holds unchanged.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('facility_map')
    .addColumn('performer_system', sql.raw(keyType(engine)), (c) => c.notNull().defaultTo(''))
    .execute();
  await backfillPerformerSystem(db, engine);
}

/**
 * Relabel every existing dimension row with the namespace its reports actually carry.
 *
 * ⛔ This CANNOT split a row. `facility_map.id` is `facilityMapId`, a djb2 hash above
 * MAX_ID_LENGTH — a TypeScript function with no SQL equivalent — so a migration cannot mint ids for
 * rows it would create. Where one (feed, code) genuinely spans two namespaces this takes the
 * alphabetically first non-null one and the other namespace's row simply does not exist yet; the
 * rebuild enqueued at boot creates it. Impossible on measured data today (1 distinct namespace).
 *
 * ⛔ Without this backfill the fix would ship a REGRESSION, not a repair: every live report row
 * carries a populated `performer_system`, so leaving the dimension on the '' default would make the
 * new join predicate fail for every dimension row and drop every resolved facility name back to the
 * raw code, immediately on upgrade.
 *
 * Exported so the tests exercise the shipped statement rather than a transcription of it.
 */
export async function backfillPerformerSystem(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  // ⛔ The cast is not decoration. `diagnostic_reports.performer_system` is `textType`, i.e.
  // `nvarchar(max)` on MSSQL — and SQL Server REFUSES `MIN()` over `nvarchar(max)`. MySQL's CAST
  // spells the target `char(n)`, not `varchar(n)`. Namespace urls are far shorter than either bound.
  const narrowed = sql.raw(castKeyType(engine));
  await sql`
    update facility_map
       set performer_system = coalesce((
             select min(cast(dr.performer_system as ${narrowed}))
               from diagnostic_reports dr
              where coalesce(dr.source_system, '') = facility_map.source_system
                and dr.performer = facility_map.source_code
           ), '')
  `.execute(db);
}

/** `keyType` narrowed for use inside CAST. Kept separate because MySQL's CAST accepts `char(n)`
 *  where its DDL accepts `varchar(n)` — the two are not interchangeable. */
function castKeyType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'varchar(450)';
  if (engine === 'mysql') return 'char(255)';
  return 'text';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facility_map').dropColumn('performer_system').execute();
}
```

- [ ] **Step 4: Register the migration**

In `packages/db/src/migrations/external/index.ts`, add the import beside the others:

```ts
import * as m015 from './015_facility_map_performer_system';
```

and the entry as the last line of the returned record, after `'014_facility_location'`:

```ts
    '015_facility_map_performer_system': { up: (db) => m015.up(db, engine), down: m015.down },
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @openldr/db vitest run src/migrations/external/015_facility_map_performer_system.test.ts
```

Expected: PASS, 3 tests.

⚠ If pg-mem rejects the correlated `UPDATE` or the `cast(... as text)`, **do not rewrite the SQL to suit pg-mem.** Report exactly what it rejected, mark those assertions as Postgres-only, and carry them into Task 6's live verification instead. pg-mem's agreement is not evidence about MSSQL or MySQL either way.

- [ ] **Step 6: Add the column to the schema type and the governance list**

In `packages/db/src/schema/external.ts`, inside `interface FacilityMapTable`, immediately after `source_code`:

```ts
  /** `diagnostic_reports.performer_system` — the namespace the observed code was published under,
   *  the third part of this dimension's natural key. '' (never NULL) when the wire supplied none,
   *  matching how `source_system` already spells an absent feed: the report join compares it with
   *  `coalesce(dr.performer_system, '')`, and `NULL = NULL` is false. */
  performer_system: string;
```

In the same file, replace the `facility_map` entry of `EXTERNAL_TABLE_COLUMNS` so `performer_system` follows `source_code`:

```ts
  facility_map: ['id', 'source_system', 'performer_system', 'source_code', 'registry_id', 'local_code', 'name', 'level', 'status', 'region', 'district', 'council', 'national_system', 'national_code', 'resolved_via', 'updated_at'],
```

- [ ] **Step 7: Extend the exhaustive governance test**

`packages/db/src/export-data.test.ts` currently only asserts the table-name set and the id/provenance columns, so it would pass without noticing the new column. Add a third test inside the same `describe`:

```ts
  it('carries all three parts of facility_map\'s natural key', () => {
    // The dimension is keyed on the raw observed wire tuple (feed, namespace, code). Dropping any
    // part from this list would hide it from the Data Exposure policy and any consumer that reads
    // the column set rather than the table.
    for (const col of ['source_system', 'performer_system', 'source_code']) {
      expect(EXTERNAL_TABLE_COLUMNS.facility_map).toContain(col);
    }
  });
```

- [ ] **Step 8: Run the db package tests**

```bash
pnpm --filter @openldr/db vitest run --testTimeout=30000
```

Expected: PASS. Any failure here is a real consumer of `FacilityMapTable` that now needs the field — follow the compiler, do not cast around it.

- [ ] **Step 9: Mutation-prove the backfill**

Change `coalesce(dr.source_system, '') = facility_map.source_system` to `dr.source_system = facility_map.source_system` and re-run. Expected: the third test ("matches a NULL source_system dimension row") FAILS with `performer_system: ''` instead of `'urn:x:ns'` — this is the `NULL = NULL` bug the guard exists to prevent. **Restore with an in-place reverse edit, never `git checkout`.** Record the observed message in the task report.

- [ ] **Step 10: Commit**

```bash
git add packages/db/src/migrations/external/015_facility_map_performer_system.ts packages/db/src/migrations/external/015_facility_map_performer_system.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts packages/db/src/export-data.test.ts
git commit -m "feat(facilities): add facility_map.performer_system and backfill it

The dimension's natural key omitted the observed coding namespace. This adds
the third key column, NOT NULL DEFAULT '' so it follows the same absent-value
convention source_system already uses, and relabels existing rows from the
namespace their reports actually carry.

Without the backfill the fix would ship a regression: every live report row has
a populated performer_system, so a '' default would break the new join for every
dimension row and drop every resolved name back to the raw code on upgrade.

The backfill cannot split a row -- facility_map.id is a djb2 hash with no SQL
equivalent -- so the fan-out comes from the rebuild, not from here.

MSSQL refuses MIN() over nvarchar(max) and MySQL's CAST spells the type char(n),
hence the per-dialect narrowing cast."
```

---

### Task 2: The namespace reaches the id, the fold, and the published rows

**Files:**
- Modify: `packages/db/src/facility-observed.ts` (`facilityMapId`)
- Modify: `packages/db/src/facility-observed.test.ts`
- Modify: `packages/bootstrap/src/facility-reconcile.ts` (`ResolvedFacility`, the fold in `resolveObservedFacilities`, `publishFacilityMap`)
- Modify: `packages/bootstrap/src/facility-reconcile.test.ts`

**Interfaces:**
- Consumes: Task 1's `facility_map.performer_system` column and `FacilityMapTable.performer_system: string`.
- Produces:
  - `facilityMapId(sourceSystem: string, performerSystem: string, sourceCode: string): string`
  - `ResolvedFacility.observations: { sourceSystem: string; performerSystem: string }[]`
  - `publishFacilityMap` writes one `facility_map` row per entry of `observations` and **throws** on a duplicate id.

**Why this is one task and not three:** splitting the id signature from its only caller produces an intermediate commit that either does not compile or passes a placeholder value. A reviewer would accept or reject "publish writes the new grain" as a single claim.

**Context you need:**

`resolveObservedFacilities` (`packages/bootstrap/src/facility-reconcile.ts`) queries `diagnostic_reports` grouped by all four of `(performer, performer_display, performer_system, source_system)`, then folds those raw groups down to one entry per `(resolvedSystem, code)` in a `Map` called `folded`, whose value type is the local `interface FoldedGroup`. It returns `foldedRows.map((r) => { ... })`. `publishFacilityMap` builds `allRows` from the resolved rows and then filters duplicates through a `seenIds` `Set`.

The key insight to preserve in comments: `resolvedSystem` is a **pure function of `(performer_system, source_system)`**, so a raw tuple maps to exactly one fold key. Therefore two distinct `ResolvedFacility` values cannot share a raw tuple, and the ids are unique by construction.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/facility-observed.test.ts`, replace the existing `it('derives a deterministic, bounded facility_map id', ...)` (currently at ~line 218) with:

```ts
  it('derives a deterministic, bounded facility_map id from all three key parts', () => {
    expect(facilityMapId('webhook-ingest', 'urn:x:ns', 'Dodoma')).toBe('webhook-ingest|urn:x:ns|Dodoma');
    expect(facilityMapId('webhook-ingest', '', 'Dodoma')).toBe('webhook-ingest||Dodoma');
    expect(facilityMapId('webhook-ingest', 'urn:x:ns', 'Dodoma'))
      .toBe(facilityMapId('webhook-ingest', 'urn:x:ns', 'Dodoma'));
    const long = facilityMapId('webhook-ingest', 'urn:x:ns', 'x'.repeat(400));
    expect(long.length).toBeLessThanOrEqual(200);
  });

  it('gives two namespaces sharing a feed and code two DIFFERENT ids', () => {
    // The whole point of FAC-P0-07: these two collided on one id, and publish dropped one.
    expect(facilityMapId('webhook-ingest', 'urn:a', 'NHL-01'))
      .not.toBe(facilityMapId('webhook-ingest', 'urn:b', 'NHL-01'));
  });
```

In `packages/bootstrap/src/facility-reconcile.test.ts`, add a new `describe` block at the end of the file:

```ts
describe('facility_map is keyed on the raw observed wire tuple (FAC-P0-07)', () => {
  it('emits one row per namespace when one feed sends a code under two namespaces', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['NHL-01', 2]], { sourceSystem: 'feed-a', performerSystem: 'urn:a' });
    await seedPerformers(deps, [['NHL-01', 3]], { sourceSystem: 'feed-a', performerSystem: 'urn:b' });

    await publishFacilityMap(deps, { apply: true });

    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['source_system', 'performer_system', 'source_code'])
      .orderBy('performer_system').execute();
    expect(rows).toEqual([
      { source_system: 'feed-a', performer_system: 'urn:a', source_code: 'NHL-01' },
      { source_system: 'feed-a', performer_system: 'urn:b', source_code: 'NHL-01' },
    ]);
  });

  it('emits one row per FEED when two feeds share a namespace and a code', async () => {
    // The second failure direction, absent from the audit: these fold into ONE ResolvedFacility
    // whose sourceSystem is only the tiebreak winner, so feed-b used to get no dimension row at all
    // and its reports silently fell back to the raw performer string.
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['NHL-01', 2]], { sourceSystem: 'feed-a', performerSystem: 'urn:shared' });
    await seedPerformers(deps, [['NHL-01', 3]], { sourceSystem: 'feed-b', performerSystem: 'urn:shared' });

    await publishFacilityMap(deps, { apply: true });

    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['source_system', 'performer_system', 'source_code'])
      .orderBy('source_system').execute();
    expect(rows).toEqual([
      { source_system: 'feed-a', performer_system: 'urn:shared', source_code: 'NHL-01' },
      { source_system: 'feed-b', performer_system: 'urn:shared', source_code: 'NHL-01' },
    ]);
  });

  it("stores '' for a report whose wire supplied no namespace", async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'webhook-ingest', performerSystem: null });

    await publishFacilityMap(deps, { apply: true });

    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['performer_system']).execute();
    expect(rows).toEqual([{ performer_system: '' }]);
  });

  it('does not duplicate an observation when only performer_display differs', async () => {
    // The source query groups by performer_display too, so one wire tuple can arrive as two raw
    // groups. `observations` must dedupe them or publish emits two identical-id rows.
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-a', performerSystem: 'urn:a', performerDisplay: 'Alpha' });
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-a', performerSystem: 'urn:a', performerDisplay: 'Alpha Clinic' });

    await publishFacilityMap(deps, { apply: true });

    const rows = await deps.externalDb.selectFrom('facility_map').select(['id']).execute();
    expect(rows).toHaveLength(1);
  });
});
```

Check the top of `facility-reconcile.test.ts` for the existing import list and add `publishFacilityMap` / `seedPerformers` / `makeReconcileDeps` only if they are not already imported — they are used elsewhere in the file, so most likely they are.

- [ ] **Step 2: Run both to verify they fail**

```bash
pnpm --filter @openldr/db vitest run src/facility-observed.test.ts
pnpm --filter @openldr/bootstrap vitest run src/facility-reconcile.test.ts --testTimeout=30000
```

Expected: the `@openldr/db` run FAILS on arity (`'urn:x:ns'` treated as the code); the bootstrap run FAILS with the two-namespace and two-feed cases returning a single row.

- [ ] **Step 3: Widen `facilityMapId`**

In `packages/db/src/facility-observed.ts`, replace the function and its doc comment:

```ts
/**
 * Deterministic id for a `facility_map` row. Deterministic because a re-publish recomputes it —
 * a non-deterministic id would duplicate every row on rebuild instead of replacing it.
 *
 * ⛔ All THREE parts of the dimension's natural key, namespace included. Keyed on
 * `(sourceSystem, sourceCode)` alone, two facilities sharing a code under different coding systems
 * collided here and `publishFacilityMap` silently dropped one (audit FAC-P0-07).
 *
 * Readable while it fits, hashed when it does not, mirroring `terminology_codes`' synthetic key.
 */
export function facilityMapId(sourceSystem: string, performerSystem: string, sourceCode: string): string {
  const readable = `${sourceSystem}|${performerSystem}|${sourceCode}`;
  if (readable.length <= MAX_ID_LENGTH) return readable;
  return `fm-${djb2Hex(readable)}`;
}
```

- [ ] **Step 4: Carry the raw tuples through the fold**

In `packages/bootstrap/src/facility-reconcile.ts`, add to `interface ResolvedFacility`, immediately after the `sourceDisplay` field:

```ts
  /** Every raw wire tuple — `(source_system, performer_system)` — that folded into this resolved
   *  facility, deduped. `publishFacilityMap` emits one `facility_map` row per entry, all carrying
   *  this row's resolution.
   *
   *  ⛔ This exists because the fold key is `(resolvedSystem, code)` while the report join can only
   *  match RAW wire columns — `observedSystemForFeed` is TypeScript with no SQL equivalent. Two
   *  feeds sharing a wire namespace fold into ONE row here whose `sourceSystem` is merely the
   *  display tiebreak winner, so publishing that single feed left the other feed's reports matching
   *  nothing at all.
   *
   *  ⛔ Accumulated during the fold, never re-queried in `publishFacilityMap`. A consumer that
   *  re-derives its own grouping is exactly what let a route's join key drift out of sync with this
   *  function's fold key and drop a feed's contribution (Task 11, whole-branch review round 2). */
  observations: { sourceSystem: string; performerSystem: string }[];
```

In the local `interface FoldedGroup` inside `resolveObservedFacilities`, add a final field:

```ts
    /** Deduped raw wire tuples, keyed `${sourceSystem}\n${performerSystem}`. A Map, not an array:
     *  the source query groups by `performer_display` too, so ONE wire tuple can arrive as several
     *  raw groups and an array would emit duplicate `facility_map` ids for it. */
    observations: Map<string, { sourceSystem: string; performerSystem: string }>;
```

In the fold loop, after `const candidate: Omit<FoldedGroup, 'reportCount'> = {...}` is built, the `candidate` object literal must also gain the field. Change the `candidate` declaration and the two `folded.set` calls to:

```ts
    const performerSystem = o.performer_system ?? '';
    const observationKey = `${o.source_system ?? ''}\n${performerSystem}`;
    const candidate: Omit<FoldedGroup, 'reportCount' | 'observations'> = {
      system,
      code,
      sourceSystem: o.source_system ?? '',
      sourceDisplay: o.performer_display ?? null,
      n,
    };
    const current = folded.get(key);
    if (!current) {
      folded.set(key, {
        ...candidate,
        reportCount: n,
        observations: new Map([[observationKey, { sourceSystem: candidate.sourceSystem, performerSystem }]]),
      });
      continue;
    }
```

and, at the end of the loop body, replace the final `folded.set(...)` with:

```ts
    const reportCount = current.reportCount + n; // summed regardless of which side wins the display
    // ⛔ Accumulate onto the INCUMBENT map whichever side wins the display tiebreak. `candidate` has
    // seen exactly one tuple; taking its map on a `replace` would discard every tuple folded in
    // before it, which is the same silent-feed-loss this field exists to prevent.
    const observations = current.observations;
    observations.set(observationKey, { sourceSystem: candidate.sourceSystem, performerSystem });
    folded.set(key, replace
      ? { ...candidate, reportCount, observations }
      : { ...current, reportCount, observations });
```

Finally, in the returned object literal of `foldedRows.map((r) => { ... return { ... } })`, add:

```ts
      observations: [...r.observations.values()],
```

Place it next to `sourceDisplay` so the literal's order matches the interface. Follow the compiler for the exact surrounding property names.

- [ ] **Step 5: Fan out the publish and replace the silent filter with a throw**

In `publishFacilityMap`, replace the `allRows` construction and the whole `seenIds` block (currently `packages/bootstrap/src/facility-reconcile.ts:781-816` — verify the range before editing, it moves) with:

```ts
  // One row per RAW observed wire tuple, not per resolved facility. The report join can only match
  // raw wire columns (`observedSystemForFeed` is TypeScript, unrepresentable in SQL), so this is the
  // grain the dimension has to hold. Each of a facility's tuples carries the SAME resolution.
  const allRows = resolved.flatMap((r) => r.observations.map((o) => ({
    id: facilityMapId(o.sourceSystem, o.performerSystem, r.sourceCode),
    source_system: o.sourceSystem,
    performer_system: o.performerSystem,
    source_code: r.sourceCode,
    registry_id: r.registryId,
    local_code: r.localCode,
    name: r.name,
    level: r.level,
    status: r.status,
    region: r.region,
    district: r.district,
    council: r.council,
    national_system: r.nationalSystem,
    national_code: r.nationalCode,
    resolved_via: r.resolvedVia,
  })));

  // ⛔ A THROW, not a filter. The previous `seenIds` dedupe silently discarded a legitimately
  // distinct facility — the audit's FAC-P0-07 — and "never resolve a collision by first-row-wins
  // deduplication" is its stated requirement.
  //
  // Duplicates are now impossible by construction, and that is a property worth asserting rather
  // than trusting: `resolvedObservedSystem` is a PURE FUNCTION of (performer_system, source_system),
  // so a raw tuple maps to exactly one fold key. Two `ResolvedFacility` values therefore cannot
  // share a tuple, and `observations` is deduped within one. If that ever stops being true, the
  // publish must fail loudly rather than lose a facility from every official report.
  const seenIds = new Set<string>();
  for (const r of allRows) {
    if (seenIds.has(r.id)) {
      throw new Error(`facility_map id collision on ${JSON.stringify(r.id)} — two observed facilities resolved to one dimension row`);
    }
    seenIds.add(r.id);
  }
  const rows = allRows;
```

⚠ The insert below chunks at 140 because "each row binds 14 values (150 * 14 = 2100 would exceed MSSQL's ~2000 parameter budget)". The row now binds **15** values. Update the chunk size and its comment:

```ts
    // Chunked: MSSQL's parameter budget is ~2000 and each row binds 15 values (140 * 15 = 2100
    // would exceed it, hence 130 not 140).
    const chunk = 130;
```

- [ ] **Step 6: Run both test files to verify they pass**

```bash
pnpm --filter @openldr/db vitest run src/facility-observed.test.ts
pnpm --filter @openldr/bootstrap vitest run src/facility-reconcile.test.ts --testTimeout=30000
```

Expected: PASS. Other tests in `facility-reconcile.test.ts` that assert on `facility_map` contents may now need a `performer_system` field in their expected objects — update them; a test that asserted the old grain was asserting the defect.

- [ ] **Step 7: Follow the compiler across the workspace**

```bash
pnpm turbo run typecheck --force
```

Every other `facilityMapId` call site and every consumer of `ResolvedFacility` must be updated. **Do not add `as never` or optional-mark `observations` to silence this** — a consumer that constructs a `ResolvedFacility` without observations is a consumer that will publish nothing for that facility. Fix each properly and list them in the task report.

- [ ] **Step 8: Mutation-prove the fan-out and the throw**

Three mutations, each restored in place afterwards:

1. Change `resolved.flatMap((r) => r.observations.map(...))` back to `resolved.map((r) => ({ ... o.sourceSystem → r.sourceSystem ... }))`. Expected: the two-feed test FAILS with one row instead of two.
2. Change the `observations` Map key from `` `${o.source_system ?? ''}\n${performerSystem}` `` to `` `${performerSystem}` ``. Expected: the two-feed test FAILS (both feeds collapse to one observation).
3. Restore the `throw` to a `filter` and force a duplicate by hardcoding `id: 'dup'`. Expected: no error and a row silently missing — demonstrating what the throw now prevents.

Record each observed failure message in the task report.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/facility-observed.ts packages/db/src/facility-observed.test.ts packages/bootstrap/src/facility-reconcile.ts packages/bootstrap/src/facility-reconcile.test.ts
git commit -m "feat(facilities): publish one facility_map row per raw observed wire tuple

facilityMapId now takes all three parts of the dimension's natural key, and
ResolvedFacility carries every (source_system, performer_system) tuple that
folded into it so publish can fan out over them.

This closes both directions of FAC-P0-07. One feed sending a code under two
namespaces used to collide on one id and lose a facility to a silent dedupe.
Two feeds sharing a namespace used to fold onto the tiebreak winner's feed
alone, so the other feed's reports matched no dimension row at all and fell
back to the raw code -- a direction the audit does not name.

The dedupe is now a throw. Duplicates are impossible by construction, because
the resolved system is a pure function of (performer_system, source_system), so
a raw tuple maps to exactly one fold key; the assertion is there so a future
change fails loudly instead of dropping a facility from official reports.

Insert chunk drops 140 -> 130: the row binds 15 values now, not 14."
```

---

### Task 3: The report join matches the namespace

**Files:**
- Modify: `packages/reporting/src/seed/report-seeds.ts` (9 SQL strings across 3 queries, plus 2 CTE definitions × 3 dialects)
- Modify: `packages/reporting/src/seed/report-seeds.test.ts` (4 pinned tests)

**Interfaces:**
- Consumes: Task 1's `facility_map.performer_system` column, Task 2's populated rows.
- Produces: seeded SQL whose `facility_map` join predicate includes the namespace. Task 5's e2e test executes these strings verbatim.

**Context you need:**

Three query families join `facility_map`, each with `postgres` / `mssql` / `mysql` variants:

| Query id | Approx. line of the postgres variant | Joins via |
|---|---|---|
| `q-facilities` | 223 | `diagnostic_reports dr` directly |
| `q-amr-facility-summary` | 804 | a `facility_of` CTE aliased `f` |
| `q-clinical-micro-header` | 1859 | a `facility_of` CTE aliased `fo` |

Line numbers move — locate by `left join facility_map fm`. There are exactly 9 such lines; `grep -c "left join facility_map" packages/reporting/src/seed/report-seeds.ts` must return 9 before and after.

`SEED_QUERIES` uses managed-overwrite (`seedDataDrivenReports` refreshes a built-in whose stored SQL differs from the shipped one), so this reaches existing installs on `db seed` — no stale-seed migration.

- [ ] **Step 1: Write the failing tests**

In `packages/reporting/src/seed/report-seeds.test.ts`, extend the existing `q-facilities` test at ~line 451 to also require the namespace:

```ts
  it('resolves through facility_map with the same NULL source_system guard as the clinical header', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.source_system\s*=\s*coalesce\(dr\.source_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/fm\.source_code\s*=\s*dr\.performer\b/);
    }
  });

  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    // The dimension is keyed on (feed, namespace, code). Joining on feed+code alone lets one
    // namespace's curated name answer for a different namespace's identical code.
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(dr\.performer_system, ''\)/);
    }
  });
```

Then find the `q-clinical-micro-header` test at ~line 937 (`guards the facility_map join against a NULL source_system`) and add a sibling immediately after it. Use the correct alias — that query's CTE is aliased `fo`:

```ts
  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(fo\.performer_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/min\(performer_system\) as performer_system/);
    }
  });
```

Locate the `q-amr-facility-summary` describe block (its CTE is aliased `f`) and add:

```ts
  it('matches the observed coding namespace too, not the feed alone (FAC-P0-07)', () => {
    for (const [dialect, sql] of Object.entries(q().sql)) {
      expect(sql, `${dialect}`).toMatch(/fm\.performer_system\s*=\s*coalesce\(f\.performer_system, ''\)/);
      expect(sql, `${dialect}`).toMatch(/min\(performer_system\) as performer_system/);
    }
  });
```

⚠ Each `describe` block has its own local `q()` helper bound to that query id. Read the block you are adding to and use its own helper rather than assuming the name.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @openldr/reporting vitest run src/seed/report-seeds.test.ts
```

Expected: FAIL — 3 new tests, 9 dialect assertions, none matching.

- [ ] **Step 3: Update `q-facilities` (3 strings)**

In each of the three variants, change the join line from:

```
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.source_code = dr.performer
```

to:

```
left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.performer_system = coalesce(dr.performer_system, '') and fm.source_code = dr.performer
```

Update the comment above the query (~line 204) where it describes the join, so the prose matches the SQL.

- [ ] **Step 4: Update `q-amr-facility-summary` (3 strings + 3 CTEs)**

In each variant's `facility_of` CTE, add the namespace to the select list:

```
with facility_of as (
  select specimen_id, min(performer) as performer, min(performer_display) as performer_display,
    min(source_system) as source_system, min(performer_system) as performer_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
)
```

and change the join to:

```
left join facility_map fm on fm.source_system = coalesce(f.source_system, '') and fm.performer_system = coalesce(f.performer_system, '') and fm.source_code = f.performer
```

- [ ] **Step 5: Update `q-clinical-micro-header` (3 strings + 3 CTEs)**

Same change, alias `fo`. The CTE there is formatted one column per line:

```
with facility_of as (
  select specimen_id,
    min(performer) as performer,
    min(performer_display) as performer_display,
    min(source_system) as source_system,
    min(performer_system) as performer_system
  from diagnostic_reports
  where specimen_id is not null and specimen_id <> '' and performer is not null
  group by specimen_id
),
```

and the join:

```
  left join facility_map fm on fm.source_system = coalesce(fo.source_system, '') and fm.performer_system = coalesce(fo.performer_system, '') and fm.source_code = fo.performer
```

Then add to the block comment above the query, beside its existing `coalesce(fo.source_system, '')` note:

```
  //  - ⛔ `performer_system` is the THIRD part of facility_map's key, not decoration. The dimension
  //    holds one row per (feed, namespace, code); joining on feed+code alone would let one
  //    namespace's curated name answer for another namespace's identical code (audit FAC-P0-07).
  //  - ⚠ `min(performer_system)` is folded INDEPENDENTLY of `min(performer)`, so on a specimen whose
  //    reports disagree it can pair one row's code with another row's namespace. That hazard is
  //    pre-existing — `performer`, `performer_display` and `source_system` are already folded the
  //    same way — and is inherited here, not introduced. Not fixed in this change.
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm --filter @openldr/reporting vitest run src/seed/report-seeds.test.ts --testTimeout=30000
grep -c "left join facility_map" packages/reporting/src/seed/report-seeds.ts
```

Expected: PASS, and the grep prints `9`. Other tests in the file may assert byte-identical dialect variants — if one fails, it is telling you a variant was missed.

- [ ] **Step 7: Mutation-prove one join**

Remove the namespace clause from the `q-facilities` **mssql** variant only. Expected: `matches the observed coding namespace too` FAILS naming `mssql` and passes for `postgres`/`mysql` — proving the test iterates dialects rather than checking one. Restore in place.

- [ ] **Step 8: Commit**

```bash
git add packages/reporting/src/seed/report-seeds.ts packages/reporting/src/seed/report-seeds.test.ts
git commit -m "feat(reports): join facility_map on the observed namespace as well as the feed

All nine facility_map joins -- q-facilities, q-amr-facility-summary and
q-clinical-micro-header across three dialects each -- now match the third part
of the dimension's natural key, and the two facility_of CTEs carry
performer_system through.

coalesce(..., '') on the report side mirrors the guard already there for
source_system: the dimension stores '' for an absent namespace and NULL = NULL
is false.

Managed-overwrite in seedDataDrivenReports carries this to existing installs on
db seed, so no stale-seed migration is needed.

The facility_of CTE folds each column with an independent min(), so it can pair
one row's code with another row's namespace. That hazard is pre-existing and is
now named in the query's comment rather than silently inherited."
```

---

### Task 4: A rebuild is enqueued on every boot

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (immediately after `facilityJobs` is created, ~line 875)

**Interfaces:**
- Consumes: `facilityJobs: FacilityJobStore` (`createFacilityJobStore(internal.db)`), `logger`.
- Produces: nothing importable — a boot side effect.

**Context you need:**

⛔ **This does NOT go in `seedEssentials`.** An earlier draft of the spec said it did and was wrong. `EssentialSeedTarget` is a forms/workflows surface with **no db handle**, and `packages/bootstrap/src/index.ts` already carries a comment (above the `seedColumnExposurePolicy` call, ~line 536) stating that this exact class of boot-time seed is deliberately *not* routed through `seedEssentials`/`seedDatabase`, which are gated behind `SEED_ON_START` for optional demo data. `seedColumnExposurePolicy` is the precedent to mirror: unconditional, best-effort, `.catch()` that logs and never aborts boot.

Why it is needed: nothing else enqueues on upgrade — every existing `facility-map-rebuild` enqueue is a facility or mapping *mutation* (HTTP routes, CLI import, `facility-import.ts`). Migration 015 relabels rows but cannot split them. It also keeps the health chip honest: `facilityHealth`'s `stale` is defined purely as *last successful rebuild older than the last `facility_registry`/`term_mappings` mutation*, and a schema change touches neither table — so without this an upgraded install would read **Current** over a dimension of obsolete grain. A pending rebuild makes it read **Updating**.

- [ ] **Step 1: Write the failing test**

There is no existing unit test around `bootstrap()`'s boot sequence, and standing the whole context up for one enqueue would be a worse test than none. Pin the behaviour where it is cheap and real instead — add to `packages/bootstrap/src/facility-job-store.test.ts` if it exists, otherwise create `packages/bootstrap/src/boot-rebuild-enqueue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFacilityJobStore } from '@openldr/db';
import { makeReconcileDeps } from './test-support/facility-reconcile-fixture';

describe('boot-time facility-map rebuild enqueue', () => {
  it('a boot enqueue lands one queued rebuild, and a second boot absorbs into it', async () => {
    // Pins the property the boot call relies on: enqueueing unconditionally on every boot cannot
    // pile up work, because a rebuild that is still QUEUED absorbs the next request.
    const deps = await makeReconcileDeps();
    const jobs = createFacilityJobStore(deps.internalDb);

    const first = await jobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'boot' });
    const second = await jobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'boot' });

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    const unresolved = await jobs.listUnresolved();
    expect(unresolved.filter((j) => j.kind === 'facility-map-rebuild')).toHaveLength(1);
  });
});
```

⚠ Check `FacilityJobStore.enqueue`'s actual return shape in `packages/db/src/facility-job-store.ts` before writing the assertions — it returns `{ job, coalesced }`. Follow the real type.

- [ ] **Step 2: Run to verify it passes or fails honestly**

```bash
pnpm --filter @openldr/bootstrap vitest run src/boot-rebuild-enqueue.test.ts --testTimeout=30000
```

This one is expected to **PASS immediately** — it pins existing store behaviour that the boot call depends on, not new behaviour. Say so plainly in the task report rather than pretending it was red first. Its value is that it fails if coalescing is ever removed, which would turn the boot enqueue into a per-boot pile-up.

- [ ] **Step 3: Add the boot enqueue**

In `packages/bootstrap/src/index.ts`, immediately after the `createFacilityJobWorker({...})` block that ends at ~line 883 and before `const connectorStore = ...`:

```ts
  // FAC-P0-07: `facility_map` is keyed on the raw observed wire tuple
  // (source_system, performer_system, source_code) as of migration 015. That migration relabels the
  // rows it finds but CANNOT create the ones a namespace split needs — `facility_map.id` is a djb2
  // hash with no SQL equivalent — so the fan-out has to come from a real rebuild.
  //
  // Unconditional and best-effort on every boot, mirroring `seedColumnExposurePolicy` above rather
  // than `seedEssentials`, which is a forms/workflows surface with no db handle and is gated behind
  // SEED_ON_START. Costs at most one job per boot: a rebuild that is still queued absorbs this one.
  //
  // It also keeps the Facilities chip honest across an upgrade. `facilityHealth` derives `stale`
  // from `facility_registry`/`term_mappings` mutation times, and a schema change touches neither —
  // so without this an upgraded install would read "Current" over a dimension of obsolete grain.
  // A pending rebuild makes it read "Updating", which is true.
  await facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'boot' }).catch((err) => {
    logger.warn({ err }, 'boot facility-map-rebuild enqueue failed');
  });
```

⚠ Confirm `logger` is in scope at that point (it is used by `createFacilityJobWorker` two lines above) and that the surrounding function is `async`. Follow the compiler.

- [ ] **Step 4: Verify the package still builds and tests**

```bash
pnpm --filter @openldr/bootstrap vitest run --testTimeout=30000
pnpm turbo run typecheck --force
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/boot-rebuild-enqueue.test.ts
git commit -m "feat(facilities): enqueue a facility-map rebuild on every boot

Migration 015 can relabel existing dimension rows but cannot create the ones a
namespace split needs, because facility_map.id is a djb2 hash with no SQL
equivalent. Nothing else enqueues on upgrade -- every existing enqueue is a
facility or mapping mutation -- so an upgraded install would sit on the old
grain until someone happened to edit a facility.

Placed beside seedColumnExposurePolicy, not in seedEssentials: that is a
forms/workflows surface with no db handle, gated behind SEED_ON_START, and
index.ts already documents why this class of boot seed does not go there.

Also stops the Facilities chip reading Current over an obsolete dimension after
an upgrade: facilityHealth derives stale from registry/mapping mutation times
and a schema change touches neither, but a pending rebuild reads Updating."
```

---

### Task 5: Both failure directions, end to end through the shipped SQL

**Files:**
- Create: `packages/bootstrap/src/facility-map-namespace.e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3. `SEED_QUERIES` from `@openldr/reporting`; `makeReconcileDeps`, `seedRegistry`, `seedPerformers`, `seedMapping` from `./test-support/facility-reconcile-fixture`; `publishFacilityMap` from `./facility-reconcile`; `observedSystemForFeed`, `FACILITY_REGISTRY_SYSTEM` from `@openldr/db`.
- Produces: nothing importable.

**Context you need:**

Model this on `packages/bootstrap/src/facility-durable-updates.e2e.test.ts`, which is the proven pattern: it takes the query text from `SEED_QUERIES` at **runtime** rather than transcribing it, so the assertion cannot drift from what ships. Read that file first — particularly its `FACILITY_OPTIONS_SQL` constant and `facilityNameFromReportQuery` helper, and reuse their shape.

`q-facilities` returns `(value, label)` per performer code and **groups by `dr.performer`**, so two facilities sharing a code produce ONE row whose label is `min(...)` across them. That is a property of the shipped query, not something to work around: assert on it honestly. To show the two namespaces resolving to different names you must therefore either query `facility_map` directly for the resolution and use the seeded SQL to prove the *join matches*, or assert the label of a code that is unique per namespace. Prefer the second — it exercises the real path end to end.

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { FACILITY_REGISTRY_SYSTEM } from '@openldr/db';
import { SEED_QUERIES } from '@openldr/reporting';
import { makeReconcileDeps, seedRegistry, seedPerformers, seedMapping } from './test-support/facility-reconcile-fixture';
import { publishFacilityMap, type ReconcileDeps } from './facility-reconcile';

/**
 * The SQL a seeded report actually runs, read from `SEED_QUERIES` at runtime.
 *
 * ⛔ Asserting against a join transcribed into this file would prove nothing — it could stay green
 * while the shipped query still matched on the feed alone. There is exactly one copy of the text.
 */
const FACILITY_OPTIONS_SQL = SEED_QUERIES.find((q) => q.id === 'q-facilities')!.sql.postgres;

async function labelFor(deps: ReconcileDeps, code: string): Promise<string | null> {
  const res = await sql.raw<{ value: string; label: string }>(FACILITY_OPTIONS_SQL).execute(deps.externalDb);
  return res.rows.find((r) => r.value === code)?.label ?? null;
}

describe('facility_map keyed on the observed namespace — end to end (FAC-P0-07)', () => {
  it('direction A: one feed, two namespaces, two codes — each resolves to ITS OWN facility', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'L-A' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta Hospital', localCode: 'L-B' });

    // Two namespaces on ONE feed. Distinct codes so q-facilities' `group by dr.performer` does not
    // fold the two labels together — the join, not the grouping, is what is under test.
    await seedPerformers(deps, [['CODE-A', 1]], { sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:a' });
    await seedPerformers(deps, [['CODE-B', 1]], { sourceSystem: 'webhook-ingest', performerSystem: 'urn:ns:b' });
    await seedMapping(deps, { fromSystem: 'urn:ns:a', fromCode: 'CODE-A', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-A' });
    await seedMapping(deps, { fromSystem: 'urn:ns:b', fromCode: 'CODE-B', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-B' });

    await publishFacilityMap(deps, { apply: true });

    expect(await labelFor(deps, 'CODE-A')).toBe('Alpha Clinic');
    expect(await labelFor(deps, 'CODE-B')).toBe('Beta Hospital');
  });

  it('direction B: two feeds sharing a namespace — BOTH feeds\' reports resolve', async () => {
    // Not in the audit. These fold into ONE ResolvedFacility whose sourceSystem is merely the
    // display tiebreak winner, so before the fan-out feed-b had no dimension row and its reports
    // fell back to the raw code.
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-S', name: 'Shared Lab', localCode: 'L-S' });
    await seedPerformers(deps, [['NHL-01', 5]], { sourceSystem: 'feed-a', performerSystem: 'urn:ns:shared', performerDisplay: 'raw a' });
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-b', performerSystem: 'urn:ns:shared', performerDisplay: 'raw b' });
    await seedMapping(deps, { fromSystem: 'urn:ns:shared', fromCode: 'NHL-01', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-S' });

    await publishFacilityMap(deps, { apply: true });

    // Both feeds must have their own dimension row, or the losing feed's reports match nothing.
    const rows = await deps.externalDb.selectFrom('facility_map')
      .select(['source_system', 'name']).orderBy('source_system').execute();
    expect(rows).toEqual([
      { source_system: 'feed-a', name: 'Shared Lab' },
      { source_system: 'feed-b', name: 'Shared Lab' },
    ]);
    // And the shipped query resolves the code rather than falling back to either raw display.
    expect(await labelFor(deps, 'NHL-01')).toBe('Shared Lab');
  });

  it('a report whose wire supplied NO namespace still joins', async () => {
    // `NULL = NULL` is false in SQL. The dimension stores '' and the join coalesces to '' — the
    // class of bug that produced a silent reportCount: 0 in an earlier slice.
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-N', name: 'Nullspace Lab', localCode: 'L-N' });
    await seedPerformers(deps, [['NOSYS', 1]], { sourceSystem: 'webhook-ingest', performerSystem: null });
    await seedMapping(deps, {
      fromSystem: observedSystemForFeedUrl(), fromCode: 'NOSYS',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-N',
    });

    await publishFacilityMap(deps, { apply: true });

    expect(await labelFor(deps, 'NOSYS')).toBe('Nullspace Lab');
  });
});
```

Replace `observedSystemForFeedUrl()` with the real derivation — import `observedSystemForFeed` from `@openldr/db` and call `observedSystemForFeed('webhook-ingest')`. It is written as a placeholder here **only** to force you to check that import against the real export list in `packages/db/src/index.ts`; resolve it before running.

- [ ] **Step 2: Run to verify all three pass**

```bash
pnpm --filter @openldr/bootstrap vitest run src/facility-map-namespace.e2e.test.ts --testTimeout=30000
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Mutation-prove discrimination**

Each of these must be restored in place afterwards:

1. In `report-seeds.ts`, remove the namespace clause from `q-facilities`' **postgres** variant. Expected: direction A FAILS — `CODE-A` and `CODE-B` still resolve (the codes differ), so **if it passes, the test is not discriminating and must be strengthened before you proceed**. Say which happened.
2. In `facility-reconcile.ts`, revert the `flatMap` fan-out to a per-facility `map`. Expected: direction B FAILS with one `facility_map` row instead of two.
3. In `facility-reconcile.ts`, change `o.performer_system ?? ''` to `o.performer_system as string`. Expected: the NULL-namespace test FAILS — the dimension stores NULL and the join drops the row, so the label falls back to the raw code.

Mutation 1 is the important one. If removing the namespace from the join does not break direction A, rewrite direction A so it does — for instance by giving the two namespaces the **same** code and asserting on `facility_map` contents plus a `q-clinical-micro-header` execution, rather than on `q-facilities`' grouped label. Report honestly which shape you ended up with and why.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/facility-map-namespace.e2e.test.ts
git commit -m "test(facilities): pin both FAC-P0-07 directions through the shipped report SQL

Executes q-facilities' text verbatim from SEED_QUERIES rather than a transcribed
join, so the assertions cannot drift from what a real report runs.

Covers one feed with two namespaces, two feeds sharing a namespace -- the
direction the audit does not name -- and a report whose wire supplied no
namespace at all, which the '' convention has to carry because NULL = NULL is
false in SQL."
```

---

### Task 6: Live verification on real Postgres

**Files:** none — this task produces a written report, not a diff.

**Context you need:**

pg-mem has twice hidden defects that would have failed every real install, including a bound parameter in a `CREATE INDEX` predicate and a false `numInsertedOrUpdatedRows` after a skipped `onConflict().doNothing()`. External-migration tests are Postgres-only, so **nothing in the gate says anything about MSSQL or MySQL.** The previous slice found real bugs at exactly this step.

Dev DB access:

```bash
URL=$(grep -E "^TARGET_DATABASE_URL=" .env | cut -d= -f2-)
docker compose exec -T postgres psql "${URL/127.0.0.1:5433/localhost:5432}" -c "select 1"
```

Baseline measured 2026-08-09, before any of this work: `diagnostic_reports` 7 520 rows, 1 distinct `performer_system` (`urn:openldr:default_fac`), 1 distinct `source_system` (`webhook-ingest`), 88 `facility_map` rows.

- [ ] **Step 1: Run the full gate**

```bash
pnpm turbo run typecheck test --force
```

**Never pipe this through `tail`.** If a package fails, re-run that package's `vitest run` directly before concluding anything — a timeout is not a regression. Grep the output for `Test timed out` first.

- [ ] **Step 2: Apply migration 015 to the real dev warehouse**

```bash
node packages/cli/dist/index.js db migrate
```

If the CLI build is unavailable on Windows (a known esbuild native-module flake), run the migration through whatever path `openldr db migrate` uses in this workspace and say which you used. Expected: exit 0, `015_facility_map_performer_system` among the applied external migrations.

- [ ] **Step 3: Verify the backfill did what it claims**

```bash
URL=$(grep -E "^TARGET_DATABASE_URL=" .env | cut -d= -f2-)
docker compose exec -T postgres psql "${URL/127.0.0.1:5433/localhost:5432}" -c "select performer_system, count(*) from facility_map group by 1;"
```

Expected: **88 rows all carrying `urn:openldr:default_fac`**, not `''`. A result of `''` means the backfill silently matched nothing and the fix would have blanked every facility name on every report — the exact regression the backfill exists to prevent. Do not proceed past this if it shows `''`.

- [ ] **Step 4: Verify the report join still resolves against real data**

Run `q-facilities`' postgres text against the real warehouse and confirm the labels are unchanged from before the migration. The one mapped facility must still show its registry name; the other 87 must still show their `performer_display` fallback.

```bash
docker compose exec -T postgres psql "${URL/127.0.0.1:5433/localhost:5432}" -c "select count(*) as options, count(*) filter (where label <> value) as named from (select dr.performer as value, min(coalesce(fm.name, dr.performer_display, dr.performer)) as label from diagnostic_reports dr left join facility_map fm on fm.source_system = coalesce(dr.source_system, '') and fm.performer_system = coalesce(dr.performer_system, '') and fm.source_code = dr.performer where dr.performer is not null and dr.performer <> '' group by dr.performer) t;"
```

Expected: 88 options. Record the `named` count and compare it against the same query run with the namespace clause removed — the two must agree, since today's data has exactly one namespace. **A disagreement means the join is broken, not that the fix is working.**

- [ ] **Step 5: Verify the boot enqueue fires**

Start the dev API (`cd apps/server && node dev.mjs`), then check that a `facility-map-rebuild` job appeared and drained:

```bash
INT=$(grep -E "^INTERNAL_DATABASE_URL=" .env | cut -d= -f2-)
docker compose exec -T postgres psql "${INT/127.0.0.1:5433/localhost:5432}" -c "select kind, status, attempts, result_count, active_key, requested_by from facility_jobs order by created_at desc limit 5;"
```

Expected: a row with `kind=facility-map-rebuild`, `requested_by=boot`, `status=done`, `result_count=88`, `active_key` NULL.

⚠ **Kill the dev API when done.** It binds broadly even with `DEV_HOST=127.0.0.1`:

```bash
netstat -ano | grep :3000
```

then `taskkill //PID <pid> //F`. `pkill -f "node dev.mjs"` does not work here.

- [ ] **Step 6: Clean up and write the report**

Restore the dev DB to its pre-test state if anything was inserted. Write the task report covering, for each of steps 1–5: the exact command, the actual output, and whether it matched the expectation. **Anything you could not run — MSSQL, MySQL — must be listed explicitly as unverified rather than omitted.** The spec already states MSSQL/MySQL backfill correctness rests on live verification and not the gate; the report must say whether that verification happened or not.

- [ ] **Step 7: Commit the report**

```bash
git add .superpowers/sdd/
git commit -m "docs(facilities): live-verification report for the facility_map namespace key"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 grain, `performer_system` column, `''` convention, index untouched | 1 |
| §2 collision impossible by construction, throw not filter | 2 |
| §3 `observations`, publish fan-out, `facilityMapId` third parameter | 2 |
| §4 migration 015, backfill, boot safety net | 1, 4 |
| §5 nine SQL strings, two CTEs, four pinned tests, managed-overwrite | 3 |
| §6 governance — `EXTERNAL_TABLE_COLUMNS` only, `GOVERNED`/builder untouched | 1 (and deliberately no task for the others) |
| Testing §1–4 both directions, NULL namespace, uniqueness invariant | 2, 5 |
| Testing §5 migration backfill incl. orphan row | 1 |
| Testing §6 `EXTERNAL_TABLE_COLUMNS` exhaustive test | 1 |
| Live verification on real Postgres | 6 |
| Known limit: MSSQL/MySQL unproven by CI | 6 step 6 |
| Known limit: `facility_of` independent `min()` | 3 step 5 (named in the query comment) |

No spec requirement is unassigned.

**Corrections made while writing this plan, all from reading the code rather than the spec:**

1. **The spec put the boot enqueue in `seedEssentials`. That was wrong** — `EssentialSeedTarget` has no db handle, and `index.ts` documents why this class of seed does not go there. Spec corrected in place; Task 4 carries the real location.
2. **The backfill cannot be one dialect-agnostic statement.** MSSQL refuses `MIN()` over `nvarchar(max)`, which is what `textType` gives `performer_system`, and MySQL's `CAST` spells the type `char(n)` not `varchar(n)`. Task 1 carries a `castKeyType` helper.
3. **The insert chunk size must drop from 140 to 130** — the row binds 15 values now, not 14, and the existing comment states the MSSQL parameter budget explicitly. Missing this would break MSSQL publishes at scale while every Postgres test stayed green.
4. **`export-data.test.ts` would NOT have caught the new column** — it asserts the table-name set and id/provenance columns only. Task 1 step 7 adds the assertion that actually pins the natural key.
5. **`seedPerformers` already accepts `performerSystem` and `sourceSystem`** — no new fixture is needed. Confirmed in `test-support/facility-reconcile-fixture.ts`.
6. **`q-facilities` groups by `dr.performer`**, so two namespaces sharing a code produce one row with a `min()` label. Task 5 step 3 mutation 1 exists specifically to catch a non-discriminating test built on that assumption.

**Placeholder scan:** one deliberate placeholder remains — `observedSystemForFeedUrl()` in Task 5 step 1, flagged in the surrounding prose as something the implementer must resolve against the real export list. Every other step carries executable content.

**Type consistency:** `facilityMapId(sourceSystem, performerSystem, sourceCode)` has the same three-parameter order in Tasks 2 and in the Global Constraints. `observations: { sourceSystem: string; performerSystem: string }[]` is spelled identically in the `ResolvedFacility` field, the `FoldedGroup` Map value, and the `publishFacilityMap` flatMap. `performer_system` is the column name everywhere; `performerSystem` is the TypeScript field everywhere.
