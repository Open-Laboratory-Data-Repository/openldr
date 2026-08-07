# Facility durable updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make facility concept projection and the report-facing `facility_map` rebuild durable, automatic, and observable — so saving a mapping reaches reports without a hidden manual Publish, and a failed projection becomes a visible retryable state instead of a `console.error`.

**Architecture:** A `facility_jobs` table and worker modelled directly on `terminology_ingest_jobs` (migration `061`) — same race-safe `claimNext`, same `failStaleRunning` crash recovery, same `active_key` mechanism. Mutation sites enqueue a coalescing `facility-map-rebuild` job; the inline projection stays on the happy path and enqueues a `registry-projection` job only when it fails. A health endpoint resolves Current/Updating/Failed/Stale for a chip on the Facilities page.

**Tech Stack:** TypeScript, Kysely (Postgres for the internal DB), vitest with pg-mem, Fastify, React + shadcn/ui.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-08-facility-durable-updates-design.md`. Read it before Task 1.
- **Migration number is fixed:** `079`, internal, under `packages/db/src/migrations/internal/`. Last existing is `078`.
- **Copy `061`'s `active_key` mechanism — NEVER a `WHERE`-based partial unique index.** `061_terminology_ingest_jobs.ts:21-32` documents a real pg-mem planner bug: after a row's status leaves a partial predicate, pg-mem excludes that row from *any* later query filtering on the indexed column, even with no status filter. A plain unique index on a nullable app-managed column gives identical real-Postgres guarantees.
- **`active_key` is non-null ONLY while `status = 'queued'`**, and `claimNext` clears it in the same statement that sets `running`. This is load-bearing in both directions — see Task 2.
- ⛔ **`active_key` is a job IDENTITY, not the kind.** `facility-map-rebuild` rewrites the whole dimension, so every request is interchangeable and its key is the kind alone. `registry-projection` repairs ONE named facility, so its key is `` `registry-projection:${registryId}` ``. Keying projections on the kind would make 200 failed projections enqueue exactly ONE repair and leave 199 facilities unmapped while the queue drains and the chip goes green — the exact defect this workstream exists to remove. Use `activeKeyFor()` from `facility-job-store.ts`; never inline the kind as the key.
- **The inline projection stays.** `projectRegistryRows` keeps its never-throws contract and its position on the happy path. A prior slice explicitly fixed "register a facility and immediately find it in the mapping picker"; making projection async regresses that.
- **A projection failure must never fail the facility write.** Unchanged contract.
- **Migrations INLINE their constants** — a migration is a frozen snapshot. See `075_facility_registry_coding_system.ts`.
- **`packages/db/src/migrations/migrations.test.ts` asserts the EXACT migration list** and lives one directory ABOVE `migrations/internal`, so a per-file vitest run will NOT catch a missing registration. Run the whole `src/migrations` directory.
- **Migration test shape:** `makeMigratedDb` applies EVERY registered migration including yours before the test body runs. `079` CREATES a table, so a second `up()` throws. Follow the `makeDbBefore077()` pattern from `077_facility_concept_projection.test.ts`.
- **CLI parity is a hard repo convention** — operator-facing capability needs an `openldr` command.
- **All user-visible strings from i18n** — `en.ts`, `fr.ts`, AND `pt.ts`.
- **shadcn/ui primitives only** in Studio; never a native control.
- **Commit trailer:** never add `Co-Authored-By`.
- **Never `git add -A`** — shared working directory. Stage explicit paths.
- **Gate:** `pnpm turbo run typecheck test --force`. Never pipe turbo through `tail`. Whole-package vitest runs need `--testTimeout=30000`.
- ⛔ **Never revert a mutation with `git checkout -- <file>`** — it reverts the whole file and destroyed a task's work in the previous workstream. Use in-place reverse edits.
- ⛔ **Never write a raw control character into a source file** — a literal NUL byte made a file binary to git in the previous workstream. Use `\0`-style escapes.
- **Comments must be precisely true.** The previous workstream was caught overclaiming six times; state exact bounds.

---

# Slice 1 — The job table and store

### Task 1: `facility_jobs` table

**Files:**
- Create: `packages/db/src/migrations/internal/079_facility_jobs.ts`
- Create: `packages/db/src/migrations/internal/079_facility_jobs.test.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`, `packages/db/src/migrations/migrations.test.ts`, `packages/db/src/schema/internal.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `facility_jobs` and `FacilityJobsTable` on `InternalSchema`:
  ```ts
  export interface FacilityJobsTable {
    id: string;
    kind: string;                       // 'facility-map-rebuild' | 'registry-projection'
    status: string;                     // 'queued' | 'running' | 'done' | 'failed'
    attempts: number;
    last_error: string | null;
    registry_id: string | null;
    result_count: number | null;
    requested_by: string | null;
    requested_at: Generated<Date>;
    started_at: Date | null;
    finished_at: Date | null;
    active_key: string | null;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrations/internal/079_facility_jobs.test.ts`. Build a DB WITHOUT `079` so the migration's own effect is observable (mirror `077_facility_concept_projection.test.ts`'s helper):

```ts
import { describe, it, expect } from 'vitest';
import { Kysely } from 'kysely';
import { makeMigratedDb } from './test-helpers';
import { up } from './079_facility_jobs';

describe('079 facility_jobs', () => {
  it('creates the table and accepts a queued job', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values({
      id: 'fj1', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute();

    const rows = await db.selectFrom('facility_jobs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'facility-map-rebuild', status: 'queued', attempts: 0 });
  });

  it('⛔ allows only ONE row per active_key — this is what makes enqueue coalesce', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values({
      id: 'fj1', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute();

    await expect(db.insertInto('facility_jobs').values({
      id: 'fj2', kind: 'facility-map-rebuild', status: 'queued', attempts: 0, active_key: 'facility-map-rebuild',
    } as never).execute()).rejects.toThrow();
  });

  it('⛔ allows MANY rows with a NULL active_key — this is what lets a job be enqueued while another RUNS', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_jobs').values([
      { id: 'fj1', kind: 'facility-map-rebuild', status: 'running', attempts: 1, active_key: null },
      { id: 'fj2', kind: 'facility-map-rebuild', status: 'done', attempts: 1, active_key: null },
    ] as never).execute();

    expect(await db.selectFrom('facility_jobs').selectAll().execute()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations/internal/079_facility_jobs.test.ts
```

Expected: FAIL — `Cannot find module './079_facility_jobs'`.

- [ ] **Step 3: Write the migration**

```ts
import { type Kysely, sql } from 'kysely';

// Durable work for the facility subsystem: rebuilding the report-facing `facility_map`, and
// retrying a concept projection that failed inline. Before this, a rebuild was a hidden manual menu
// action and a failed projection was a `console.error` — the interface could report success while
// reports disagreed.
//
// ⛔ `active_key` is an app-managed IDENTITY key, non-null ONLY while the row is 'queued', and
// cleared by `claimNext` in the same statement that sets 'running'. Its value is the job kind for a
// whole-dimension `facility-map-rebuild` (every such request is interchangeable) but `kind:registryId`
// for a `registry-projection`, which repairs ONE named facility -- see `facility-job-store.ts`.
// A PLAIN unique index on it then buys two different properties:
//   - a request arriving while one of the SAME identity is already QUEUED is absorbed (coalescing),
//     so a 14 000-row CSV import enqueues one rebuild rather than 14 000;
//   - a request arriving while that job is RUNNING sees a NULL active_key, so it inserts a FRESH
//     queued job instead of being swallowed by a build that has already read the data.
// The second property is the one an obvious implementation gets wrong.
//
// ⛔ Deliberately NOT a `WHERE status = 'queued'` partial unique index. Migration
// `061_terminology_ingest_jobs.ts` documents the reason at length: pg-mem's planner mishandles
// partial indexes — once a row's status leaves the predicate it is excluded from ANY later query
// filtering on the indexed column, even one with no status filter. This column sidesteps that while
// giving identical real-Postgres uniqueness (NULLs are distinct, so many inactive rows coexist).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_jobs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('queued'))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    // Which facility a 'registry-projection' retry is for. NULL for a whole-dimension rebuild.
    .addColumn('registry_id', 'text')
    // Rows written by the last successful rebuild — what the health chip reports, so it does not
    // have to reach into the EXTERNAL warehouse to count them.
    .addColumn('result_count', 'integer')
    .addColumn('requested_by', 'text')
    .addColumn('requested_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('active_key', 'text')
    .execute();

  await sql`create unique index facility_jobs_one_active on facility_jobs (active_key)`.execute(db);

  await db.schema.createIndex('facility_jobs_kind_requested')
    .on('facility_jobs').columns(['kind', 'requested_at']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_jobs').execute();
}
```

- [ ] **Step 4: Add the schema type and register**

Add `FacilityJobsTable` (exact shape in the Interfaces block above) to `packages/db/src/schema/internal.ts` and `facility_jobs: FacilityJobsTable;` to `InternalSchema`. Register `079` in `packages/db/src/migrations/internal/index.ts` following `078`'s shape, and add `079_facility_jobs` to the exact-list assertion in `packages/db/src/migrations/migrations.test.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/migrations
```

Expected: PASS, including `migrations.test.ts`'s exact-list assertion.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations packages/db/src/schema/internal.ts
git commit -m "feat(db): add facility_jobs for durable facility work

Rebuilding the report-facing facility_map was a hidden manual menu action
and a failed concept projection was a console.error, so the interface could
report success while reports disagreed. This table makes both durable.

active_key is non-null only while queued and cleared on claim, so a request
arriving while one is queued coalesces, while one arriving during a RUNNING
rebuild creates a fresh job rather than being swallowed by a build that
already read the data. Plain unique index, not a partial one -- 061
documents the pg-mem planner bug that makes partial indexes unusable here."
```

### Task 2: `createFacilityJobStore`

**Files:**
- Create: `packages/db/src/facility-job-store.ts`
- Create: `packages/db/src/facility-job-store.test.ts`
- Modify: `packages/db/src/index.ts` (export)

**Interfaces:**
- Consumes: `facility_jobs` from Task 1.
- Produces:
  ```ts
  export type FacilityJobKind = 'facility-map-rebuild' | 'registry-projection';
  export type FacilityJobStatus = 'queued' | 'running' | 'done' | 'failed';
  export interface FacilityJob {
    id: string; kind: FacilityJobKind; status: FacilityJobStatus; attempts: number;
    lastError: string | null; registryId: string | null; resultCount: number | null;
    requestedBy: string | null; requestedAt: string;
    startedAt: string | null; finishedAt: string | null;
  }
  export interface FacilityJobStore {
    enqueue(input: { kind: FacilityJobKind; registryId?: string | null; requestedBy?: string | null }): Promise<{ job: FacilityJob | null; coalesced: boolean }>;
    claimNext(): Promise<FacilityJob | null>;
    finish(id: string, status: 'done' | 'failed', opts: { error?: string | null; resultCount?: number | null }): Promise<void>;
    retry(id: string): Promise<void>;
    retryPreservingAttempts(id: string): Promise<void>;
    failStaleRunning(error: string): Promise<number>;
    latest(kind: FacilityJobKind): Promise<FacilityJob | null>;
    // Can return MORE THAN ONE row for the same identity -- one 'running' + one 'queued' from the
    // enqueue-during-RUNNING asymmetry, or two 'queued' rows when a retry re-queues under contention
    // and yields the active_key instead of throwing. This is safe: both job kinds are idempotent and
    // the redundant row genuinely runs. A consumer (Task 11's health computation included) must not
    // assume at-most-one-row-per-identity here.
    listUnresolved(): Promise<FacilityJob[]>;
    countFailed(kind: FacilityJobKind): Promise<number>;
  }
  export function createFacilityJobStore(db: Kysely<InternalSchema>): FacilityJobStore;
  ```
  Tasks 3–11 all consume this.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/facility-job-store.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityJobStore } from './facility-job-store';

// Lets one test force an id COLLISION, which is the only way to make the store's insert raise a
// unique violation that is not an `active_key` conflict. Real `randomUUID` everywhere else.
const uuid = vi.hoisted(() => ({ fixed: null as string | null }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: () => uuid.fixed ?? actual.randomUUID() };
});

const REBUILD = 'facility-map-rebuild' as const;
const PROJECTION = 'registry-projection' as const;

describe('createFacilityJobStore', () => {
  it('enqueues a job', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    const { job, coalesced } = await store.enqueue({ kind: REBUILD });
    expect(coalesced).toBe(false);
    expect(job).toMatchObject({ kind: REBUILD, status: 'queued', attempts: 0 });
  });

  it('COALESCES a second request while one is still queued', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const second = await store.enqueue({ kind: REBUILD });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('⛔ does NOT coalesce a request arriving while a rebuild is RUNNING', async () => {
    // The running build may already have read the data, so absorbing this request would silently
    // drop the change that caused it. This is the case an obvious implementation gets wrong.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const claimed = await store.claimNext();
    expect(claimed?.status).toBe('running');

    const during = await store.enqueue({ kind: REBUILD });

    expect(during.coalesced).toBe(false);
    expect(await store.listUnresolved()).toHaveLength(2);
  });

  it('claimNext takes the oldest queued job exactly once', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const first = await store.claimNext();
    const second = await store.claimNext();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(first?.attempts).toBe(1);
  });

  it('finish records the result count and clears the row from unresolved', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();
    await store.finish(job!.id, 'done', { resultCount: 88 });

    expect(await store.listUnresolved()).toEqual([]);
    expect((await store.latest(REBUILD))?.resultCount).toBe(88);
  });

  it('failStaleRunning marks an orphaned running job failed so it becomes visible', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    await store.claimNext();

    expect(await store.failStaleRunning('server restarted')).toBe(1);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'failed', lastError: 'server restarted' });
  });

  it('retry re-queues a failed job and resets attempts so a fixed cause is not locked out', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();
    await store.finish(job!.id, 'failed', { error: 'warehouse unreachable' });

    await store.retry(job!.id);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  });

  it('⛔ retryPreservingAttempts re-queues WITHOUT clearing the budget the retry loop is bounded by', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const job = await store.claimNext();          // attempts -> 1
    await store.finish(job!.id, 'failed', { error: 'boom' });

    await store.retryPreservingAttempts(job!.id);

    const latest = await store.latest(REBUILD);
    expect(latest).toMatchObject({ status: 'queued', attempts: 1 });   // NOT reset to 0
  });

  it('countFailed reports failed projection retries', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: 'registry-projection', registryId: 'fac-1' });
    const job = await store.claimNext();
    await store.finish(job!.id, 'failed', { error: 'boom' });

    expect(await store.countFailed('registry-projection')).toBe(1);
  });

  it('⛔ does NOT coalesce projection repairs for DIFFERENT facilities', async () => {
    // A projection job repairs ONE named facility. Coalescing on the kind alone would mean 200
    // facilities failing during one import produce exactly one repair, and the other 199 stay
    // unmapped while the queue drains and the health chip goes green.
    const store = createFacilityJobStore(await makeMigratedDb());
    const a = await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const b = await store.enqueue({ kind: PROJECTION, registryId: 'fac-B' });

    expect(a.coalesced).toBe(false);
    expect(b.coalesced).toBe(false);
    expect((await store.listUnresolved()).map((j) => j.registryId).sort()).toEqual(['fac-A', 'fac-B']);
  });

  it('COALESCES a second projection repair for the SAME facility', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const second = await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('a rebuild still coalesces on its KIND alone, ignoring any registryId', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD, registryId: 'fac-A' });
    const second = await store.enqueue({ kind: REBUILD, registryId: 'fac-B' });

    expect(second.coalesced).toBe(true);
    expect(await store.listUnresolved()).toHaveLength(1);
  });

  it('⛔ retryPreservingAttempts does not throw when the identity is already held by a queued job', async () => {
    // Exactly the state the asymmetry creates: J1 running, J2 queued holding the active_key, J1 then
    // fails. Re-arming the key unconditionally raises 23505 inside the worker's retry loop.
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: REBUILD });
    const j1 = await store.claimNext();
    expect((await store.enqueue({ kind: REBUILD })).coalesced).toBe(false);
    await store.finish(j1!.id, 'failed', { error: 'boom' });

    await expect(store.retryPreservingAttempts(j1!.id)).resolves.toBeUndefined();

    const unresolved = await store.listUnresolved();
    expect(unresolved).toHaveLength(2);
    expect(unresolved.find((j) => j.id === j1!.id)).toMatchObject({ status: 'queued', attempts: 1 });
  });

  it('⛔ retry does not throw when the identity is already held by a queued job', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' });
    const j1 = await store.claimNext();
    expect((await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' })).coalesced).toBe(false);
    await store.finish(j1!.id, 'failed', { error: 'boom' });

    await expect(store.retry(j1!.id)).resolves.toBeUndefined();

    const unresolved = await store.listUnresolved();
    expect(unresolved).toHaveLength(2);
    expect(unresolved.find((j) => j.id === j1!.id)).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
  });

  it('⛔ a unique violation that is NOT an active_key conflict is not reported as a coalesce', async () => {
    const store = createFacilityJobStore(await makeMigratedDb());
    uuid.fixed = '11111111-1111-4111-8111-111111111111';
    try {
      expect((await store.enqueue({ kind: PROJECTION, registryId: 'fac-A' })).coalesced).toBe(false);
      // Same generated id, DIFFERENT identity: this violates the PRIMARY KEY, not `active_key`.
      // Reporting `coalesced: true` would tell the caller fac-B's repair is pending when it was
      // dropped — the exact silent-drop this workstream exists to remove.
      await expect(store.enqueue({ kind: PROJECTION, registryId: 'fac-B' })).rejects.toThrow();
    } finally {
      uuid.fixed = null;
    }
    expect((await store.listUnresolved()).map((j) => j.registryId)).toEqual(['fac-A']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-job-store.test.ts
```

Expected: FAIL — `Cannot find module './facility-job-store'`.

- [ ] **Step 3: Write the store**

Create `packages/db/src/facility-job-store.ts`. Model it on `terminology-ingest-job-store.ts` — same `toJob` row-mapper shape, same guarded-UPDATE `claimNext` (pg-mem does not support `FOR UPDATE SKIP LOCKED` in a correlated subquery).

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type FacilityJobKind = 'facility-map-rebuild' | 'registry-projection';
export type FacilityJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface FacilityJob {
  id: string; kind: FacilityJobKind; status: FacilityJobStatus; attempts: number;
  lastError: string | null; registryId: string | null; resultCount: number | null;
  requestedBy: string | null; requestedAt: string;
  startedAt: string | null; finishedAt: string | null;
}

export interface FacilityJobStore {
  /** `coalesced: true` means a request of the same identity was ALREADY queued and this one was
   *  absorbed — not that it failed. `job` is null in that case. */
  enqueue(input: { kind: FacilityJobKind; registryId?: string | null; requestedBy?: string | null }): Promise<{ job: FacilityJob | null; coalesced: boolean }>;
  claimNext(): Promise<FacilityJob | null>;
  finish(id: string, status: 'done' | 'failed', opts: { error?: string | null; resultCount?: number | null }): Promise<void>;
  retry(id: string): Promise<void>;
  failStaleRunning(error: string): Promise<number>;
  latest(kind: FacilityJobKind): Promise<FacilityJob | null>;
  /** Can return MORE THAN ONE row for the same identity -- e.g. one 'running' plus one 'queued'
   *  from the enqueue-during-RUNNING asymmetry, or two 'queued' rows when `retry`/
   *  `retryPreservingAttempts` re-queues under contention and yields the `active_key`. Safe to
   *  consume as-is: both kinds are idempotent and the redundant row genuinely runs. */
  listUnresolved(): Promise<FacilityJob[]>;
  countFailed(kind: FacilityJobKind): Promise<number>;
}

type Row = {
  id: string; kind: string; status: string; attempts: number; last_error: string | null;
  registry_id: string | null; result_count: number | null; requested_by: string | null;
  requested_at: Date; started_at: Date | null; finished_at: Date | null; active_key: string | null;
};

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

// ⛔ The IDENTITY of a job — two requests share one exactly when running either makes the other
// redundant, which is when it is safe to coalesce them. A rebuild rewrites the whole dimension, so
// its identity is the kind alone; a projection repairs ONE facility, so its identity includes that
// facility. Keying projections on the kind alone silently drops every facility but the first.
function activeKeyFor(kind: FacilityJobKind, registryId: string | null): string {
  return kind === 'registry-projection' ? `${kind}:${registryId ?? ''}` : kind;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === '23505' || /unique|duplicate/i.test(e?.message ?? '');
}

function toJob(r: Row): FacilityJob {
  return {
    id: r.id, kind: r.kind as FacilityJobKind, status: r.status as FacilityJobStatus,
    attempts: Number(r.attempts), lastError: r.last_error, registryId: r.registry_id,
    resultCount: r.result_count == null ? null : Number(r.result_count),
    requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).toISOString(),
    startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  };
}

// How many queued rows `claimNext` will try before idling. Only reached when a concurrent claimer
// wins the guarded UPDATE.
const CLAIM_CANDIDATES = 10;

export function createFacilityJobStore(db: Kysely<InternalSchema>): FacilityJobStore {
  /** The id of an ACTIVE (queued) job with this identity, if one exists. */
  const findActiveId = async (activeKey: string, excludeId?: string): Promise<string | undefined> => {
    let q = db.selectFrom('facility_jobs').select('id').where('active_key', '=', activeKey);
    if (excludeId !== undefined) q = q.where('id', '!=', excludeId);
    return (await q.executeTakeFirst())?.id;
  };

  /** Re-queue a finished job, re-arming its `active_key` only when that identity is FREE. The design
   *  deliberately allows a second job of the same identity to be QUEUED while the first RUNS, so a run
   *  that then fails is re-queued into a state where the key is already held — setting it
   *  unconditionally raises 23505 out of the worker's retry loop and the operator's Retry button.
   *  Yielding the key is safe: the row still goes back to `queued`, and the job holding the key does
   *  the same work by construction of the identity. */
  const requeue = async (
    job: { id: string; kind: string; registry_id: string | null },
    apply: (activeKey: string | null) => Promise<unknown>,
  ): Promise<void> => {
    const key = activeKeyFor(job.kind as FacilityJobKind, job.registry_id);
    if (await findActiveId(key, job.id)) { await apply(null); return; }
    try {
      await apply(key);
    } catch (err) {
      if (!isUniqueViolation(err) || !(await findActiveId(key, job.id))) throw err;
      await apply(null);
    }
  };

  return {
    async enqueue(input) {
      // The invariant is "at most one ACTIVE job per identity" and it lives in `active_key`: non-null
      // only while a row is 'queued', cleared by claimNext in the same statement that sets 'running'.
      // The pre-check below is what enforces it; the unique index (migration 079) is the race backstop.
      //
      // ⛔ The pre-check is NOT stylistic. `numInsertedOrUpdatedRows` after `.onConflict().doNothing()`
      // was MEASURED not to work on pg-mem (a skipped insert still reports "1"), and `.returningAll()`
      // on that skipped insert returns the OTHER, pre-existing row. Both misreport a coalesce as a
      // fresh enqueue. A SELECT is deterministic on both pg-mem and real Postgres.
      const activeKey = activeKeyFor(input.kind, input.registryId ?? null);
      if (await findActiveId(activeKey)) return { job: null, coalesced: true };

      const id = `fj_${randomUUID()}`;
      try {
        await db.insertInto('facility_jobs')
          .values({
            id, kind: input.kind, status: 'queued', attempts: 0,
            registry_id: input.registryId ?? null, requested_by: input.requestedBy ?? null,
            active_key: activeKey,
          })
          .execute();
      } catch (err) {
        // ⛔ Only an `active_key` collision means "already queued". Returning `coalesced` for ANY
        // unique violation silently DROPS the request on e.g. a primary-key collision — the caller is
        // told work is pending when nothing is. Re-check before concluding.
        if (isUniqueViolation(err) && (await findActiveId(activeKey))) return { job: null, coalesced: true };
        throw err;
      }
      const row = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      return { job: toJob(row), coalesced: false };
    },

    async claimNext() {
      // `requested_at` defaults to now(), which is TRANSACTION time in Postgres — rows enqueued in one
      // transaction tie. The `id` tiebreaker makes the order total instead of engine-dependent.
      const candidates = await db.selectFrom('facility_jobs').select('id')
        .where('status', '=', 'queued')
        .orderBy('requested_at', 'asc').orderBy('id', 'asc')
        .limit(CLAIM_CANDIDATES).execute();

      // Guarded UPDATE rather than SELECT ... FOR UPDATE SKIP LOCKED: pg-mem cannot do the latter in
      // a correlated subquery, and the `and status = 'queued'` guard is race-safe in real Postgres
      // anyway (a second claimer updates 0 rows instead of double-claiming). Losing that guard means
      // another worker took the row, NOT that the queue is empty — advance to the next candidate.
      // ⛔ `active_key = null` here, NOT in finish(): that is what lets a change arriving mid-build
      // enqueue a fresh job instead of being swallowed.
      for (const candidate of candidates) {
        const rows = await sql<Row>`
          update facility_jobs
          set status = 'running', started_at = now(), attempts = attempts + 1, active_key = null
          where id = ${candidate.id} and status = 'queued'
          returning *
        `.execute(db);
        const r = rows.rows[0];
        if (r) return toJob(r);
      }
      return null;
    },

    async finish(id, status, opts) {
      await db.updateTable('facility_jobs')
        .set({
          status, last_error: opts.error ?? null,
          result_count: opts.resultCount ?? null,
          finished_at: sql<Date>`now()`,
        })
        .where('id', '=', id)
        .execute();
    },

    async retry(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return;
      // attempts reset to 0 deliberately: this is the OPERATOR's explicit action, and someone who
      // has fixed the underlying cause must not be locked out by a previously exhausted budget.
      await requeue(job, (activeKey) => db.updateTable('facility_jobs')
        .set({ status: 'queued', attempts: 0, last_error: null, started_at: null, finished_at: null, active_key: activeKey })
        .where('id', '=', id)
        .execute());
    },

    async retryPreservingAttempts(id) {
      const job = await db.selectFrom('facility_jobs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!job) return;
      // The WORKER's automatic retry. Deliberately does NOT touch `attempts` — that counter is what
      // bounds the retry loop, so resetting it here would spin forever on a permanently failing job.
      // The distinction from `retry` above is the whole reason both exist.
      await requeue(job, (activeKey) => db.updateTable('facility_jobs')
        .set({ status: 'queued', started_at: null, finished_at: null, active_key: activeKey })
        .where('id', '=', id)
        .execute());
    },

    async failStaleRunning(error) {
      const res = await db.updateTable('facility_jobs')
        .set({ status: 'failed', last_error: error, finished_at: sql<Date>`now()`, active_key: null })
        .where('status', '=', 'running')
        .executeTakeFirst();
      return Number(res?.numUpdatedRows ?? 0);
    },

    async latest(kind) {
      const row = await db.selectFrom('facility_jobs').selectAll()
        .where('kind', '=', kind).orderBy('requested_at', 'desc').limit(1).executeTakeFirst();
      return row ? toJob(row) : null;
    },

    async listUnresolved() {
      const rows = await db.selectFrom('facility_jobs').selectAll()
        .where('status', 'in', ['queued', 'running']).orderBy('requested_at', 'asc').execute();
      return rows.map((r) => toJob(r));
    },

    async countFailed(kind) {
      const rows = await db.selectFrom('facility_jobs').select('id')
        .where('kind', '=', kind).where('status', '=', 'failed').execute();
      return rows.length;
    },
  };
}
```

- [ ] **Step 4: Export from the package**

Add to `packages/db/src/index.ts`:

```ts
export { createFacilityJobStore } from './facility-job-store';
export type { FacilityJob, FacilityJobKind, FacilityJobStatus, FacilityJobStore } from './facility-job-store';
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/db exec vitest run src/facility-job-store.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/facility-job-store.ts packages/db/src/facility-job-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): add createFacilityJobStore

Coalescing is asymmetric on purpose and both directions are pinned by tests:
a request arriving while one is QUEUED is absorbed, so a 14k-row CSV import
enqueues one rebuild; a request arriving while one is RUNNING creates a fresh
job, because the running build may already have read the data and absorbing
it would silently drop the change that caused it.

claimNext clears active_key rather than finish() doing it -- that placement is
what makes the second property hold."
```

---

# Slice 2 — The worker

### Task 3: `createFacilityJobWorker`

**Files:**
- Create: `packages/bootstrap/src/facility-job-worker.ts`
- Create: `packages/bootstrap/src/facility-job-worker.test.ts`

**Interfaces:**
- Consumes: `FacilityJobStore`, `FacilityJob` from Task 2; `publishFacilityMap(deps, { apply })` and `projectRegistryRows(deps, rows)` from `./facility-reconcile`.
- Produces:
  ```ts
  export interface FacilityJobWorkerDeps {
    jobs: FacilityJobStore;
    runRebuild(): Promise<{ written: number }>;
    runProjection(registryId: string): Promise<void>;
    maxAttempts?: number;   // default 5
    intervalMs?: number;    // default 3000
    logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
  }
  export interface FacilityJobWorker { tickOnce(): Promise<void>; stop(): Promise<void>; }
  export function createFacilityJobWorker(deps: FacilityJobWorkerDeps): FacilityJobWorker;
  ```
  Task 4 wires it. Note the worker takes `runRebuild`/`runProjection` as injected functions, not `ReconcileDeps` — that keeps it testable without a warehouse.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMigratedDb } from '@openldr/db/…'; // use the same import path the other bootstrap tests use
import { createFacilityJobStore } from '@openldr/db';
import { createFacilityJobWorker } from './facility-job-worker';

const fakeLogger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createFacilityJobWorker', () => {
  it('runs a queued rebuild and records the row count', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 88 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    });

    await worker.tickOnce();
    await worker.stop();

    const latest = await jobs.latest('facility-map-rebuild');
    expect(latest).toMatchObject({ status: 'done', resultCount: 88 });
  });

  it('records a failure with its message instead of throwing', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => { throw new Error('warehouse unreachable'); },
      runProjection: async () => {}, intervalMs: 10_000, logger: fakeLogger(),
    });

    await expect(worker.tickOnce()).resolves.toBeUndefined();
    await worker.stop();

    expect(await jobs.latest('facility-map-rebuild')).toMatchObject({
      status: 'failed', lastError: expect.stringContaining('warehouse unreachable'),
    });
  });

  it('re-queues a failure until maxAttempts, then stops retrying and stays visible', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => { throw new Error('nope'); }, runProjection: async () => {},
      maxAttempts: 2, intervalMs: 10_000, logger: fakeLogger(),
    });

    for (let i = 0; i < 5; i += 1) await worker.tickOnce();
    await worker.stop();

    const latest = await jobs.latest('facility-map-rebuild');
    expect(latest?.status).toBe('failed');
    expect(latest?.attempts).toBe(2);          // stopped at the bound, did not spin
  });

  it('runs a registry-projection job against its own facility', async () => {
    const jobs = createFacilityJobStore(await makeMigratedDb());
    await jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const seen: string[] = [];
    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 0 }),
      runProjection: async (id) => { seen.push(id); },
      intervalMs: 10_000, logger: fakeLogger(),
    });

    await worker.tickOnce();
    await worker.stop();

    expect(seen).toEqual(['fac-A']);
  });

  it('crash recovery: an orphaned running job becomes failed at startup', async () => {
    const db = await makeMigratedDb();
    const jobs = createFacilityJobStore(db);
    await jobs.enqueue({ kind: 'facility-map-rebuild' });
    await jobs.claimNext();                     // simulates a process killed mid-run

    const worker = createFacilityJobWorker({
      jobs, runRebuild: async () => ({ written: 0 }), runProjection: async () => {},
      intervalMs: 10_000, logger: fakeLogger(),
    });
    await worker.stop();                        // stop() awaits the crash-recovery handle

    expect((await jobs.latest('facility-map-rebuild'))?.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-job-worker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the worker**

Model it on `packages/bootstrap/src/terminology-ingest-worker.ts` — same `tickOnce`/`stop` shape, same non-blocking crash-recovery handle retained so `stop()` can await it.

```ts
import type { FacilityJob, FacilityJobStore } from '@openldr/db';

export interface FacilityJobWorkerDeps {
  jobs: FacilityJobStore;
  runRebuild(): Promise<{ written: number }>;
  runProjection(registryId: string): Promise<void>;
  maxAttempts?: number;
  intervalMs?: number;
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

export interface FacilityJobWorker { tickOnce(): Promise<void>; stop(): Promise<void>; }

export function createFacilityJobWorker(deps: FacilityJobWorkerDeps): FacilityJobWorker {
  const intervalMs = deps.intervalMs ?? 3000;
  const maxAttempts = deps.maxAttempts ?? 5;
  let stopped = false;
  let running = false;

  async function processJob(job: FacilityJob): Promise<void> {
    try {
      if (job.kind === 'facility-map-rebuild') {
        const { written } = await deps.runRebuild();
        await deps.jobs.finish(job.id, 'done', { resultCount: written });
      } else {
        if (job.registryId) await deps.runProjection(job.registryId);
        await deps.jobs.finish(job.id, 'done', {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.jobs.finish(job.id, 'failed', { error: message });
      // Re-queue until the attempt budget is spent. `claimNext` increments `attempts`, so the job
      // that has just run already carries its own attempt count — compare against it, not against
      // a separate counter. Past the bound the row STAYS failed with its last_error rather than
      // disappearing, so the health chip can still show it and an operator can Retry.
      if (job.attempts < maxAttempts) await deps.jobs.retryPreservingAttempts(job.id);
      deps.logger.error({ err, jobId: job.id, kind: job.kind, attempts: job.attempts }, 'facility job failed');
    }
  }

  async function tickOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const job = await deps.jobs.claimNext();
      if (job) await processJob(job);
    } catch (err) {
      deps.logger.error({ err }, 'facility job tick failed');
    } finally {
      running = false;
    }
  }

  // Crash recovery: a job still 'running' at startup was orphaned by a killed process. Best-effort
  // and non-blocking — a failure here must never stop the worker starting. The handle is retained so
  // stop() can await it, preventing a stray recovery log after shutdown.
  const crashRecovery = deps.jobs
    .failStaleRunning('interrupted — the server restarted before the rebuild finished')
    .then((n) => { if (n > 0) deps.logger.info({ count: n }, 'reset orphaned facility jobs at startup'); })
    .catch((err) => deps.logger.error({ err }, 'facility job crash-recovery failed'));

  const timer = setInterval(() => { if (!stopped) void tickOnce(); }, intervalMs);

  return {
    tickOnce,
    async stop() { stopped = true; clearInterval(timer); await crashRecovery; },
  };
}
```

> ⚠ `retryPreservingAttempts` is the WORKER's retry and does not touch `attempts`; `retry` is the
> OPERATOR's and resets it to 0. Both come from Task 2. Using `retry` here would reset the counter
> the loop is bounded by and spin forever on a permanently failing job — which is precisely what the
> `maxAttempts` test above pins.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-job-worker.test.ts
pnpm --filter @openldr/db exec vitest run src/facility-job-store.test.ts
```

Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-job-worker.ts packages/bootstrap/src/facility-job-worker.test.ts packages/db/src/facility-job-store.ts packages/db/src/facility-job-store.test.ts
git commit -m "feat(bootstrap): add the facility job worker

Runs queued rebuild and projection-retry jobs, bounded at 5 attempts, and
fails an orphaned running job at startup so a crash surfaces as a visible
failed job rather than a row stuck running forever.

Automatic retry preserves the attempt count; the operator's explicit Retry
clears it, so someone who has fixed the underlying cause is not locked out
by a spent budget."
```

### Task 4: Wire the worker into bootstrap

**Files:**
- Modify: `packages/bootstrap/src/index.ts` (near `createTerminologyIngestWorker` at ~`:854`, and the shutdown block at ~`:1480`)
- Modify: `packages/bootstrap/src/index.test.ts`

**Interfaces:**
- Consumes: `createFacilityJobWorker` (Task 3), `createFacilityJobStore` (Task 2).
- Produces: `ctx.facilityJobs: FacilityJobStore` on `AppContext`. Tasks 5–11 read it from context.

- [ ] **Step 1: Write the failing test**

In `packages/bootstrap/src/index.test.ts`:

```ts
it('exposes a facility job store on the context and stops its worker on shutdown', async () => {
  const ctx = await createAppContext(testConfig());
  expect(ctx.facilityJobs).toBeDefined();
  await expect(ctx.shutdown()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts -t "facility job store"
```

Expected: FAIL — `ctx.facilityJobs` is undefined.

- [ ] **Step 3: Wire it**

Add `facilityJobs: FacilityJobStore` to the `AppContext` interface. Construct the store next to the other stores, then the worker alongside `terminologyIngestWorker` (~`:854`), injecting the real runners:

```ts
  const facilityJobs = createFacilityJobStore(internalDb);
  const facilityJobWorker = createFacilityJobWorker({
    jobs: facilityJobs,
    // Bound to the same ReconcileDeps the routes and CLI already build.
    runRebuild: async () => {
      const r = await publishFacilityMap({ internalDb, externalDb, admin: terminologyAdmin }, { apply: true });
      return { written: r.written };
    },
    runProjection: async (registryId) => {
      const row = await internalDb.selectFrom('facility_registry')
        .select(['id', 'name']).where('id', '=', registryId).executeTakeFirst();
      if (row) await projectRegistryRows({ internalDb, admin: terminologyAdmin }, [row]);
    },
    logger,
  });
```

Add `await facilityJobWorker.stop();` to the shutdown block beside `await terminologyIngestWorker.stop();` (~`:1480`).

> ⚠ Use whatever the surrounding code actually names `internalDb`/`externalDb`/`terminologyAdmin` — read the neighbouring worker constructions rather than trusting these identifiers.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/index.ts packages/bootstrap/src/index.test.ts
git commit -m "feat(bootstrap): run the facility job worker in the app context

Exposes facilityJobs on AppContext so routes and the CLI enqueue through one
store, and stops the worker on shutdown alongside the terminology ingest one."
```

---

# Slice 3 — Enqueue at every mutation site

### Task 5: Enqueue a rebuild after facility mutations

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (create ~`:679`, update ~`:753`, delete ~`:796`)
- Modify: `packages/bootstrap/src/facility-import.ts` (~`:307`)
- Test: `apps/server/src/facilities-routes.test.ts`, `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `ctx.facilityJobs` (Task 4).
- Produces: nothing new; the four mutation paths now enqueue.

- [ ] **Step 1: Write the failing tests**

```ts
it('enqueues a rebuild after creating a facility', async () => {
  await createFacility(app, { name: 'Alpha', localCode: 'L-1' });
  const queued = await ctx.facilityJobs.listUnresolved();
  expect(queued.map((j) => j.kind)).toContain('facility-map-rebuild');
});

it('enqueues a rebuild after updating a facility', async () => { /* PUT, same assertion */ });
it('enqueues a rebuild after deleting a facility', async () => { /* DELETE, same assertion */ });

it('⛔ a CSV import of many facilities enqueues exactly ONE rebuild', async () => {
  // Coalescing is the whole point: 14,000 rows must not mean 14,000 jobs.
  await importFacilities(deps, csvWithRows(50), { nationalSystem: 'HFR', apply: true });
  const rebuilds = (await deps.facilityJobs.listUnresolved()).filter((j) => j.kind === 'facility-map-rebuild');
  expect(rebuilds).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t enqueues
pnpm --filter @openldr/bootstrap exec vitest run src/facility-import.test.ts -t "ONE rebuild"
```

Expected: FAIL — `listUnresolved()` returns `[]`.

- [ ] **Step 3: Enqueue at each site**

After each mutation commits (and after the existing inline projection call), add:

```ts
    // The report-facing dimension is now stale. Enqueue rather than rebuild inline: a rebuild talks
    // to the EXTERNAL warehouse, and an operator's facility save must not fail because that
    // warehouse hiccuped. Coalescing means a bulk import enqueues one job, not one per row.
    await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorOf(req) });
```

`facility-import.ts` takes the store through its existing `deps` object — add `facilityJobs?: FacilityJobStore` as an OPTIONAL dep so the CLI and existing tests that omit it keep working, mirroring how `deps.admin` and `deps.capture` are already optional there.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
pnpm --filter @openldr/bootstrap exec vitest run src/facility-import.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts packages/bootstrap/src/facility-import.ts apps/server/src/facilities-routes.test.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(facilities): enqueue a dimension rebuild after every facility mutation

Create, update, delete and CSV import all leave the report-facing dimension
stale. Enqueueing rather than rebuilding inline keeps an operator's save from
failing because the external warehouse hiccuped, and coalescing means a bulk
import enqueues one rebuild rather than one per row."
```

### Task 6: Enqueue a rebuild after mapping mutations

**Files:**
- Modify: `apps/server/src/terminology-admin-routes.ts` (the mapping POST, PUT and DELETE handlers)
- Test: `apps/server/src/terminology-admin-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.facilityJobs`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

```ts
it('enqueues a rebuild when a FACILITY mapping is saved', async () => {
  await saveMapping(app, { toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'L-1', mapType: 'SAME-AS' });
  expect((await ctx.facilityJobs.listUnresolved()).map((j) => j.kind)).toContain('facility-map-rebuild');
});

it('⛔ does NOT enqueue for a non-facility terminology mapping', async () => {
  // This route is shared with generic terminology curation; a LOINC mapping has no bearing on the
  // facility dimension and must not trigger a warehouse rebuild.
  await saveMapping(app, { toSystem: 'http://loinc.org', toCode: '1234-5', mapType: 'SAME-AS' });
  expect(await ctx.facilityJobs.listUnresolved()).toEqual([]);
});

it('enqueues a rebuild when a facility mapping is removed', async () => { /* DELETE, first assertion */ });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/terminology-admin-routes.test.ts -t enqueue
```

Expected: FAIL — nothing enqueued.

- [ ] **Step 3: Enqueue, scoped to facility targets**

This route is shared with generic terminology administration, so gate on the target system. The file already has an `isFacilityTarget` helper (added when the `SAME-AS` boundary check landed) — reuse it rather than re-deriving the predicate:

```ts
    if (isFacilityTarget(input.toSystem)) {
      await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: actorOf(req) });
    }
```

For DELETE, the target system comes from the row being deleted — read it before the delete.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/terminology-admin-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/terminology-admin-routes.ts apps/server/src/terminology-admin-routes.test.ts
git commit -m "feat(facilities): enqueue a dimension rebuild when a facility mapping changes

Scoped with the existing isFacilityTarget helper -- this route is shared with
generic terminology curation, and a LOINC mapping must not trigger a
warehouse rebuild."
```

### Task 7: Durable projection failure and truthful partial success

**Files:**
- Modify: `apps/server/src/facilities-routes.ts` (create and update handlers)
- Test: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- Consumes: `ctx.facilityJobs`, `projectRegistryRows`.
- Produces: create/update responses gain `projection: 'ok' | 'queued-for-retry'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('enqueues a projection retry and reports partial success when the inline projection fails', async () => {
  // projectRegistryRows never throws by contract, so the route cannot detect failure from an
  // exception -- it has to ask whether the concept actually landed.
  breakTerminologyStore(ctx);

  const res = await createFacility(app, { name: 'Alpha', localCode: 'L-1' });

  expect(res.statusCode).toBe(201);
  expect(res.json().projection).toBe('queued-for-retry');
  const jobs = await ctx.facilityJobs.listUnresolved();
  expect(jobs.filter((j) => j.kind === 'registry-projection')).toHaveLength(1);
});

it('reports projection ok on the happy path', async () => {
  const res = await createFacility(app, { name: 'Alpha', localCode: 'L-1' });
  expect(res.json().projection).toBe('ok');
});

it('⛔ a failed projection still does not fail the facility write', async () => {
  breakTerminologyStore(ctx);
  const res = await createFacility(app, { name: 'Alpha', localCode: 'L-1' });
  expect(res.statusCode).toBe(201);
  const rows = await ctx.internalDb.selectFrom('facility_registry').selectAll().execute();
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t projection
```

Expected: FAIL — the response has no `projection` field.

- [ ] **Step 3: Detect and report**

`projectRegistryRows` swallows its own errors by design, so the route must verify the outcome rather than catch an exception. After the inline call, check whether the facility now has a `facility_concept_projection` link:

```ts
    await projectRegistryRows({ internalDb: ctx.internalDb, admin: ctx.terminology.admin }, [{ id: created.id, name: created.name }]);
    // `projectRegistryRows` never throws (that contract is deliberate and unchanged), so a failure
    // is invisible from here as an exception. Ask the durable link table instead: if the row has no
    // projection link, the inline attempt did not land.
    const projected = await ctx.internalDb.selectFrom('facility_concept_projection')
      .select('registry_id').where('registry_id', '=', created.id).executeTakeFirst();
    let projection: 'ok' | 'queued-for-retry' = 'ok';
    if (!projected) {
      await ctx.facilityJobs.enqueue({ kind: 'registry-projection', registryId: created.id, requestedBy: actorOf(req) });
      projection = 'queued-for-retry';
    }
```

Include `projection` in the response body. Do the same in the update handler.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): make a failed projection durable and the response truthful

projectRegistryRows never throws by contract, so a failure was invisible: the
route reported plain success and the facility was missing from the mapping
picker with nothing recording why. The route now checks the projection link
table, enqueues a retry when the concept did not land, and says so in the
response. The write still never fails on a projection error."
```

### Task 8: The end-to-end test that closes FAC-P0-01

**Files:**
- Test: `packages/bootstrap/src/facility-durable-updates.e2e.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: nothing — this task is the proof.

- [ ] **Step 1: Write the failing test**

This is the audit's own acceptance test, and it fails against every version of this code to date.

```ts
it('⛔ saving a mapping reaches an actual report query with NO manual publish anywhere', async () => {
  // The whole point of this slice. Before it, the Observed tab said "mapped" while a report kept
  // using the raw performer string until someone found the hidden Publish menu item.
  const { deps, jobs, worker } = await setupFacilityFixture();
  await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'L-1' });
  await seedPerformer(deps, { sourceSystem: 'webhook-ingest', performer: 'BALAB' });

  // Before mapping: the dimension resolves nothing, so a report falls back to the raw string.
  await worker.tickOnce();
  expect(await facilityNameFromReportQuery(deps, 'BALAB')).toBe('BALAB');

  // The operator maps it. NOTHING ELSE — no publish, no scan.
  await saveFacilityMapping(deps, { fromCode: 'BALAB', toCode: 'L-1' });
  await jobs.enqueue({ kind: 'facility-map-rebuild' });   // as the route does
  await worker.tickOnce();

  expect(await facilityNameFromReportQuery(deps, 'BALAB')).toBe('Alpha Clinic');
});
```

`facilityNameFromReportQuery` must run the SAME join a seeded report uses — copy it from
`packages/reporting/src/seed/report-seeds.ts` (`left join facility_map fm on fm.source_system = coalesce(dr.source_system,'') and fm.source_code = dr.performer`, selecting `coalesce(fm.name, dr.performer_display, dr.performer)`). Asserting against a hand-written join that differs from the shipped one would prove nothing.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-durable-updates.e2e.test.ts
```

Expected: FAIL on the final assertion with `expected 'BALAB' to be 'Alpha Clinic'` if the enqueue/worker wiring is wrong. Confirm the failure is that assertion, not a setup error.

- [ ] **Step 3: Fix whatever it exposes**

If it already passes given Tasks 1–7, keep it and label it a pinned regression test in a comment saying so explicitly — do not manufacture a failure or delete it as redundant. Its value is that it fails loudly if any future change reintroduces the manual step.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/facility-durable-updates.e2e.test.ts
git commit -m "test(facilities): prove a mapping reaches a report with no manual publish

The audit's own acceptance criterion, asserted through the same facility_map
join the seeded reports use rather than a hand-written one."
```

---

# Slice 4 — The health surface

### Task 9: Health state computation

**Files:**
- Create: `packages/bootstrap/src/facility-health.ts`
- Create: `packages/bootstrap/src/facility-health.test.ts`

**Interfaces:**
- Consumes: `FacilityJobStore`.
- Produces:
  ```ts
  export type FacilityDimensionState = 'current' | 'updating' | 'failed' | 'stale';
  export interface FacilityHealth {
    reportDimension: { state: FacilityDimensionState; lastSuccessAt: string | null; rows: number | null; error: string | null };
    projection: { failedCount: number };
  }
  export async function facilityHealth(deps: { internalDb: Kysely<InternalSchema>; jobs: FacilityJobStore }): Promise<FacilityHealth>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { makeMigratedDb } from '@openldr/db/…'; // same import path the other bootstrap tests use
import { createFacilityJobStore } from '@openldr/db';
import { facilityHealth } from './facility-health';

const REBUILD = 'facility-map-rebuild' as const;

/** Finish one rebuild successfully and return the deps the health function takes. */
async function withCompletedRebuild(rows = 88) {
  const internalDb = await makeMigratedDb();
  const jobs = createFacilityJobStore(internalDb);
  await jobs.enqueue({ kind: REBUILD });
  const claimed = await jobs.claimNext();
  await jobs.finish(claimed!.id, 'done', { resultCount: rows });
  return { internalDb, jobs };
}

describe('facilityHealth', () => {
  it('reports current when the last rebuild is newer than the last mutation', async () => {
    const deps = await withCompletedRebuild();
    const health = await facilityHealth(deps);
    expect(health.reportDimension).toMatchObject({ state: 'current', rows: 88, error: null });
    expect(health.reportDimension.lastSuccessAt).not.toBeNull();
  });

  it('reports updating while a job is queued', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    expect((await facilityHealth(deps)).reportDimension.state).toBe('updating');
  });

  it('reports updating while a job is running', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    await deps.jobs.claimNext();
    expect((await facilityHealth(deps)).reportDimension.state).toBe('updating');
  });

  it('reports failed with the error when the last attempt failed', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: REBUILD });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'warehouse unreachable' });

    expect((await facilityHealth(deps)).reportDimension).toMatchObject({
      state: 'failed', error: 'warehouse unreachable',
    });
  });

  it('⛔ keeps the last known good build time and row count while showing Failed', async () => {
    // A Failed chip that also blanks "last current at" tells the operator nothing about how stale
    // their reports actually are. Deriving lastSuccess from the LATEST job would do exactly that.
    const deps = await withCompletedRebuild(88);
    await deps.jobs.enqueue({ kind: REBUILD });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'warehouse unreachable' });

    const { reportDimension } = await facilityHealth(deps);
    expect(reportDimension.state).toBe('failed');
    expect(reportDimension.lastSuccessAt).not.toBeNull();
    expect(reportDimension.rows).toBe(88);
  });

  it('reports stale when a mutation is newer than the last success and no job is pending', async () => {
    // A safety net that should never appear in practice — every mutation site enqueues. It is
    // rendered because a state that cannot be displayed cannot be diagnosed.
    const deps = await withCompletedRebuild();
    await deps.internalDb.insertInto('facility_registry').values({
      id: 'fac-A', name: 'Alpha', local_code: 'L-1', source: 'manual',
      updated_at: sql`now() + interval '1 hour'`,
    } as never).execute();

    expect((await facilityHealth(deps)).reportDimension.state).toBe('stale');
  });

  it('counts failed projection retries separately from the dimension state', async () => {
    const deps = await withCompletedRebuild();
    await deps.jobs.enqueue({ kind: 'registry-projection', registryId: 'fac-A' });
    const claimed = await deps.jobs.claimNext();
    await deps.jobs.finish(claimed!.id, 'failed', { error: 'boom' });

    const health = await facilityHealth(deps);
    expect(health.projection.failedCount).toBe(1);
    // A failed PROJECTION must not make the DIMENSION read as failed — they are separate signals,
    // and conflating them would tell an operator their reports are stale when they are not.
    expect(health.reportDimension.state).toBe('current');
  });
});
```

> ⚠ The last test pins a real trap: `latest(kind)` is queried per-kind, so a failed
> `registry-projection` must not leak into `reportDimension.state`. An implementation that asks
> "is any job failed?" passes every other test here and fails this one.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-health.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Resolve what the Facilities chip shows.
 *
 * "The last mutation" is max() over `facility_registry.updated_at` and `term_mappings.updated_at` —
 * the two tables whose contents determine what a rebuild would produce. Both already carry
 * `updated_at`, so this needs no new bookkeeping and cannot drift from the thing it describes.
 */
export async function facilityHealth(deps: { internalDb: Kysely<InternalSchema>; jobs: FacilityJobStore }): Promise<FacilityHealth> {
  const pending = await deps.jobs.listUnresolved();
  const latest = await deps.jobs.latest('facility-map-rebuild');
  const failedProjections = await deps.jobs.countFailed('registry-projection');

  const lastRegistry = await deps.internalDb.selectFrom('facility_registry')
    .select((eb) => eb.fn.max('updated_at').as('t')).executeTakeFirst();
  const lastMapping = await deps.internalDb.selectFrom('term_mappings')
    .select((eb) => eb.fn.max('updated_at').as('t')).executeTakeFirst();
  const lastMutation = [lastRegistry?.t, lastMapping?.t]
    .filter((d): d is Date => d != null)
    .reduce<Date | null>((m, d) => (m == null || d > m ? d : m), null);

  // ⛔ The last SUCCESSFUL rebuild, queried independently of `latest`. Deriving it as
  // `latest?.status === 'done' ? latest : null` would blank `lastSuccessAt` and `rows` the moment a
  // retry fails — losing "last known good" exactly when a Failed chip most needs to show it.
  const successRow = await deps.internalDb.selectFrom('facility_jobs').selectAll()
    .where('kind', '=', 'facility-map-rebuild').where('status', '=', 'done')
    .orderBy('finished_at', 'desc').limit(1).executeTakeFirst();
  const lastSuccess = successRow
    ? { finishedAt: new Date(successRow.finished_at as Date).toISOString(), resultCount: successRow.result_count }
    : null;

  let state: FacilityDimensionState;
  if (pending.some((j) => j.kind === 'facility-map-rebuild')) state = 'updating';
  else if (latest?.status === 'failed') state = 'failed';
  else if (lastSuccess && (!lastMutation || new Date(lastSuccess.finishedAt) >= lastMutation)) state = 'current';
  else state = 'stale';

  return {
    reportDimension: {
      state,
      // Populated even when `state === 'failed'` — see the query above.
      lastSuccessAt: lastSuccess?.finishedAt ?? null,
      rows: lastSuccess?.resultCount == null ? null : Number(lastSuccess.resultCount),
      error: latest?.status === 'failed' ? latest.lastError : null,
    },
    projection: { failedCount: failedProjections },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/bootstrap exec vitest run src/facility-health.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/facility-health.ts packages/bootstrap/src/facility-health.test.ts
git commit -m "feat(facilities): resolve the report-dimension health state

Current / Updating / Failed / Stale, where the last mutation is max() over
facility_registry.updated_at and term_mappings.updated_at -- the two tables
whose contents determine what a rebuild would produce, so the comparison
cannot drift from the thing it describes."
```

### Task 10: Health route and CLI parity

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Modify: `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts`
- Test: `apps/server/src/facilities-routes.test.ts`, `packages/cli/src/facilities.test.ts`

**Interfaces:**
- Consumes: `facilityHealth` (Task 9), `ctx.facilityJobs`.
- Produces: `GET /api/facilities/health` (gated `facilities.view`), `POST /api/facilities/jobs/:id/retry` (gated `facilities.manage`), and `openldr facilities jobs [--retry <id>]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('GET /api/facilities/health returns the dimension state', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/facilities/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json().reportDimension).toMatchObject({ state: expect.any(String) });
});

it('health is gated on facilities.view', async () => { /* expect 403 without the capability */ });

it('POST /api/facilities/jobs/:id/retry re-queues a failed job', async () => {
  const { job } = await ctx.facilityJobs.enqueue({ kind: 'facility-map-rebuild' });
  const claimed = await ctx.facilityJobs.claimNext();
  await ctx.facilityJobs.finish(claimed!.id, 'failed', { error: 'boom' });

  const res = await app.inject({ method: 'POST', url: `/api/facilities/jobs/${claimed!.id}/retry` });

  expect(res.statusCode).toBe(200);
  expect((await ctx.facilityJobs.latest('facility-map-rebuild'))?.status).toBe('queued');
});

it('retry is gated on facilities.manage', async () => { /* expect 403 with only .view */ });
```

CLI test: `openldr facilities jobs` prints the state, and `--retry <id>` re-queues.

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts -t health
pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts -t jobs
```

Expected: FAIL — 404 on both routes; no such CLI command.

- [ ] **Step 3: Add the routes and command**

Register both routes using the file's existing `VIEW`/`MANAGE` permission constants — do not invent a new gating pattern. Note that a static segment beats a parametric one in find-my-way regardless of registration order, so `/api/facilities/health` needs no ordering care relative to `/api/facilities/:id`; the file documents this at the `mapping-conflicts` route.

Add `openldr facilities jobs` to the existing `facilities` command group, matching how `conflicts` is registered.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/server exec vitest run src/facilities-routes.test.ts
pnpm --filter @openldr/cli exec vitest run src/facilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/facilities-routes.ts packages/cli/src/facilities.ts packages/cli/src/program.ts apps/server/src/facilities-routes.test.ts packages/cli/src/facilities.test.ts
git commit -m "feat(facilities): expose report-dimension health and job retry

Route plus CLI parity, so an operator can see whether their mapping has
reached reports and retry a failed rebuild without shell access to the
database."
```

### Task 11: The Facilities health chip

**Files:**
- Modify: `apps/studio/src/pages/Facilities.tsx`, `apps/studio/src/api.ts`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`
- Test: `apps/studio/src/pages/Facilities.test.tsx`

**Interfaces:**
- Consumes: `GET /api/facilities/health`, `POST /api/facilities/jobs/:id/retry` (Task 10).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

```ts
it('shows Current with the last build time', async () => {
  renderFacilities({ health: { reportDimension: { state: 'current', lastSuccessAt: '2026-08-08T10:00:00Z', rows: 88, error: null }, projection: { failedCount: 0 } } });
  expect(await screen.findByText(/report facility data.*current/i)).toBeInTheDocument();
});

it('shows Updating while a rebuild is queued', async () => { /* state: 'updating' */ });

it('shows Failed with a Retry action', async () => {
  renderFacilities({ health: { reportDimension: { state: 'failed', lastSuccessAt: null, rows: null, error: 'warehouse unreachable' }, projection: { failedCount: 0 } } });
  expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
});

it('surfaces a failed projection count', async () => { /* projection.failedCount: 2 */ });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx -t "report facility data"
```

Expected: FAIL — no such text.

- [ ] **Step 3: Render the chip**

Add a chip in the Facilities page header showing the four states with an icon AND a text label (status must never be conveyed by colour alone), the last successful build time, and a Retry action when failed. Use the existing shadcn `Badge`/`Button` primitives already used on that page. Every string from i18n in all three of `en.ts`, `fr.ts`, `pt.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @openldr/studio exec vitest run src/pages/Facilities.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit and gate**

```bash
git add apps/studio/src/pages/Facilities.tsx apps/studio/src/api.ts apps/studio/src/i18n apps/studio/src/pages/Facilities.test.tsx
git commit -m "feat(facilities): show report-dimension freshness on the Facilities page

Current / Updating / Failed / Stale with the last successful build time and a
Retry action, so an operator can tell whether their mapping has reached
reports instead of assuming it has."
pnpm turbo run typecheck test --force > /tmp/gate-durable.log 2>&1; echo "exit=$?"
```

Expected: `exit=0`.

---

## Self-review notes

**Spec coverage.** `facility_jobs` + `active_key` semantics → Tasks 1–2. Worker + crash recovery + bounded retry → Tasks 3–4. Enqueue at every mutation site, inline projection retained, truthful partial success → Tasks 5–7. The audit's end-to-end acceptance test → Task 8. Health states incl. `Stale`, chip, Retry, CLI parity → Tasks 9–11. Every acceptance criterion in the spec maps to at least one test.

**Known gaps carried forward, not closed here.** FAC-P0-07 (`facility_map`'s key omits the observed coding namespace) has its own spec pending. `facilities repair-links` and a settle path for `facility_mapping_conflicts.resolved_at` remain open from the previous workstream.
