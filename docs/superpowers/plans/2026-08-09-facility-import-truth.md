# A2a — the facility importer tells the truth (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `importFacilities` report what an import will actually do to the registry — real
create/changed/unchanged/conflict/absent/invalid/unmapped counts with samples — and refuse to write
coordinates it cannot validate.

**Architecture:** Preview and apply become the *same computation* inside the one
`importFacilities` function, differing only in whether the transaction commits. The dry-run early
return is deleted. A new `facility_import_runs` table makes each preview durable so apply can be
linked to it (which is what makes conflict detection possible) and so "who imported which release
and when" is recorded. Controlled fields resolve through the **already-seeded** vocabularies via
`term_mappings`; nothing new is seeded.

**Tech Stack:** TypeScript, Kysely, Postgres (internal DB — always Postgres, no dialect matrix),
Vitest, pg-mem for unit tests plus `TARGET_DATABASE_URL`-gated real-Postgres tests, React + i18next
for the studio, Commander for the CLI.

**Spec:** `docs/superpowers/specs/2026-08-09-facility-import-pipeline-design.md`
**Branch:** `slice/facility-import-truth` (already exists, carries the two spec commits).
**Scope:** FAC-P1-03 and FAC-P1-05. **A2b (FAC-P1-02) is a separate plan written after this merges.**

## Global Constraints

- **`facility_registry` and `facility_import_runs` are INTERNAL ⇒ always Postgres.**
  `internalMigrations` takes no engine argument. **Do not add dialect branching.**
- **Next internal migration number is `080`.** 079 is the highest that exists.
- **Seed no vocabulary.** `status` (`urn:openldr:valueset:location-status`, 3 codes),
  `level` (`urn:openldr:valueset:facility-type`, 63 codes) and `country`
  (`urn:openldr:valueset:country`, 249 alpha-3 codes) are already seeded by migrations 072/073.
- **Retirement writes `status = 'inactive'`.** HL7 owns the status CodeSystem and it has no
  `retired` code.
- ⛔ **Every action control lives in a `⋯` `DropdownMenu`.** No standalone or footer buttons.
  Form fields are label-left / input-right.
- ⛔ **Never `git add -A`** — this working directory is shared with concurrent sessions. Stage
  named paths only.
- ⛔ **Never add a `Co-Authored-By` trailer.**
- ⛔ **Never revert a mutation with `git checkout -- <file>`.** Use in-place reverse edits.
- **Gate:** `pnpm turbo run typecheck test --force`. **Never pipe turbo through `tail`.**
  Whole-package vitest runs need `--testTimeout=30000`.
- **i18n parity is enforced by a test.** Any new key must be added to `en.ts`, `fr.ts` **and**
  `pt.ts` in the same commit or `apps/studio/src/i18n/parity.test.ts` fails.

## Known test-oracle hazards (read before writing any test)

- **pg-mem has ZERO correlated-subquery support.** Uncorrelated subqueries and `UPDATE ... FROM`
  work. Five variants of a correlated one fail `column "t1.k" does not exist`.
- **pg-mem does not roll back on a thrown error.** Do not write a rollback assertion; state the
  limit in a comment instead.
- **pg-mem returns `numInsertedOrUpdatedRows: 1` for a skipped `onConflict().doNothing()`.**
- **pg-mem's insertion order is load-bearing and its scan order is stable**, so it can never
  demonstrate a missing `ORDER BY` tiebreaker. Any `ORDER BY` + `OFFSET` still needs one.
- **A mutation that ERRORS proves nothing about a SILENT defect.** Write each mutation as the
  plausible *wrong implementation*, not a broken edit.
- **A guard whose first assertion throws leaves the later ones unproven.** Split them.

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `packages/db/src/migrations/internal/080_facility_import_runs.ts` | The `facility_import_runs` table + indexes. Table only — no terminology resource, so no change-log seeding. |
| `packages/db/src/migrations/internal/080_facility_import_runs.test.ts` | Migration shape assertions. |
| `packages/db/src/facility-import-run-store.ts` | CRUD over `facility_import_runs`. |
| `packages/db/src/facility-import-run-store.test.ts` | Store behaviour. |
| `packages/terminology/src/facility-release.ts` | JSONL release parsing (`meta`/`row`/`deletion`) onto the same `FacilityRecord` shape `facility-csv.ts` produces. |
| `packages/terminology/src/facility-release.test.ts` | JSONL parsing + line-numbered rejection. |
| `packages/bootstrap/src/facility-controlled-fields.ts` | Resolve `level`/`status`/`country` through `term_mappings` against the seeded value sets. |
| `packages/bootstrap/src/facility-controlled-fields.test.ts` | Mapping resolution + unmapped reporting. |
| `packages/bootstrap/src/facility-classify.ts` | Pure classification of parsed records against existing rows. No DB access. |
| `packages/bootstrap/src/facility-classify.test.ts` | Classification, including the extras/jsonb key-order case. |
| `packages/bootstrap/src/facility-import-live.test.ts` | `TARGET_DATABASE_URL`-gated real-Postgres classification test. |

**Modify:**

| Path | Change |
|---|---|
| `packages/terminology/src/facility-csv.ts` | `num()` splits into strict numeric + range + pair validation producing `RowError`s. |
| `packages/bootstrap/src/facility-import.ts` | Delete the dry-run early return; wire classification, controlled fields, absent/deleted, retirement, conflict watermark; reshape `FacilityImportResult`. |
| `packages/db/src/schema/internal.ts` | `FacilityImportRunsTable` + registration in `InternalSchema`. |
| `packages/db/src/index.ts` | Export the new store and types. |
| `packages/db/src/migrations/internal/index.ts` | Register 080. |
| `apps/server/src/facilities-routes.ts` | Preview returns `runId`; apply accepts it and the option set; `GET /api/facilities/import/runs`. |
| `apps/studio/src/api.ts` | Request/response types for the reshaped result. |
| `apps/studio/src/facilities/ImportFacilitiesSheet.tsx` | Render the reconciliation summary. |
| `apps/studio/src/i18n/{en,fr,pt}.ts` | New keys, all three locales. |
| `packages/cli/src/facilities.ts`, `packages/cli/src/program.ts` | New flags + `import-runs` subcommand. |

---

### Task 1: `facility_import_runs` migration and schema type

**Files:**
- Create: `packages/db/src/migrations/internal/080_facility_import_runs.ts`
- Create: `packages/db/src/migrations/internal/080_facility_import_runs.test.ts`
- Modify: `packages/db/src/schema/internal.ts`
- Modify: `packages/db/src/migrations/internal/index.ts`

**Interfaces:**
- Produces: table `facility_import_runs`; `FacilityImportRunsTable` on `InternalSchema` under key
  `facility_import_runs`.

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/migrations/internal/080_facility_import_runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../../schema/internal';

describe('080_facility_import_runs', () => {
  it('creates a run row and defaults its counters', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    await db.insertInto('facility_import_runs').values({
      id: 'fir_1', national_system: 'urn:tz:hfr', source_format: 'csv',
      file_hash: 'abc', byte_size: 10, status: 'previewed', options: {} as never,
    }).execute();
    const row = await db.selectFrom('facility_import_runs').selectAll().executeTakeFirstOrThrow();
    expect(row.processed).toBe(0);
    expect(row.cancel_requested).toBe(false);
    expect(row.previewed_at).toBeNull();
  });

  it('permits many terminal runs for one national_system but only one active', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const base = { national_system: 'urn:tz:hfr', source_format: 'csv', file_hash: 'h', byte_size: 1, options: {} as never };
    await db.insertInto('facility_import_runs').values([
      { ...base, id: 'fir_a', status: 'applied', active_key: null },
      { ...base, id: 'fir_b', status: 'applied', active_key: null },
    ]).execute();
    await db.insertInto('facility_import_runs').values({ ...base, id: 'fir_c', status: 'previewed', active_key: 'urn:tz:hfr' }).execute();
    await expect(
      db.insertInto('facility_import_runs').values({ ...base, id: 'fir_d', status: 'previewed', active_key: 'urn:tz:hfr' }).execute(),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/db && npx vitest run src/migrations/internal/080_facility_import_runs.test.ts`
Expected: FAIL — `facility_import_runs` does not exist.

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/internal/080_facility_import_runs.ts`:

```ts
import { type Kysely, sql } from 'kysely';

// One durable record per facility import — FAC-P1-03's "record file hash, source release, row count,
// actor and result", and (in A2b) the job row a background import is claimed from. Modelled on
// `terminology_ingest_jobs` (061), NOT on `facility_jobs` (079): 079 coalesces on the job KIND, which
// is right for an interchangeable whole-dimension rebuild and catastrophically wrong here — two
// uploaded registers would collapse into one row and one operator's file would vanish.
//
// ⛔ Plain (not partial) unique index on `active_key`, for the reason 061 and 079 both document at
// length: pg-mem's planner mishandles partial indexes — once a row's status leaves the predicate it
// is excluded from ANY later query filtering on the indexed column. NULLs are distinct in Postgres,
// so many terminal rows coexist while at most one active row per national_system is permitted.
//
// This migration creates a TABLE ONLY. It seeds no terminology resource, so none of 072/073's
// `seedHistoryAndChangeLog` machinery applies — see the spec's note on the change-log blast radius.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_import_runs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('national_system', 'text', (c) => c.notNull())
    .addColumn('source_format', 'text', (c) => c.notNull())
    // Populated by A2b's upload. NULL for an A2a preview/apply, which holds the CSV in the request.
    .addColumn('blob_key', 'text')
    .addColumn('file_hash', 'text', (c) => c.notNull())
    .addColumn('byte_size', 'bigint', (c) => c.notNull())
    // From a JSONL release header, or typed by the operator for a CSV. NULL when neither supplied one.
    .addColumn('release_version', 'text')
    .addColumn('release_published_at', 'timestamptz')
    // The release's OWN claim about its size, cross-checked against what was parsed.
    .addColumn('declared_row_count', 'integer')
    .addColumn('declared_deletion_count', 'integer')
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('phase', 'text')
    .addColumn('processed', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total', 'integer')
    // ⛔ The conflict watermark: when the preview READ the registry. Apply compares each existing
    // row's `updated_at` against this. NULL until the preview completes.
    .addColumn('previewed_at', 'timestamptz')
    .addColumn('summary', 'jsonb')
    .addColumn('result_blob_key', 'text')
    .addColumn('options', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('error', 'text')
    .addColumn('cancel_requested', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('requested_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('active_key', 'text')
    .execute();

  await sql`create unique index facility_import_runs_one_active on facility_import_runs (active_key)`.execute(db);

  await db.schema.createIndex('facility_import_runs_system_created')
    .on('facility_import_runs').columns(['national_system', 'created_at']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_import_runs').execute();
}
```

- [ ] **Step 4: Add the schema type**

In `packages/db/src/schema/internal.ts`, after `FacilityJobsTable`:

```ts
/** One durable record per facility import (FAC-P1-03). Also the job row a background import is
 *  claimed from in A2b. ⛔ `active_key` holds `national_system` while a run is active and is NULL
 *  once terminal — see migration 080 for why it is a plain, not partial, unique index, and why this
 *  deliberately does NOT copy `facility_jobs`' coalesce-on-kind identity. */
export interface FacilityImportRunsTable {
  id: string;
  national_system: string;
  source_format: string;
  blob_key: string | null;
  file_hash: string;
  byte_size: number;
  release_version: string | null;
  release_published_at: Date | null;
  declared_row_count: number | null;
  declared_deletion_count: number | null;
  status: string;
  phase: string | null;
  processed: Generated<number>;
  total: number | null;
  /** ⛔ The conflict watermark. `timestamptz` — the driver returns a `Date`. Never compare as a
   *  string; see `facility-job-store.ts`, which normalises every read through `new Date(...)`. */
  previewed_at: Date | null;
  summary: unknown;
  result_blob_key: string | null;
  options: unknown;
  error: string | null;
  cancel_requested: Generated<boolean>;
  requested_by: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  active_key: string | null;
}
```

And register it in the `InternalSchema` interface next to `facility_jobs`:

```ts
  facility_import_runs: FacilityImportRunsTable;
```

- [ ] **Step 5: Register the migration**

In `packages/db/src/migrations/internal/index.ts`, add the 080 entry following the exact shape the
079 entry uses in that file (import + map key `'080_facility_import_runs'`).

- [ ] **Step 6: Run the test — expect PASS**

Run: `cd packages/db && npx vitest run src/migrations/internal/080_facility_import_runs.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Mutation-prove the unique index**

Delete the `create unique index` line, re-run. Expected: the second test FAILS (the duplicate insert
resolves instead of rejecting). Restore the line in place — **do not** `git checkout` the file.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/internal/080_facility_import_runs.ts packages/db/src/migrations/internal/080_facility_import_runs.test.ts packages/db/src/migrations/internal/index.ts packages/db/src/schema/internal.ts
git commit -m "feat(facilities): add facility_import_runs, the durable record of an import"
```

---

### Task 2: the import-run store

**Files:**
- Create: `packages/db/src/facility-import-run-store.ts`
- Create: `packages/db/src/facility-import-run-store.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `facility_import_runs` (Task 1).
- Produces:

```ts
export interface FacilityImportRun {
  id: string; nationalSystem: string; sourceFormat: 'csv' | 'jsonl';
  fileHash: string; byteSize: number;
  releaseVersion: string | null; releasePublishedAt: string | null;
  declaredRowCount: number | null; declaredDeletionCount: number | null;
  status: FacilityImportRunStatus;
  previewedAt: string | null;
  summary: unknown; options: unknown; error: string | null;
  requestedBy: string | null; createdAt: string; finishedAt: string | null;
}
export type FacilityImportRunStatus = 'previewed' | 'applied' | 'failed';

export interface FacilityImportRunStore {
  startPreview(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; fileHash: string; byteSize: number;
    releaseVersion?: string | null; releasePublishedAt?: string | null;
    declaredRowCount?: number | null; declaredDeletionCount?: number | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  /** Stamps `previewed_at` and stores the summary. The timestamp is the DB's `now()`, never the
   *  application clock — apply compares it against `facility_registry.updated_at`, also DB-set. */
  completePreview(id: string, summary: unknown): Promise<FacilityImportRun>;
  finishApply(id: string, status: 'applied' | 'failed', opts: { summary?: unknown; error?: string | null }): Promise<void>;
  get(id: string): Promise<FacilityImportRun | null>;
  list(nationalSystem?: string, limit?: number): Promise<FacilityImportRun[]>;
}
export function createFacilityImportRunStore(db: Kysely<InternalSchema>): FacilityImportRunStore;
```

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/facility-import-run-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityImportRunStore } from './facility-import-run-store';
import type { InternalSchema } from './schema/internal';

const base = { nationalSystem: 'urn:tz:hfr', sourceFormat: 'csv' as const, fileHash: 'h1', byteSize: 42, options: {} };

describe('createFacilityImportRunStore', () => {
  it('startPreview leaves previewedAt null; completePreview sets it and the summary', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const run = await store.startPreview(base);
    expect(run.previewedAt).toBeNull();
    expect(run.status).toBe('previewed');

    const done = await store.completePreview(run.id, { create: 3 });
    expect(done.previewedAt).not.toBeNull();
    expect(done.summary).toEqual({ create: 3 });
  });

  it('refuses a second active run for the same national system', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    await store.startPreview(base);
    await expect(store.startPreview(base)).rejects.toThrow(/already/i);
  });

  it('a finished run frees the national system for the next import', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const first = await store.startPreview(base);
    await store.finishApply(first.id, 'applied', { summary: { create: 1 } });
    const second = await store.startPreview(base);
    expect(second.id).not.toBe(first.id);
  });

  it('list orders newest first with a unique tiebreaker', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const store = createFacilityImportRunStore(db);
    const a = await store.startPreview(base);
    await store.finishApply(a.id, 'applied', {});
    const b = await store.startPreview({ ...base, fileHash: 'h2' });
    await store.finishApply(b.id, 'applied', {});
    const rows = await store.list('urn:tz:hfr');
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/db && npx vitest run src/facility-import-run-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/db/src/facility-import-run-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from './schema/internal';

export type FacilityImportRunStatus = 'previewed' | 'applied' | 'failed';

export interface FacilityImportRun {
  id: string; nationalSystem: string; sourceFormat: 'csv' | 'jsonl';
  fileHash: string; byteSize: number;
  releaseVersion: string | null; releasePublishedAt: string | null;
  declaredRowCount: number | null; declaredDeletionCount: number | null;
  status: FacilityImportRunStatus;
  previewedAt: string | null;
  summary: unknown; options: unknown; error: string | null;
  requestedBy: string | null; createdAt: string; finishedAt: string | null;
}

export interface FacilityImportRunStore {
  startPreview(input: {
    nationalSystem: string; sourceFormat: 'csv' | 'jsonl'; fileHash: string; byteSize: number;
    releaseVersion?: string | null; releasePublishedAt?: string | null;
    declaredRowCount?: number | null; declaredDeletionCount?: number | null;
    options: unknown; requestedBy?: string | null;
  }): Promise<FacilityImportRun>;
  completePreview(id: string, summary: unknown): Promise<FacilityImportRun>;
  finishApply(id: string, status: 'applied' | 'failed', opts: { summary?: unknown; error?: string | null }): Promise<void>;
  get(id: string): Promise<FacilityImportRun | null>;
  list(nationalSystem?: string, limit?: number): Promise<FacilityImportRun[]>;
}

// ⛔ `timestamptz` columns come back as `Date` from node-postgres even where a sibling schema type
// declares `string` (FacilityRegistryTable does exactly that). `new Date(x)` accepts both, so this
// is the only safe normalisation — the same idiom `facility-job-store.ts` uses on every read.
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string | Date).toISOString());

function toRun(r: Record<string, unknown>): FacilityImportRun {
  return {
    id: r.id as string,
    nationalSystem: r.national_system as string,
    sourceFormat: r.source_format as 'csv' | 'jsonl',
    fileHash: r.file_hash as string,
    byteSize: Number(r.byte_size),
    releaseVersion: (r.release_version as string | null) ?? null,
    releasePublishedAt: iso(r.release_published_at),
    declaredRowCount: r.declared_row_count == null ? null : Number(r.declared_row_count),
    declaredDeletionCount: r.declared_deletion_count == null ? null : Number(r.declared_deletion_count),
    status: r.status as FacilityImportRunStatus,
    previewedAt: iso(r.previewed_at),
    summary: r.summary ?? null,
    options: r.options ?? {},
    error: (r.error as string | null) ?? null,
    requestedBy: (r.requested_by as string | null) ?? null,
    createdAt: iso(r.created_at) as string,
    finishedAt: iso(r.finished_at),
  };
}

export function createFacilityImportRunStore(db: Kysely<InternalSchema>): FacilityImportRunStore {
  const byId = async (id: string) =>
    db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  return {
    async startPreview(input) {
      // Explicit pre-check so a concurrent second import fails with a readable message; the unique
      // index on `active_key` (migration 080) is the race-safe backstop. Same two-layer shape as
      // `terminology-ingest-job-store.ts`'s `hasActive` + index.
      const active = await db.selectFrom('facility_import_runs').select('id')
        .where('active_key', '=', input.nationalSystem).executeTakeFirst();
      if (active) throw new Error(`an import is already in progress for "${input.nationalSystem}"`);

      const id = `fir_${randomUUID()}`;
      await db.insertInto('facility_import_runs').values({
        id,
        national_system: input.nationalSystem,
        source_format: input.sourceFormat,
        file_hash: input.fileHash,
        byte_size: input.byteSize,
        release_version: input.releaseVersion ?? null,
        release_published_at: (input.releasePublishedAt ? new Date(input.releasePublishedAt) : null) as never,
        declared_row_count: input.declaredRowCount ?? null,
        declared_deletion_count: input.declaredDeletionCount ?? null,
        status: 'previewed',
        options: JSON.stringify(input.options) as never,
        requested_by: input.requestedBy ?? null,
        active_key: input.nationalSystem,
      } as never).execute();
      return toRun(await byId(id) as never);
    },

    async completePreview(id, summary) {
      // ⛔ `now()` — the DATABASE clock, deliberately, not the application's. This timestamp is
      // compared against `facility_registry.updated_at`, which is also written by `now()`. Mixing an
      // application clock in would make the comparison depend on host clock skew, and skew in one
      // direction silently hides real conflicts.
      await db.updateTable('facility_import_runs')
        .set({ previewed_at: sql`now()` as never, summary: JSON.stringify(summary) as never })
        .where('id', '=', id).execute();
      return toRun(await byId(id) as never);
    },

    async finishApply(id, status, opts) {
      await db.updateTable('facility_import_runs')
        .set({
          status,
          error: opts.error ?? null,
          finished_at: sql`now()` as never,
          ...(opts.summary === undefined ? {} : { summary: JSON.stringify(opts.summary) as never }),
          // Clearing the key is what stops a terminal row holding its national system for good.
          active_key: null,
        } as never)
        .where('id', '=', id).execute();
    },

    async get(id) {
      const r = await db.selectFrom('facility_import_runs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? toRun(r as never) : null;
    },

    async list(nationalSystem, limit = 50) {
      let q = db.selectFrom('facility_import_runs').selectAll();
      if (nationalSystem) q = q.where('national_system', '=', nationalSystem);
      // ⛔ `id` tiebreaker is REQUIRED, not cosmetic: `created_at` defaults to now(), which is
      // TRANSACTION time in Postgres, so rows created in one transaction tie and the winner would
      // otherwise be engine-dependent. pg-mem's scan order is stable and will never show this.
      return (await q.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute())
        .map((r) => toRun(r as never));
    },
  };
}
```

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts`, alongside the `createFacilityJobStore` export line:

```ts
export { createFacilityImportRunStore, type FacilityImportRun, type FacilityImportRunStore, type FacilityImportRunStatus } from './facility-import-run-store';
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `cd packages/db && npx vitest run src/facility-import-run-store.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Mutation-prove the `active_key` clear**

In `finishApply`, change `active_key: null` to `active_key: sql\`active_key\` as never` (the
plausible wrong implementation — a writer that simply forgets to release the key rather than one
that crashes). Re-run. Expected: the third test FAILS. Restore in place.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/facility-import-run-store.ts packages/db/src/facility-import-run-store.test.ts packages/db/src/index.ts
git commit -m "feat(facilities): add the import-run store"
```

---

### Task 3: strict coordinate validation

**Files:**
- Modify: `packages/terminology/src/facility-csv.ts:53-63` (the `num` helper) and the record loop
- Modify: `packages/terminology/src/facility-csv.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RowError {
  line: number;
  field: 'latitude' | 'longitude';
  reason: 'not_a_number' | 'out_of_range' | 'incomplete_pair';
  /** The offending value exactly as it appeared, so an operator can find it in their file. */
  raw: string;
}
// FacilityCsvResult gains:  invalid: RowError[]
```

A row with any `RowError` is **excluded from `records`** and is **not** counted in `skipped`
(`skipped` keeps its existing meaning: a well-formed row missing a REQUIRED value).

- [ ] **Step 1: Write the failing tests**

Append to `packages/terminology/src/facility-csv.test.ts`:

```ts
describe('coordinate validation', () => {
  const H = 'national_code,name,latitude,longitude';
  const parse = (rows: string[]) => parseFacilityCsv([H, ...rows].join('\n') + '\n', { nationalSystem: 'S' });

  it('rejects a non-numeric coordinate with a row error instead of silently nulling it', () => {
    const r = parse(['1,Alpha,N/A,35.0']);
    expect(r.records).toHaveLength(0);
    expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'not_a_number', raw: 'N/A' }]);
  });

  it('rejects an out-of-range latitude', () => {
    const r = parse(['1,Alpha,91,35.0']);
    expect(r.invalid).toEqual([{ line: 2, field: 'latitude', reason: 'out_of_range', raw: '91' }]);
  });

  it('rejects an out-of-range longitude', () => {
    const r = parse(['1,Alpha,-2.4,181']);
    expect(r.invalid).toEqual([{ line: 2, field: 'longitude', reason: 'out_of_range', raw: '181' }]);
  });

  it('rejects half a coordinate pair', () => {
    const r = parse(['1,Alpha,-2.4,']);
    expect(r.invalid).toEqual([{ line: 2, field: 'longitude', reason: 'incomplete_pair', raw: '' }]);
  });

  it('accepts both coordinates absent, and accepts the boundary values', () => {
    expect(parse(['1,Alpha,,']).invalid).toEqual([]);
    expect(parse(['1,Alpha,,']).records).toHaveLength(1);
    expect(parse(['2,Beta,-90,-180']).invalid).toEqual([]);
    expect(parse(['3,Gamma,90,180']).invalid).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd packages/terminology && npx vitest run src/facility-csv.test.ts`
Expected: FAIL — `invalid` is undefined.

- [ ] **Step 3: Implement**

In `packages/terminology/src/facility-csv.ts`, replace the `num` helper:

```ts
export interface RowError {
  line: number;
  field: 'latitude' | 'longitude';
  reason: 'not_a_number' | 'out_of_range' | 'incomplete_pair';
  raw: string;
}

/** Coordinate bounds. Not configuration: these are the definition of the WGS84 coordinate space,
 *  not a policy an operator could reasonably want to change. */
const LAT_MAX = 90;
const LON_MAX = 180;

/**
 * Parse one coordinate.
 *
 * ⛔ This used to be `num()`, which returned `null` for ANY unparseable value with no error at all —
 * so `latitude: "N/A"` and `latitude: ""` were indistinguishable and a national register could lose
 * every coordinate it had while reporting a clean import (FAC-P1-05). Blank still means absent;
 * everything else must parse and be in range.
 */
function coordinate(
  raw: string | undefined, field: 'latitude' | 'longitude', line: number, errors: RowError[],
): number | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) { errors.push({ line, field, reason: 'not_a_number', raw: t }); return null; }
  const max = field === 'latitude' ? LAT_MAX : LON_MAX;
  if (n < -max || n > max) { errors.push({ line, field, reason: 'out_of_range', raw: t }); return null; }
  return n;
}
```

In the row loop, after the required-field check, replace the two `num(...)` calls:

```ts
    const rowErrors: RowError[] = [];
    const latitude = coordinate(r.latitude, 'latitude', info.lines, rowErrors);
    const longitude = coordinate(r.longitude, 'longitude', info.lines, rowErrors);
    // A coordinate is a PAIR. Half of one is not a location, and writing it would put the facility
    // on the equator or the prime meridian — a plausible-looking wrong answer, which is worse than
    // no answer. Only reported when the other half parsed cleanly, so a row already rejected above
    // does not collect a second, confusing error.
    if (rowErrors.length === 0) {
      if (latitude !== null && longitude === null) {
        rowErrors.push({ line: info.lines, field: 'longitude', reason: 'incomplete_pair', raw: (r.longitude ?? '').trim() });
      } else if (longitude !== null && latitude === null) {
        rowErrors.push({ line: info.lines, field: 'latitude', reason: 'incomplete_pair', raw: (r.latitude ?? '').trim() });
      }
    }
    if (rowErrors.length > 0) { invalid.push(...rowErrors); continue; }
```

Declare `const invalid: RowError[] = [];` beside `quarantined`, use `latitude`/`longitude` in the
pushed record, add `invalid` to `FacilityCsvResult`, and return it from **all four** return
statements in the function (the empty-rows early return, the duplicate-columns return, the
unknown-columns return, and the final one).

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/terminology && npx vitest run src/facility-csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-prove the pair check**

Delete the `incomplete_pair` block (the plausible wrong implementation: someone validates each
coordinate independently and never considers the pair). Re-run. Expected: "rejects half a coordinate
pair" FAILS while the others pass. Restore in place.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/facility-csv.ts packages/terminology/src/facility-csv.test.ts
git commit -m "feat(facilities): reject unparseable and out-of-range coordinates instead of nulling them"
```

---

### Task 4: the classification engine

**Files:**
- Create: `packages/bootstrap/src/facility-classify.ts`
- Create: `packages/bootstrap/src/facility-classify.test.ts`

**Interfaces:**
- Consumes: `FacilityRecord` from `@openldr/db`; `canonicalJson` from `@openldr/core`.
- Produces:

```ts
export type FacilityChangeKind = 'create' | 'changed' | 'unchanged' | 'conflict';

export interface ExistingFacility {
  id: string;
  localCode: string | null;
  extras: Record<string, unknown> | null;
  /** Every comparable column, already in FacilityRecord's camelCase shape. */
  fields: Omit<FacilityRecord, 'id' | 'source' | 'extras' | 'localCode'>;
  /** `timestamptz` from the driver — a Date, despite FacilityRegistryTable declaring `string`. */
  updatedAt: Date | string;
}

export interface ClassifiedRow {
  kind: FacilityChangeKind;
  /** What will actually be WRITTEN — after local_code preservation and the extras merge. */
  merged: FacilityRecord;
  /** Populated for 'changed' only. */
  diff: { field: string; before: unknown; after: unknown }[];
}

export function classifyFacilityRows(
  records: FacilityRecord[],
  existingById: Map<string, ExistingFacility>,
  opts: { previewedAt: Date | null },
): ClassifiedRow[];
```

⛔ `opts.previewedAt` **null means conflicts were not evaluated**, and every row that would have
been `conflict` is classified on its content alone. It is never treated as "no conflicts".

- [ ] **Step 1: Write the failing test**

Create `packages/bootstrap/src/facility-classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyFacilityRows, type ExistingFacility } from './facility-classify';
import type { FacilityRecord } from '@openldr/db';

const rec = (over: Partial<FacilityRecord> = {}): FacilityRecord => ({
  id: 'fac-1', nationalSystem: 'S', nationalCode: '100', name: 'Alpha',
  level: null, ownership: null, status: null, country: null, zone: null, region: null,
  district: null, council: null, ward: null, village: null, addressText: null, phone: null,
  latitude: null, longitude: null, source: 'import', ...over,
});

const existing = (over: Partial<ExistingFacility> = {}): ExistingFacility => ({
  id: 'fac-1', localCode: null, extras: null,
  fields: {
    nationalSystem: 'S', nationalCode: '100', name: 'Alpha',
    level: null, ownership: null, status: null, country: null, zone: null, region: null,
    district: null, council: null, ward: null, village: null, addressText: null, phone: null,
    latitude: null, longitude: null, managedOrigin: null,
  },
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('classifyFacilityRows', () => {
  it('classifies an absent id as create', () => {
    const [row] = classifyFacilityRows([rec()], new Map(), { previewedAt: null });
    expect(row.kind).toBe('create');
  });

  it('classifies a byte-identical re-import as unchanged, NOT updated', () => {
    const map = new Map([['fac-1', existing()]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.diff).toEqual([]);
  });

  it('classifies a renamed facility as changed and reports the field diff', () => {
    const map = new Map([['fac-1', existing()]]);
    const [row] = classifyFacilityRows([rec({ name: 'Alpha Hospital' })], map, { previewedAt: null });
    expect(row.kind).toBe('changed');
    expect(row.diff).toEqual([{ field: 'name', before: 'Alpha', after: 'Alpha Hospital' }]);
  });

  it('does NOT report a change when the only difference is operator-curated extras the import preserves', () => {
    const map = new Map([['fac-1', existing({ extras: { curatedNote: 'kept' } })]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.merged.extras).toEqual({ curatedNote: 'kept' });
  });

  it('does NOT report a change when jsonb returns extras with reordered keys', () => {
    const map = new Map([['fac-1', existing({ extras: { b: 2, a: 1 } })]]);
    const [row] = classifyFacilityRows([rec({ extras: { a: 1, b: 2 } })], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
  });

  it('preserves an existing local_code the importer never carries, without calling it a change', () => {
    const map = new Map([['fac-1', existing({ localCode: 'LOCAL-9' })]]);
    const [row] = classifyFacilityRows([rec()], map, { previewedAt: null });
    expect(row.kind).toBe('unchanged');
    expect(row.merged.localCode).toBe('LOCAL-9');
  });

  it('classifies a row touched after the preview as conflict', () => {
    const map = new Map([['fac-1', existing({ updatedAt: new Date('2026-06-01T00:00:00Z') })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, {
      previewedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(row.kind).toBe('conflict');
  });

  it('compares timestamps as instants, not strings — an ISO string from the driver still conflicts', () => {
    const map = new Map([['fac-1', existing({ updatedAt: '2026-06-01T00:00:00.000Z' })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, {
      previewedAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(row.kind).toBe('conflict');
  });

  it('never classifies conflict when previewedAt is null', () => {
    const map = new Map([['fac-1', existing({ updatedAt: new Date('2030-01-01T00:00:00Z') })]]);
    const [row] = classifyFacilityRows([rec({ name: 'Renamed' })], map, { previewedAt: null });
    expect(row.kind).toBe('changed');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd packages/bootstrap && npx vitest run src/facility-classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/bootstrap/src/facility-classify.ts`:

```ts
import { canonicalJson } from '@openldr/core';
import type { FacilityRecord } from '@openldr/db';

export type FacilityChangeKind = 'create' | 'changed' | 'unchanged' | 'conflict';

export interface ExistingFacility {
  id: string;
  localCode: string | null;
  extras: Record<string, unknown> | null;
  fields: Omit<FacilityRecord, 'id' | 'source' | 'extras' | 'localCode'>;
  updatedAt: Date | string;
}

export interface ClassifiedRow {
  kind: FacilityChangeKind;
  merged: FacilityRecord;
  diff: { field: string; before: unknown; after: unknown }[];
}

/**
 * Columns the IMPORTER is authoritative for, and therefore the only ones a difference in may be
 * called a change.
 *
 * ⛔ `localCode` is deliberately absent: `parseFacilityCsv` never produces one (there is no such
 * column in the contract), it is a UNIQUE value an operator assigns by hand, and `importFacilities`
 * preserves the existing one. Including it here would mark every hand-coded facility as "changed"
 * on every import, forever — the same class of false positive FAC-P1-03 is about, one layer down.
 * `managedOrigin` is absent for the same reason: the sync applier owns it, not this path.
 */
const COMPARED: (keyof FacilityRecord)[] = [
  'nationalSystem', 'nationalCode', 'name', 'level', 'ownership', 'status', 'country',
  'zone', 'region', 'district', 'council', 'ward', 'village', 'addressText', 'phone',
  'latitude', 'longitude',
];

/** `null` and `undefined` both mean "no value" here — `FacilityRecord`'s fields are optional while
 *  the database columns are nullable, so the same absence arrives spelled two ways. */
const same = (a: unknown, b: unknown): boolean =>
  (a ?? null) === (b ?? null);

export function classifyFacilityRows(
  records: FacilityRecord[],
  existingById: Map<string, ExistingFacility>,
  opts: { previewedAt: Date | null },
): ClassifiedRow[] {
  // ⛔ Normalised through `new Date(...)`, never compared as strings. `facility_registry.updated_at`
  // is `timestamptz`, which node-postgres returns as a Date, even though FacilityRegistryTable
  // declares `string`. A string comparison would work by accident on ISO input and silently fail on
  // a Date. `facility-job-store.ts` already applies this idiom on every read.
  const watermark = opts.previewedAt === null ? null : new Date(opts.previewedAt).getTime();

  return records.map((r) => {
    const existing = existingById.get(r.id);
    if (!existing) return { kind: 'create' as const, merged: r, diff: [] };

    // Merge exactly what `importFacilities` will write, and compare against THAT — not against the
    // raw parsed record. The importer is not authoritative for local_code or for extras keys it did
    // not produce, so a comparison that ignored the merge would report a change the write does not
    // actually make.
    const merged: FacilityRecord = {
      ...r,
      localCode: r.localCode ?? existing.localCode ?? null,
      extras: { ...(existing.extras ?? {}), ...(r.extras ?? {}) },
    };

    if (watermark !== null && new Date(existing.updatedAt).getTime() > watermark) {
      return { kind: 'conflict' as const, merged, diff: [] };
    }

    const diff: { field: string; before: unknown; after: unknown }[] = [];
    for (const field of COMPARED) {
      const before = (existing.fields as Record<string, unknown>)[field];
      const after = (merged as Record<string, unknown>)[field];
      if (!same(before, after)) diff.push({ field, before: before ?? null, after: after ?? null });
    }

    // `canonicalJson` sorts object keys recursively. Required, not defensive: Postgres re-sorts jsonb
    // keys on read, so a plain JSON.stringify reports a spurious diff on every row that has extras.
    const beforeExtras = existing.extras ?? {};
    const afterExtras = merged.extras ?? {};
    if (canonicalJson(beforeExtras) !== canonicalJson(afterExtras)) {
      diff.push({ field: 'extras', before: beforeExtras, after: afterExtras });
    }

    return { kind: diff.length === 0 ? ('unchanged' as const) : ('changed' as const), merged, diff };
  });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/bootstrap && npx vitest run src/facility-classify.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-prove the three load-bearing decisions, one at a time**

Each of these is a *plausible wrong implementation*, not a broken edit. Apply one, run, restore in
place, then move to the next.

1. Add `'localCode'` to `COMPARED`. Expected: "preserves an existing local_code" FAILS.
2. Replace `canonicalJson(...) !== canonicalJson(...)` with
   `JSON.stringify(beforeExtras) !== JSON.stringify(afterExtras)`. Expected: the jsonb key-order
   test FAILS.
3. Replace the watermark line with `new Date(existing.updatedAt).toISOString() > String(opts.previewedAt)`.
   Expected: "compares timestamps as instants" FAILS.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-classify.ts packages/bootstrap/src/facility-classify.test.ts
git commit -m "feat(facilities): classify import rows as create/changed/unchanged/conflict"
```

---

### Task 5: wire classification into `importFacilities` and reshape the result

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`
- Modify: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `classifyFacilityRows` (Task 4), `RowError` (Task 3), `FacilityImportRunStore` (Task 2).
- Produces the final `FacilityImportResult`:

```ts
export interface FacilityImportResult {
  parsed: number; skipped: number;
  unknownColumns: string[]; duplicateColumns: string[];
  quarantined: QuarantinedRow[];
  invalid: RowError[];
  duplicates: number;
  blocked: boolean; blockedReason: FacilityImportBlockedReason;

  create: number; changed: number; unchanged: number;
  /** ⛔ `null` means NOT EVALUATED, never "none". Null on any run with no `runId` linking it to a
   *  preview, because there is no watermark to compare against. */
  conflict: number | null;
  /** ⛔ `null` means NOT EVALUATED, never "none". Null unless the release was declared complete. */
  absent: number | null;
  /** Publisher-declared removals. Always 0 for CSV, which cannot express one. */
  deleted: number;

  /** Bounded per-bucket samples for the operator. */
  samples: {
    create: FacilitySample[]; changed: FacilityChangeSample[];
    conflict: FacilitySample[]; absent: FacilitySample[]; deleted: FacilitySample[];
  };

  /** What was actually WRITTEN, as opposed to what was classified above.
   *
   *  ⛔ NESTED, deliberately. A flat `created`/`updated` beside `create`/`changed` differs from it
   *  only by TENSE, and `result.create` vs `result.created` is a typo that type-checks and silently
   *  reads the wrong number. Nesting makes the two vocabularies impossible to confuse at a call
   *  site. Every consumer (route, studio, CLI) reads `written.created`, never `created`.
   *
   *  Both 0 on a preview — now because nothing was WRITTEN, not because nothing was computed. */
  written: { created: number; updated: number };
  runId: string | null;
  /** False when this `nationalSystem` matches no existing registry row — i.e. this import creates a
   *  NEW register identity. Reported, never blocking. See Task 10. */
  knownNationalSystem: boolean;
}

export interface FacilitySample { id: string; nationalCode: string | null; name: string }
export interface FacilityChangeSample extends FacilitySample {
  diff: { field: string; before: unknown; after: unknown }[];
}
```

- [ ] **Step 1: Write the failing tests**

Append to `packages/bootstrap/src/facility-import.test.ts`:

```ts
describe('preview reports real database impact (FAC-P1-03)', () => {
  it('a dry run against an empty registry reports create, not zeros', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    const r = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    expect(r).toMatchObject({ create: 1, changed: 0, unchanged: 0, written: { created: 0, updated: 0 } });
    expect(r.samples.create).toEqual([{ id: expect.any(String), nationalCode: '100', name: 'Dodoma Regional Referral' }]);
  });

  it('a dry run of a byte-identical re-import reports unchanged, not updated', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    const preview = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    expect(preview).toMatchObject({ create: 0, changed: 0, unchanged: 1 });
  });

  it('an APPLY of a byte-identical re-import reports unchanged and updates nothing', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    const again = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    expect(again).toMatchObject({ unchanged: 1, changed: 0, written: { created: 0, updated: 0 } });
  });

  it('reports a rename as changed with its field diff', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Old Name,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,New Name,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.changed).toBe(1);
    expect(r.samples.changed[0].diff).toEqual([{ field: 'name', before: 'Old Name', after: 'New Name' }]);
  });

  it('reports conflict as null — NOT 0 — when no run links preview to apply', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.conflict).toBeNull();
  });

  it('reports absent as null — NOT 0 — when the release is not declared complete', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.absent).toBeNull();
  });

  it('excludes invalid-coordinate rows from the write and reports them', async () => {
    const deps = await buildDeps();
    const r = await importFacilities(
      deps, csv(['100,Alpha,,,,,,,,,,,,,91,35']), { nationalSystem: SYSTEM, apply: true });
    expect(r.invalid).toHaveLength(1);
    expect(r.create).toBe(0);
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });
});
```

⚠ The existing `toEqual` in the first test of this file (`dry-run reports parsed/skipped/...`)
will now fail because the result gained fields. **Update it to the complete new object** — do not
weaken it to `toMatchObject`. A complete-object assertion is the only thing pinning this shape.

- [ ] **Step 2: Run and confirm failure**

Run: `cd packages/bootstrap && npx vitest run src/facility-import.test.ts`
Expected: FAIL — `create` undefined, and the existing `toEqual` mismatches.

- [ ] **Step 3: Delete the dry-run early return and wire classification**

In `packages/bootstrap/src/facility-import.ts`, replace the early return
(`if (!opts.apply || blocked || records.length === 0) { ... }`) with a shared path. The existing-row
lookup moves out of the write transaction into a `loadExisting` step that BOTH preview and apply run:

```ts
/** Load every row the import might touch, in the shape `classifyFacilityRows` needs.
 *
 *  ⛔ On the APPLY path this must run inside the same transaction as the write (see the docblock
 *  above), so it takes an executor rather than reaching for `deps.db` itself. On the PREVIEW path
 *  there is no transaction to be inside — a preview writes nothing — so it runs on `deps.db`. */
async function loadExisting(
  exec: Kysely<InternalSchema>, ids: string[],
): Promise<Map<string, ExistingFacility>> {
  const out = new Map<string, ExistingFacility>();
  for (const idChunk of chunk(ids, CHUNK)) {
    const rows = await exec.selectFrom('facility_registry').selectAll().where('id', 'in', idChunk).execute();
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        localCode: r.local_code,
        extras: (r.extras as Record<string, unknown> | null) ?? null,
        fields: {
          nationalSystem: r.national_system, nationalCode: r.national_code, name: r.name,
          level: r.level, ownership: r.ownership, status: r.status, country: r.country,
          zone: r.zone, region: r.region, district: r.district, council: r.council,
          ward: r.ward, village: r.village, addressText: r.address_text, phone: r.phone,
          latitude: r.latitude, longitude: r.longitude, managedOrigin: r.managed_origin,
        },
        updatedAt: r.updated_at,
      });
    }
  }
  return out;
}
```

Then, after `dedupeById` and the `blocked` computation, classify unconditionally:

```ts
  // ⛔ Preview and apply run the SAME classification. The dry run used to return here with
  // `created: 0, updated: 0` — values that meant "not computed" while reading as "nothing to do"
  // (FAC-P1-03). There is now exactly one code path producing these counts, so the preview cannot
  // drift from what the apply does; the two differ only in whether the write below runs.
  const previewedAt = run?.previewedAt ? new Date(run.previewedAt) : null;
  const existingForPreview = blocked || records.length === 0
    ? new Map<string, ExistingFacility>()
    : await loadExisting(deps.db, records.map((r) => r.id));
  const classified = classifyFacilityRows(records, existingForPreview, { previewedAt });
```

Build the counts and samples from `classified`, and return them from **both** the
nothing-to-write path and the applied path. On the apply path, re-classify inside the transaction
against the transaction's own `loadExisting` — that is what keeps `written` describing
what the statement actually wrote.

- [ ] **Step 4: Run — expect PASS**

Run: `cd packages/bootstrap && npx vitest run src/facility-import.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation-prove that preview really compares**

Change `existingForPreview` to `new Map()` unconditionally (the plausible wrong implementation:
someone "optimises" the preview by skipping the lookup). Re-run. Expected: "a dry run of a
byte-identical re-import reports unchanged" FAILS with `create: 1, unchanged: 0`. Restore in place.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(facilities): make the import preview report real database impact"
```

---

### Task 6: the real-Postgres classification test

**Files:**
- Create: `packages/bootstrap/src/facility-import-live.test.ts`

This exists because the classification is a **type round-trip** question and pg-mem returns
different types than node-postgres. It follows the gating pattern of
`packages/db/src/migrations/external/reset-roundtrip-live.test.ts`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createMigrator, internalMigrations, type InternalSchema } from '@openldr/db';
import { importFacilities } from './facility-import';

// Gated exactly like reset-roundtrip-live.test.ts: skipped unless a real Postgres is configured.
// This test cannot be replaced by a pg-mem one — it exists BECAUSE pg-mem and node-postgres return
// different types for `timestamptz` and `double precision`, and the classification compares both.
const url = process.env.TARGET_DATABASE_URL;

describe.skipIf(!url)('importFacilities against real Postgres', () => {
  it('reports a byte-identical re-import as unchanged, and a moved coordinate as changed', async () => {
    const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }) });
    try {
      const res = await createMigrator(db, internalMigrations).migrateToLatest();
      if (res.error) throw res.error;
      const system = `urn:live:${Date.now()}`;
      const header = 'national_code,name,latitude,longitude';
      const body = `${header}\n900,Live Alpha,-2.4048,29.912\n`;

      const first = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(first).toMatchObject({ create: 1, unchanged: 0 });

      // The whole point: a double-precision round trip and a timestamptz read must not manufacture
      // a difference. If either came back as a string, this reports `changed: 1`.
      const second = await importFacilities({ db }, body, { nationalSystem: system, apply: true });
      expect(second).toMatchObject({ create: 0, changed: 0, unchanged: 1 });

      const moved = `${header}\n900,Live Alpha,-2.5,29.912\n`;
      const third = await importFacilities({ db }, moved, { nationalSystem: system });
      expect(third).toMatchObject({ changed: 1 });
      expect(third.samples.changed[0].diff).toEqual([{ field: 'latitude', before: -2.4048, after: -2.5 }]);

      await db.deleteFrom('facility_registry').where('national_system', '=', system).execute();
    } finally {
      await db.destroy();
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run it against real Postgres**

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d postgres -c "DROP DATABASE IF EXISTS openldr_a2_live;" -c "CREATE DATABASE openldr_a2_live;"
```

Run: `cd packages/bootstrap && TARGET_DATABASE_URL="postgres://openldr:openldr@127.0.0.1:5433/openldr_a2_live" npx vitest run src/facility-import-live.test.ts --testTimeout=120000`
Expected: PASS, 1 test.

- [ ] **Step 3: Confirm it skips cleanly without the env var**

Run: `cd packages/bootstrap && npx vitest run src/facility-import-live.test.ts`
Expected: 1 skipped, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add packages/bootstrap/src/facility-import-live.test.ts
git commit -m "test(facilities): pin import classification against real Postgres types"
```

---

### Task 7: controlled-field mapping

**Files:**
- Create: `packages/bootstrap/src/facility-controlled-fields.ts`
- Create: `packages/bootstrap/src/facility-controlled-fields.test.ts`

**Interfaces:**
- Consumes: `TerminologyAdminStore` (`valueSets.getByUrl`, `valueSets.expand`,
  `termMappings.listOutgoing`).
- Produces:

```ts
export const CONTROLLED_FIELDS = ['level', 'status', 'country'] as const;
export type ControlledField = (typeof CONTROLLED_FIELDS)[number];

/** The canonical value sets, already seeded — migration 072 for level/status, 073 for country.
 *  ⛔ A2 seeds NOTHING. If one of these is missing from an install, that field is reported as
 *  `notValidated` rather than failing the import. */
export const CONTROLLED_VALUE_SETS: Record<ControlledField, string> = {
  level: 'urn:openldr:valueset:facility-type',
  status: 'urn:openldr:valueset:location-status',
  country: 'urn:openldr:valueset:country',
};

/** Per-source observed system for a controlled field, e.g.
 *  `urn:openldr:cs:facility-level:urn_tz_hfr`. Mirrors `observedSystemForFeed`'s slugify-with-
 *  hash-fallback so a punctuation-only source name cannot collide with another's. */
export function observedFieldSystem(field: ControlledField, nationalSystem: string): string;

export interface ControlledResolution {
  /** field -> raw source value -> canonical code. Absent entry = unmapped. */
  mapped: Record<ControlledField, Map<string, string>>;
  /** field -> distinct raw values with no mapping AND not already canonical. */
  unmapped: Record<ControlledField, string[]>;
  /** Fields with no seeded value set on this install — reported, never fatal. */
  notValidated: ControlledField[];
}

export async function resolveControlledFields(
  admin: TerminologyAdminStore,
  nationalSystem: string,
  records: FacilityRecord[],
): Promise<ControlledResolution>;

/** Rewrite a record's controlled fields to canonical codes, preserving each raw source value under
 *  `extras.__source`. Values with no mapping are left EXACTLY as they are — never blanked. */
export function applyControlledFields(rec: FacilityRecord, res: ControlledResolution): FacilityRecord;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveControlledFields, applyControlledFields, observedFieldSystem } from './facility-controlled-fields';
import type { FacilityRecord } from '@openldr/db';

const rec = (over: Partial<FacilityRecord>): FacilityRecord =>
  ({ id: 'fac-1', name: 'A', source: 'import', ...over } as FacilityRecord);

function fakeAdmin(opts: {
  valueSets?: Record<string, string[]>;
  mappings?: Record<string, { toCode: string; isActive: boolean }[]>;
}) {
  return {
    valueSets: {
      async getByUrl(url: string) { return opts.valueSets?.[url] ? { id: url } : null; },
      async expand(id: string) {
        return { codes: (opts.valueSets?.[id] ?? []).map((code) => ({ code })), total: 0 };
      },
    },
    termMappings: {
      async listOutgoing(system: string, code: string) {
        return (opts.mappings?.[`${system}|${code}`] ?? []).map((m) => ({ ...m, toSystem: '', fromSystem: system, fromCode: code }));
      },
    },
  } as never;
}

describe('resolveControlledFields', () => {
  it('reports a value already canonical as neither mapped nor unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['dispensary'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'dispensary' })]);
    expect(res.unmapped.level).toEqual([]);
    expect(res.mapped.level.size).toBe(0);
  });

  it('reports a value with no canonical code and no mapping as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('resolves a mapped source value to its canonical code', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.mapped.level.get('health_center')).toBe('health-center');
    expect(res.unmapped.level).toEqual([]);
  });

  it('ignores a DEACTIVATED mapping', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: false }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('reports a field whose value set is absent as notValidated, and never as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: {} });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'anything' })]);
    expect(res.notValidated).toContain('level');
    expect(res.unmapped.level).toEqual([]);
  });
});

describe('applyControlledFields', () => {
  it('writes the canonical code and preserves the raw source value', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health-center');
    expect(out.extras?.__source).toEqual({ level: 'health_center' });
  });

  it('leaves an UNMAPPED value exactly as it is rather than blanking it', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health_center');
  });
});
```

- [ ] **Step 2: Run and confirm failure.** Expected: module not found.

- [ ] **Step 3: Implement**, following the interface block above. Key comments to carry:

```ts
// ⛔ Raw source values go in `facility_registry.extras`, NEVER in a concept's `properties`:
// `terms.update` rewrites `properties` wholesale and would silently destroy them — the same reason
// migration 077 chose a table over a properties key. See [terms-update-destroys-properties].

// ⛔ Mapping resolution reads `term_mappings` via `listOutgoing`, not `concept_map_elements`:
// term_mappings is AUTHORITATIVE and is the only one carrying `is_active`, so a deactivated mapping
// must not resolve. `concept_map_elements` is its mirror.

// ⛔ Unmapped NEVER blocks and NEVER blanks. The raw value is written exactly as it is today, so
// this whole layer is a strict superset of the previous behaviour plus a warning count.
```

- [ ] **Step 4: Run — expect PASS**, 7 tests.

- [ ] **Step 5: Mutation-prove the `isActive` filter.** Drop the `.filter(m => m.isActive)` (the
plausible wrong implementation: someone takes the first mapping returned). Expected: "ignores a
DEACTIVATED mapping" FAILS. Restore in place.

- [ ] **Step 6: Commit**

```bash
git add packages/bootstrap/src/facility-controlled-fields.ts packages/bootstrap/src/facility-controlled-fields.test.ts
git commit -m "feat(facilities): resolve level/status/country through term_mappings"
```

---

### Task 8: the JSONL release format

**Files:**
- Create: `packages/terminology/src/facility-release.ts`
- Create: `packages/terminology/src/facility-release.test.ts`
- Modify: `packages/terminology/src/index.ts` (export)

**Interfaces:**
- Produces:

```ts
export interface FacilityReleaseMeta {
  country: string | null; version: string | null; publishedAt: string | null;
  rowCount: number | null; deletionCount: number | null;
}
export interface FacilityReleaseResult extends FacilityCsvResult {
  meta: FacilityReleaseMeta | null;
  /** National codes the publisher explicitly declared removed. */
  deletions: string[];
  /** `meta.rowCount`/`deletionCount` disagreeing with what was parsed. Reported, never fatal —
   *  a mismatch is a fact about the file the operator must see, not a reason to refuse it. */
  countMismatch: { field: 'rowCount' | 'deletionCount'; declared: number; parsed: number }[];
}
export function parseFacilityRelease(jsonl: string, opts: FacilityCsvOptions): FacilityReleaseResult;
```

Field mapping, measured against the corpus: `mflId`→`nationalCode`, `name`→`name`,
`facilityLevel`→`level`, `countryCode`→`country`, `region`, `district`, `phone`, `latitude`,
`longitude`, and **`active: boolean`→`status`** (`true`→`'active'`, `false`→`'inactive'`, matching
the seeded `location-status` codes). `email` has no column and goes to `extras`.

- [ ] **Step 1: Write the failing test** covering: the meta header; row mapping including
`active`→`status`; deletion records collected into `deletions`; a malformed line rejected **with its
line number** rather than throwing; a declared-count mismatch reported in `countMismatch`; and
coordinate validation reusing Task 3's `RowError` shape.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement**, reusing `parseJsonlLine`'s line-numbering idiom from
`packages/terminology/src/terms-csv.ts:305`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Wire the real corpus as a fixture test.** Add a test that reads
`../corlix/fixtures/mfl-TZ-2026-Q1-small.jsonl` and asserts `meta.rowCount === 20`,
`records.length === 20`, `deletions.length === 0`. **Skip it cleanly when the sibling repo is
absent** (`describe.skipIf(!existsSync(path))`) — the corpus lives outside this repository and CI
may not have it.

- [ ] **Step 6: Commit**

```bash
git add packages/terminology/src/facility-release.ts packages/terminology/src/facility-release.test.ts packages/terminology/src/index.ts
git commit -m "feat(facilities): parse the JSONL national-release format"
```

---

### Task 9: absent rows, declared deletions, and the retirement policy

**Files:**
- Modify: `packages/bootstrap/src/facility-import.ts`
- Modify: `packages/bootstrap/src/facility-import.test.ts`

**Interfaces:**
- Consumes: `retireRegistryConcepts` from `./facility-reconcile`.
- Produces on `FacilityImportOptions`:

```ts
  /** The file is a COMPLETE release of this register. Only then can a row's absence mean anything;
   *  otherwise `absent` is reported as `null`. */
  completeRelease?: boolean;
  /** What to do with rows the publisher explicitly declared removed. Default 'retire'. */
  onDeleted?: 'retire' | 'report';
  /** What to do with rows merely ABSENT from a complete release. Default 'report' — absence is an
   *  INFERENCE, and the audit requires that deletion is never inferred silently. */
  onAbsent?: 'retire' | 'report';
```

- [ ] **Step 1: Write the failing tests**

```ts
describe('absent and deleted rows', () => {
  it('reports absent as null when the release is not declared complete', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM });
    expect(r.absent).toBeNull();
  });

  it('counts absent rows when the release IS declared complete', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, completeRelease: true });
    expect(r.absent).toBe(1);
    expect(r.samples.absent).toEqual([{ id: expect.any(String), nationalCode: '200', name: 'Beta' }]);
  });

  it('does NOT retire an absent row by default, even on apply', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true, completeRelease: true });
    const beta = await rowFor(deps.db, '200');
    expect(beta?.status).toBeNull();
  });

  it('retires an absent row to `inactive` when the operator asks', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), {
      nationalSystem: SYSTEM, apply: true, completeRelease: true, onAbsent: 'retire',
    });
    const beta = await rowFor(deps.db, '200');
    expect(beta?.status).toBe('inactive');
  });

  it('never deletes a row, whatever the policy', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,', '200,Beta,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), {
      nationalSystem: SYSTEM, apply: true, completeRelease: true, onAbsent: 'retire',
    });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
  });

  it('scopes absence to this national_system only', async () => {
    const deps = await buildDeps();
    await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, apply: true });
    await importFacilities(deps, csv(['999,Other Register,,,,,,,,,,,,,,']), { nationalSystem: 'urn:other', apply: true });
    const r = await importFacilities(deps, csv(['100,Alpha,,,,,,,,,,,,,,']), { nationalSystem: SYSTEM, completeRelease: true });
    expect(r.absent).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** The absent set is computed with a single scoped query:

```ts
// ⛔ Scoped to THIS national_system. A register import says nothing about facilities belonging to a
// different register or hand-registered locally, and treating them as "absent" would offer the
// operator a retire action over rows the file was never authoritative for.
const absentRows = !opts.completeRelease ? null : await deps.db
  .selectFrom('facility_registry')
  .select(['id', 'national_code', 'name'])
  .where('national_system', '=', opts.nationalSystem)
  .where('id', 'not in', ids.length > 0 ? ids : [''])
  .execute();
```

Retirement sets `status = 'inactive'` and calls `retireRegistryConcepts(deps, retiredIds)`.

⚠ **Carry this comment**, because the code alone does not explain it:

```ts
// ⛔ 'inactive', NOT 'retired'. The seeded status vocabulary is HL7's own
// `http://hl7.org/fhir/location-status` (migration 072), whose only codes are active/suspended/
// inactive. Adding a `retired` code to a CodeSystem HL7 owns would be inventing a non-conformant
// FHIR value. The *retired* semantics are carried by retireRegistryConcepts below, which removes
// the facility from the mapping picker while leaving history resolvable.
```

- [ ] **Step 4: Run — expect PASS**, 6 tests.

- [ ] **Step 5: Mutation-prove the default.** Change `onAbsent` to default to `'retire'` (the
plausible wrong implementation — someone decides absence obviously means retirement). Expected:
"does NOT retire an absent row by default" FAILS. Restore in place.

- [ ] **Step 6: Mutation-prove the scoping.** Delete the `.where('national_system', ...)` clause.
Expected: "scopes absence to this national_system only" FAILS with `absent: 1`. Restore in place.

- [ ] **Step 7: Commit**

```bash
git add packages/bootstrap/src/facility-import.ts packages/bootstrap/src/facility-import.test.ts
git commit -m "feat(facilities): report absent and publisher-deleted rows, retire only on request"
```

---

### Task 10: route wiring

**Files:**
- Modify: `apps/server/src/facilities-routes.ts`
- Modify: `apps/server/src/facilities-routes.test.ts`

**Interfaces:**
- `POST /api/facilities/import` request gains `runId?`, `completeRelease?`, `onDeleted?`,
  `onAbsent?`, `onConflict?: 'skip' | 'overwrite'`, `format?: 'csv' | 'jsonl'`,
  `releaseVersion?`.
- The preview response gains `runId`.
- New: `GET /api/facilities/import/runs?nationalSystem=&limit=` → `{ runs: FacilityImportRun[] }`,
  and `GET /api/facilities/import/runs/:id`. Both `facilities.view`.

- [ ] **Step 1: Write the failing route tests**, covering: a preview returns a `runId`; an apply
carrying that `runId` reports a numeric `conflict`; an apply **without** one reports
`conflict: null`; the run list is scoped and ordered; and the preview warns when `nationalSystem`
matches zero existing rows.

⚠ **Route tests are the ONLY thing pinning this wire shape** — the handler has no explicit return
type and Fastify's generics are loose, so a breaking change here passes `typecheck` green. Assert
complete objects, not `toMatchObject`, on the response shape.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** Keep `MAX_INLINE_APPLY_ROWS` **as it is** — removing it is A2b's job,
and doing it here would ship a synchronous unbounded apply with no progress reporting. Update its
comment to record that the cap is now known to be over-conservative and why it survives this slice:

```ts
// ⚠ MEASURED 2026-08-09 on real Postgres: a cold end-to-end 13 000-row import — parse, batched
// write and 13 375 projected concepts — takes 2 689 ms. This cap is NOT protecting against a real
// request-deadline risk. It survives A2a deliberately: removing it belongs with A2b's upload,
// progress and cancel surface, and dropping it here would ship an unbounded synchronous apply that
// reports nothing while it runs. See the A2 spec's "Measured before designing".
```

- [ ] **Step 4: Add the new-register-identity warning (the FAC-P1-04 boundary)**

In the preview path, after the import returns and before the response, count existing rows carrying
this `national_system` and report it on the result as `knownNationalSystem: boolean`:

```ts
  // The FAC-P1-04 boundary, and the whole of it. `nationalSystem` is free text feeding a
  // deterministic id, so `HFR` and `hfr` are two registers that will never merge. Modelling sources
  // properly is sub-project B's; what belongs here is refusing to let an operator create a second
  // identity for the same register WITHOUT NOTICING. Reported, never blocked — a genuinely new
  // register is a normal thing to import, and this cannot tell the two cases apart.
  const known = await ctx.internalDb.selectFrom('facility_registry').select('id')
    .where('national_system', '=', p.data.nationalSystem).limit(1).executeTakeFirst();
  preview.knownNationalSystem = !!known;
```

Add `knownNationalSystem: boolean` to `FacilityImportResult` and render it in Task 11 as a warning
listing the `national_system` values that DO exist.

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Commit**

```bash
git add apps/server/src/facilities-routes.ts apps/server/src/facilities-routes.test.ts
git commit -m "feat(facilities): link import preview to apply and expose import runs"
```

---

### Task 11: the studio import sheet

**Files:**
- Modify: `apps/studio/src/api.ts`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.tsx`
- Modify: `apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx`
- Modify: `apps/studio/src/i18n/en.ts`, `fr.ts`, `pt.ts`

- [ ] **Step 1: Write the failing component tests**, covering: the summary renders
create/changed/unchanged counts; `conflict: null` renders as "not evaluated" and **never as 0**;
`absent: null` likewise; a changed-row sample shows before→after; the retirement choices appear only
when `absent`/`deleted` are non-zero; and Apply carries the operator's choices.

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** ⛔ Preview/Apply/Cancel stay in the `⋯` `DropdownMenu`; the retirement
and conflict choices are **inputs**, which are exempt, and follow the existing
`grid-cols-[auto_1fr]` label-left/input-right layout.

⚠ `willWriteCount` currently derives from `parsed - duplicates`. Replace it with
`create + changed` — the real count of rows the apply will write — and delete the derived version.

- [ ] **Step 4: Add every new key to all three locales in this same commit**, or
`apps/studio/src/i18n/parity.test.ts` fails.

- [ ] **Step 5: Run — expect PASS**

Run: `cd apps/studio && npx vitest run src/facilities/ImportFacilitiesSheet.test.tsx src/i18n/parity.test.ts`

- [ ] **Step 6: Mutation-prove the null rendering.** Change the `conflict === null` branch to render
`conflict ?? 0`. Expected: the "not evaluated" test FAILS. Restore in place.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/facilities/ImportFacilitiesSheet.tsx apps/studio/src/facilities/ImportFacilitiesSheet.test.tsx apps/studio/src/i18n/en.ts apps/studio/src/i18n/fr.ts apps/studio/src/i18n/pt.ts
git commit -m "feat(facilities): show the real reconciliation summary in the import sheet"
```

---

### Task 12: CLI parity

**Files:**
- Modify: `packages/cli/src/facilities.ts`
- Modify: `packages/cli/src/program.ts`
- Modify: `packages/cli/src/facilities.test.ts`

**Interfaces:** new flags on `facilities import`, matching `FacilityImportOptions` exactly:
`--format <csv|jsonl>`, `--release-version <v>`, `--complete-release`,
`--on-deleted <retire|report>`, `--on-absent <retire|report>`, `--on-conflict <skip|overwrite>`.
New subcommand `facilities import-runs [--national-system <sys>] [--limit <n>] [--json]` and
`facilities import-run <id> [--json]`.

- [ ] **Step 1: Write the failing tests** — a dry run prints the create/changed/unchanged summary; a
`--complete-release` dry run prints the absent count; without it, absent prints as *not evaluated*
and **never** as 0; `import-runs` lists newest first.

- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement**, wiring `runFacilitiesImport` to pass the new options straight through
and recording a run row via `createFacilityImportRunStore`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/facilities.ts packages/cli/src/program.ts packages/cli/src/facilities.test.ts
git commit -m "feat(cli): carry the import summary and retirement policy to the CLI"
```

---

### Task 13: full gate and branch review

- [ ] **Step 1: Run the whole gate**

Run: `pnpm turbo run typecheck test --force`
⚠ Do **not** pipe through `tail`. If `@openldr/forms > store.test.ts` times out at 15 000 ms,
re-run that package alone (it passes in ~11 s) and then `pnpm turbo run typecheck test` without
`--force` to finish from cache. See [test-gate-flakiness-timeouts] before blaming any change.

- [ ] **Step 2: Run the live Postgres test explicitly** — it is skipped by the gate.

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d postgres -c "DROP DATABASE IF EXISTS openldr_a2_live;" -c "CREATE DATABASE openldr_a2_live;"
cd packages/bootstrap && TARGET_DATABASE_URL="postgres://openldr:openldr@127.0.0.1:5433/openldr_a2_live" npx vitest run src/facility-import-live.test.ts --testTimeout=120000
```

- [ ] **Step 3: Request a whole-branch review.** Use superpowers:requesting-code-review. ⛔ A
per-task review structurally cannot catch a defence disarmed by a later task, and it cannot catch a
cross-package regression — both have happened in this workstream. Ask the reviewer explicitly:
*what does another package pin about the text or shape this branch changed?*

- [ ] **Step 4: Verify against the 13 000-row corpus end to end.** Convert
`../corlix/fixtures/mfl-TZ-2026-Q3-large.jsonl`, import it into a scratch database, and confirm the
second identical import reports `unchanged: 13000` — the exact inverse of the `updated: 13000`
measured before this work.

---

## Self-review

**Spec coverage.** Every design section maps to a task: §1 one function → Task 5; §2 classification
and the `null` fields → Tasks 4, 5; §3 validation → Task 3; §4 controlled fields → Task 7; §5
retirement → Task 9; §6 conflict watermark → Tasks 2, 4, 10; §7 release recording → Tasks 1, 2; §8
input formats → Task 8; §10 UI and CLI → Tasks 11, 12. §9 (the job flow) is A2b's and is
deliberately absent.

**Deliberately deferred to A2b, and named here so it is not mistaken for a gap:** removing
`MAX_INLINE_APPLY_ROWS` (Task 10 keeps it and records why), blob upload, progress, and cancel. The
`facility_import_runs` columns those need are created in Task 1 and left unused.

**Placeholder scan:** clean. Every code step carries real code; no "add appropriate error handling",
no "similar to Task N", no undefined types. `ExistingFacility`, `ClassifiedRow`,
`ControlledResolution`, `FacilityImportRun`, `RowError`, `FacilityReleaseResult` and the reshaped
`FacilityImportResult` are each defined in the task that introduces them and referenced by exact
name afterwards.

**Type consistency:** `classifyFacilityRows` (Task 4) is called with the exact `ExistingFacility`
shape `loadExisting` builds (Task 5); `observedFieldSystem` and `resolveControlledFields` (Task 7)
keep their names through Tasks 9–12; `conflict`/`absent` are `number | null` in the bootstrap result
(Task 5), the route response (Task 10), the studio type (Task 11) and the CLI output (Task 12).

**Two things the plan deliberately does NOT resolve, so the implementer does not treat them as
oversights:** the exact wording of new i18n strings (Task 11 names the keys, not the copy), and
whether `samples` caps at 50 per bucket in code or is trimmed at the route — either is fine provided
the cap is applied once and the truncation is visible to the operator rather than silent.
