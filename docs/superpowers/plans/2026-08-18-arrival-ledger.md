# Durable Arrival Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project a per-arrival ledger into the warehouse so reports can answer "when did this actually reach us", durably across a reprojection.

**Architecture:** A new warehouse table `ingest_events` mirrors `fhir.resource_history` for clinical resource types, keyed on `(resource_type, resource_id, version)` so every write is idempotent. Two paths fill it: the live projection cycle records a resource's arrivals when it projects that resource, and `reprojectAll` gains a second scan over `fhir.resource_history` (it cannot rebuild the ledger from `fhir_resources`, which holds only current versions). A correctly-named `openldr db reproject` exposes the rebuild; the existing misnamed `terminology reproject` becomes a deprecated alias.

**Tech Stack:** TypeScript, Kysely, Postgres/MSSQL/MySQL DDL through the dialect helpers, Vitest, Commander for the CLI.

**Spec:** `docs/superpowers/specs/2026-08-18-arrival-ledger-design.md`

## Global Constraints

- **Never add a `Co-Authored-By: Claude` or `Co-Authored-By: Codex` trailer** to any commit. The operator is the sole contributor.
- **Stage named paths only. Never `git add -A`** — the repository directory is shared with concurrent sessions, and `.superpowers/` holds scratch files that must not be committed.
- **Gate command:** `pnpm turbo run typecheck test --force --continue`. **Never pipe turbo through `tail`** — it truncates the failure list and hides which package failed.
- A gate failure is usually a **timeout, not a regression.** Grep the output for `Test timed out` and re-run that package alone before blaming a change. `@openldr/forms` has a known timeout in `src/store.test.ts` that passes when run alone; it is untouched by this work.
- ⛔ **Migration numbering is strict and a gap blocks boot.** The next external migration is **016**. Verified 2026-08-18: the last external migration is `015_facility_map_performer_system.ts` and `git branch -a --no-merged main` is **empty**, so no unmerged branch can claim 016. Re-check both before creating the file.
- ⛔ **MSSQL clusters primary keys and caps the key at 900 bytes.** `keyType(engine)` is `varchar(450)` on MSSQL, so **two** key columns land on exactly 900 (`012_facility_map.ts:14` documents this). A third column of any width overflows it. `resource_type` therefore uses a narrow type, not `keyType`.
- **DDL goes through the dialect helpers** in `packages/db/src/migrations/external/dialect.ts` — `keyType`, `timestampType`, `textType`. Never write a raw Postgres type into a migration; the same file runs on SQL Server and MySQL.
- pg-mem is not Postgres — no correlated-subquery support, stable scan order (`AGENTS.md` §7). It cannot prove the rebuild. Live-Postgres tests are the only thing that can, and a hermetic `pnpm test` **skips** them: a skipped run is not a pass.
- `TARGET_DATABASE_URL` for live tests is `postgres://openldr:openldr@127.0.0.1:5433/openldr_target`; `INTERNAL_DATABASE_URL` is `postgres://openldr:openldr@127.0.0.1:5433/openldr`. Use `127.0.0.1`, never `localhost` — a `::1` resolution gives a bare `ECONNRESET` that looks like a server fault.
- Working directory for every command: the repository root, `D:/Projects/Repositories/openldr_ce`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/src/migrations/external/dialect.ts` | Modify — add `shortKeyType(engine)` | 1 |
| `packages/db/src/migrations/external/016_ingest_events.ts` (+ `.test.ts`) | Create — the table | 1 |
| `packages/db/src/migrations/external/index.ts` | Modify — register 016 | 1 |
| `packages/db/src/schema/external.ts` | Modify — `IngestEventsTable`, `ExternalSchema`, `EXTERNAL_TABLE_COLUMNS` | 1 |
| `packages/db/src/relational-writer.ts` | Modify — `writeIngestEvents` on the interface and implementation | 2 |
| `packages/db/src/projection/cycle.ts` | Modify — ledger rebuild scan in `reprojectAll` | 2 |
| `packages/db/src/projection/ledger.ts` (+ `.test.ts`) | Create — the clinical type set and the history reader, shared by both paths | 2 |
| `packages/db/src/projection/arrival-ledger-live.test.ts` | Create — live-Postgres rebuild + survival proof | 2 |
| `packages/db/src/projection/cycle.ts` | Modify — record arrivals in `applyProjection` | 3 |
| `packages/cli/src/db.ts` (+ `db.test.ts`) | Modify — `runDbReproject` | 4 |
| `packages/cli/src/terminology.ts` | Modify — `runTerminologyReproject` delegates, deprecation notice | 4 |
| `packages/cli/src/program.ts` | Modify — register `db reproject`, correct the alias description | 4 |
| `apps/studio/src/docs/0.1.0/en/*.md` | Modify — document the ledger and the renamed command | 5 |
| `apps/web/src/landing/changelog.json` | Regenerate after merge | 5 |

---

## Task 1: The `ingest_events` table

**Files:**
- Modify: `packages/db/src/migrations/external/dialect.ts`
- Create: `packages/db/src/migrations/external/016_ingest_events.ts`
- Create: `packages/db/src/migrations/external/016_ingest_events.test.ts`
- Modify: `packages/db/src/migrations/external/index.ts`
- Modify: `packages/db/src/schema/external.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `ingest_events` with columns `resource_type`, `resource_id`, `version`, `recorded_at`; TypeScript type `IngestEventsTable` exported from `packages/db/src/schema/external.ts` and reachable as `ExternalSchema['ingest_events']`; helper `shortKeyType(engine: TargetEngine): string`.

- [ ] **Step 1: Write the failing migration test**

Create `packages/db/src/migrations/external/016_ingest_events.test.ts`. Mirror the harness the sibling `015_*.test.ts` uses — read it first and follow its imports and setup rather than inventing a new one.

```ts
import { describe, it, expect } from 'vitest';
import { shortKeyType, keyType } from './dialect';

describe('016 ingest_events — dialect widths', () => {
  it('keeps the composite primary key inside MSSQL\'s 900-byte clustered key cap', () => {
    // keyType('mssql') is varchar(450); TWO of them are already exactly 900 (012_facility_map.ts:14).
    // The PK here is (resource_type, resource_id, version) — three columns — so resource_type must
    // be narrow or the table cannot be created on SQL Server at all.
    const resourceType = Number(shortKeyType('mssql').match(/\((\d+)\)/)![1]);
    const resourceId = Number(keyType('mssql').match(/\((\d+)\)/)![1]);
    const bigintBytes = 8;
    expect(resourceType + resourceId + bigintBytes).toBeLessThanOrEqual(900);
  });

  it('is narrow enough on MySQL too, where a utf8mb4 index caps at 3072 bytes', () => {
    const resourceType = Number(shortKeyType('mysql').match(/\((\d+)\)/)![1]);
    const resourceId = Number(keyType('mysql').match(/\((\d+)\)/)![1]);
    expect((resourceType + resourceId) * 4 + 8).toBeLessThanOrEqual(3072);
  });

  it('is a plain text type on Postgres, which has no such cap', () => {
    expect(shortKeyType('postgres')).toBe('text');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/db test -- 016_ingest_events.test.ts
```

Expected: FAIL — `shortKeyType` is not exported from `./dialect`.

- [ ] **Step 3: Add the narrow key helper**

In `packages/db/src/migrations/external/dialect.ts`, after `keyType`:

```ts
// A key column that is short by nature — a FHIR resource type name ("QuestionnaireResponse" is the
// longest at 21 chars). Narrow on purpose: MSSQL clusters primary keys and caps the KEY at 900
// bytes, and two `keyType` columns already land on exactly 900 (see 012_facility_map.ts). Any
// composite key with three or more parts needs at least one narrow column or the table cannot be
// created on SQL Server.
export function shortKeyType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'varchar(64)';
  if (engine === 'mysql') return 'varchar(64)';
  return 'text';
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @openldr/db test -- 016_ingest_events.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the migration**

Create `packages/db/src/migrations/external/016_ingest_events.ts`:

```ts
import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType, shortKeyType, timestampType } from './dialect';

// The warehouse mirror of `fhir.resource_history` — one row per arrival of a clinical resource.
//
// ⛔ WHY THIS TABLE EXISTS AT ALL. `lab_requests.created_at` looks like an arrival time and is not:
// the projection never writes it (`relational/service-request.ts` writes nine columns plus
// `provColumns`, which is four provenance columns and no timestamp), so it falls to the column
// default `now()` — the moment the WAREHOUSE row was written. `reprojectAll` rewrites every one of
// them. Measured 2026-08-17: all 7,520 requests carried created_at 2026-08-06 while their
// authored_at spanned 2013-03-01..2013-11-07. A transmission report built on that column shows a
// wall of green on the reprojection date and nothing anywhere else.
//
// ⛔ The primary key is the SAME natural key as `fhir.resource_history`'s, so both write paths can
// upsert without coordinating and a rebuild is idempotent.
//
// ⛔ `resource_type` is `shortKeyType`, NOT `keyType`. MSSQL clusters the PK and caps its key at 900
// bytes; two `keyType` columns are already exactly 900 (012_facility_map.ts:14), so a third column
// of any width would make this table impossible to create on SQL Server.
//
// No provenance columns, deliberately: `resource_history` does not carry source_system/batch_id —
// those live on `fhir_resources` and describe the CURRENT version, so copying them here would
// attach today's provenance to yesterday's arrival.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.createTable('ingest_events')
    .addColumn('resource_type', sql.raw(shortKeyType(engine)), (c) => c.notNull())
    .addColumn('resource_id', sql.raw(keyType(engine)), (c) => c.notNull())
    .addColumn('version', 'bigint', (c) => c.notNull())
    .addColumn('recorded_at', sql.raw(timestampType(engine)), (c) => c.notNull())
    .addPrimaryKeyConstraint('ingest_events_pkey', ['resource_type', 'resource_id', 'version'])
    .execute();

  // The transmission grid groups by day across a month, so recorded_at leads. resource_type follows
  // it because every such query also filters to DiagnosticReport to reach a performing laboratory.
  await db.schema.createIndex('ingest_events_recorded_at_idx')
    .on('ingest_events').columns(['recorded_at', 'resource_type']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_events').execute();
}
```

- [ ] **Step 6: Register the migration**

In `packages/db/src/migrations/external/index.ts`, add the import beside `m015` and the entry beside `'015_facility_map_performer_system'`, following the exact shape already there:

```ts
import * as m016 from './016_ingest_events';
```

```ts
    '016_ingest_events': { up: (db) => m016.up(db, engine), down: m016.down },
```

- [ ] **Step 7: Add the TypeScript table type**

In `packages/db/src/schema/external.ts`, beside the other table interfaces. It does **not** extend `ProvenanceColumns` — see the migration comment:

```ts
/** One row per arrival of a clinical resource — the warehouse mirror of `fhir.resource_history`.
 *  Deliberately NOT ProvenanceColumns: resource_history carries no provenance, and fhir_resources'
 *  provenance describes the current version, not the one that arrived. */
export interface IngestEventsTable {
  resource_type: string;
  resource_id: string;
  version: number;
  recorded_at: Date;
}
```

Add `ingest_events: IngestEventsTable;` to `ExternalSchema`, and the column list to `EXTERNAL_TABLE_COLUMNS`:

```ts
  ingest_events: ['resource_type', 'resource_id', 'version', 'recorded_at'],
```

- [ ] **Step 8: Verify the migration runs on real Postgres**

```bash
pnpm --filter @openldr/db test
```

Expected: PASS. Then confirm the table is creatable against the live warehouse — `migrations.test.ts` in this package pins the exact migration manifest, so if it fails on an array mismatch, add `016_ingest_events` to that list; that is expected, not a surprise.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/migrations/external/dialect.ts packages/db/src/migrations/external/016_ingest_events.ts packages/db/src/migrations/external/016_ingest_events.test.ts packages/db/src/migrations/external/index.ts packages/db/src/schema/external.ts
git commit -m "feat(db): add the ingest_events arrival ledger table"
```

---

## Task 2: Rebuild the ledger from `fhir.resource_history`

**Files:**
- Create: `packages/db/src/projection/ledger.ts`
- Create: `packages/db/src/projection/ledger.test.ts`
- Modify: `packages/db/src/relational-writer.ts:15-19` (interface) and its implementation
- Modify: `packages/db/src/projection/cycle.ts:87-115` (`reprojectAll`)
- Create: `packages/db/src/projection/arrival-ledger-live.test.ts`

**Interfaces:**
- Consumes: table `ingest_events` and type `IngestEventsTable` from Task 1.
- Produces:
  - `LEDGER_RESOURCE_TYPES: readonly string[]` — the clinical set, exported from `packages/db/src/projection/ledger.ts`
  - `interface ArrivalEvent { resource_type: string; resource_id: string; version: number; recorded_at: Date }`
  - `readArrivals(internalDb, resourceType, id): Promise<ArrivalEvent[]>` — every recorded arrival for one resource
  - `isLedgerResourceType(resourceType: string): boolean` — membership test used by the live path in Task 3
  - `RelationalWriter.writeIngestEvents(events: ArrivalEvent[]): Promise<void>` — idempotent upsert on the composite key

- [ ] **Step 1: Write the failing test for the clinical type set**

Create `packages/db/src/projection/ledger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEDGER_RESOURCE_TYPES } from './ledger';

describe('LEDGER_RESOURCE_TYPES', () => {
  it('covers the clinical resources a laboratory transmits', () => {
    for (const t of ['ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport', 'Patient']) {
      expect(LEDGER_RESOURCE_TYPES, `${t} must be recorded`).toContain(t);
    }
  });

  it('excludes config and reference resources, which churn on every edit', () => {
    // Measured 2026-08-17 on the dev warehouse: Organization 46.4 versions each, Questionnaire 93.0,
    // Location 399.0 — against 2.0-2.2 for every clinical type. Including them would let one
    // operator editing a Questionnaire look identical to a laboratory transmitting, and they would
    // dominate the table.
    for (const t of ['Organization', 'Questionnaire', 'Location', 'ValueSet']) {
      expect(LEDGER_RESOURCE_TYPES, `${t} must NOT be recorded`).not.toContain(t);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @openldr/db test -- ledger.test.ts
```

Expected: FAIL — cannot resolve `./ledger`.

- [ ] **Step 3: Write the ledger module**

Create `packages/db/src/projection/ledger.ts`:

```ts
import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';

/** One recorded arrival of one version of one resource. Mirrors a `fhir.resource_history` row. */
export interface ArrivalEvent {
  resource_type: string;
  resource_id: string;
  version: number;
  recorded_at: Date;
}

/** The resource types whose arrivals are recorded in `ingest_events`.
 *
 *  Clinical only. Config and reference resources are excluded because they are re-saved by seeding
 *  and admin edits — measured 2026-08-17: Organization 46.4 versions each, Questionnaire 93.0,
 *  Location 399.0, against 2.0-2.2 for every clinical type. Recording them would let an operator
 *  editing a form look identical to a laboratory transmitting results. */
export const LEDGER_RESOURCE_TYPES = [
  'ServiceRequest',
  'Specimen',
  'Observation',
  'DiagnosticReport',
  'Patient',
] as const;

const TYPE_SET: ReadonlySet<string> = new Set(LEDGER_RESOURCE_TYPES);

export function isLedgerResourceType(resourceType: string): boolean {
  return TYPE_SET.has(resourceType);
}

/** Every arrival recorded for one resource, oldest first.
 *
 *  Returns ALL versions, not the newest. The live path upserts the whole set so that it agrees with
 *  a rebuild even when two versions arrive between projection cycles — the cycle sees one task for
 *  the resource, and recording only the newest would silently lose the intermediate arrival while
 *  the rebuild kept it. Idempotent upsert on the composite key makes re-writing the set free. */
export async function readArrivals(
  internalDb: Kysely<InternalSchema>, resourceType: string, id: string,
): Promise<ArrivalEvent[]> {
  const rows = await internalDb
    .selectFrom('fhir.resource_history')
    .select(['resource_type', 'id', 'version', 'recorded_at'])
    .where('resource_type', '=', resourceType)
    .where('id', '=', id)
    .orderBy('version')
    .execute();
  return rows.map((r) => ({
    resource_type: r.resource_type as string,
    resource_id: r.id as string,
    version: Number(r.version),
    recorded_at: r.recorded_at as Date,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @openldr/db test -- ledger.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Add `writeIngestEvents` to the relational writer**

In `packages/db/src/relational-writer.ts`, add to the `RelationalWriter` interface at `:15-19`:

```ts
  writeIngestEvents(events: ArrivalEvent[]): Promise<void>;
```

Import `ArrivalEvent` from `./projection/ledger`. In `createRelationalWriter`, implement it using the existing dialect-aware `upsertOn` helper already defined at `:23-28`, which routes to `mergeBatchMssql` / `insertBatchMysql` / `insertBatchPg`:

```ts
    async writeIngestEvents(events) {
      // Idempotent by construction: the table's PK is (resource_type, resource_id, version), the
      // same natural key as fhir.resource_history, so re-writing an arrival is a no-op. That is
      // what lets the live path and the rebuild path write without coordinating.
      if (events.length === 0) return;
      await upsertOn(anyDb, 'ingest_events', events as unknown as Record<string, unknown>[]);
    },
```

- [ ] **Step 6: Add the rebuild scan to `reprojectAll`**

In `packages/db/src/projection/cycle.ts`, inside `reprojectAll` (currently `:87-115`), **after** the existing `fhir_resources` paging loop and **before** `advanceCursor`:

```ts
  // ⛔ A SECOND scan, over a DIFFERENT table, and it cannot be folded into the loop above.
  // The loop above pages `fhir.fhir_resources`, which holds only the CURRENT version of each
  // resource. An arrival ledger is a record of every version, so rebuilding it from that table is
  // structurally impossible — it would record one arrival per resource and lose the history.
  let arrivals = 0;
  let histOffset = 0;
  for (;;) {
    const rows = await deps.internalDb
      .selectFrom('fhir.resource_history')
      .select(['resource_type', 'id', 'version', 'recorded_at'])
      .where('resource_type', 'in', [...LEDGER_RESOURCE_TYPES])
      // (resource_type, id, version) is this table's PRIMARY KEY, so the ordering is unique and the
      // OFFSET paging is deterministic. AGENTS.md §7: an ORDER BY + OFFSET without a unique
      // tiebreaker can skip or repeat rows, and pg-mem's stable scan order would never reveal it.
      .orderBy('resource_type').orderBy('id').orderBy('version')
      .limit(page).offset(histOffset)
      .execute();
    if (rows.length === 0) break;
    await deps.relationalWriter.writeIngestEvents(rows.map((r) => ({
      resource_type: r.resource_type as string,
      resource_id: r.id as string,
      version: Number(r.version),
      recorded_at: r.recorded_at as Date,
    })));
    arrivals += rows.length;
    histOffset += rows.length;
    if (rows.length < page) break;
  }
```

Import `LEDGER_RESOURCE_TYPES` from `./ledger`. Leave the returned count as the resource count it already is — `arrivals` is a separate quantity and conflating them is exactly the confusion `terminology.ts:163-167` documents. If the count is wanted, return it as a second field in a later slice rather than changing this function's return type here.

- [ ] **Step 7: Write the live-Postgres proof**

Create `packages/db/src/projection/arrival-ledger-live.test.ts`. Model the harness on `packages/reporting/src/seed/clinical-micro-header-live.test.ts` — own throwaway database, `describe.skipIf(!url)`, dropped in `afterAll`. Read that file first.

The test that matters is the **contrast**, because the contrast is the feature:

```ts
  it('survives a reprojection that rewrites every warehouse created_at', async () => {
    const before = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    const createdBefore = await db.selectFrom('lab_requests').select(['id', 'created_at'])
      .orderBy('id').execute();
    expect(before.length, 'fixture must produce arrivals or this test proves nothing').toBeGreaterThan(0);

    await reprojectAll({ internalDb, relationalWriter });

    const after = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    const createdAfter = await db.selectFrom('lab_requests').select(['id', 'created_at'])
      .orderBy('id').execute();

    // The ledger is untouched...
    expect(after).toEqual(before);
    // ...while the column someone might have used instead has moved under it. This half is not
    // decoration: it is the demonstration that created_at was never usable as an arrival time.
    expect(createdAfter).not.toEqual(createdBefore);
  });
```

Every fixture writes through the real `fhirStore.save()` path so `resource_history` is populated by the code under test, never by hand-inserted rows. Add three more:

```ts
  it('records every version, not only the newest', async () => {
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);

    await reprojectAll({ internalDb, relationalWriter });

    const rows = await db.selectFrom('ingest_events').select(['version', 'recorded_at'])
      .where('resource_id', '=', 'multi-1').orderBy('version').execute();
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2, 3]);
    // Three DISTINCT arrival times, not one repeated — the ledger records when each version
    // landed, which is the whole point. Equal timestamps would mean it recorded the rebuild.
    expect(new Set(rows.map((r) => String(r.recorded_at))).size).toBe(3);
  });

  it('is idempotent — a second rebuild changes nothing', async () => {
    await fhirStore.save(makeServiceRequest('idem-1'), provenance);
    await reprojectAll({ internalDb, relationalWriter });

    const first = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();

    await reprojectAll({ internalDb, relationalWriter });

    const second = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    expect(second).toEqual(first);
  });

  it('records no arrival for a config resource', async () => {
    // Organization churns 46x per resource on real data; Location 399x. Recording config edits
    // would let an operator saving a form look identical to a laboratory transmitting results.
    await fhirStore.save({ resourceType: 'Organization', id: 'org-1', name: 'Somewhere' }, provenance);
    await reprojectAll({ internalDb, relationalWriter });

    const rows = await db.selectFrom('ingest_events').select(['resource_id'])
      .where('resource_type', '=', 'Organization').execute();
    expect(rows).toHaveLength(0);
  });
```

`makeServiceRequest(id)` is a small local helper returning a minimal valid ServiceRequest — `{ resourceType: 'ServiceRequest', id, status: 'completed', intent: 'order', subject: { reference: 'Patient/p-1' } }`. Define it once at the top of the file beside the fixtures.

- [ ] **Step 8: Run the live test**

```bash
TARGET_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr_target INTERNAL_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr pnpm --filter @openldr/db test -- arrival-ledger-live.test.ts
```

Expected: PASS, 4 tests, **run not skipped**. A "skipped" result is not a pass — export the URLs and re-run.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/projection/ledger.ts packages/db/src/projection/ledger.test.ts packages/db/src/projection/arrival-ledger-live.test.ts packages/db/src/projection/cycle.ts packages/db/src/relational-writer.ts
git commit -m "feat(db): rebuild the arrival ledger from resource_history"
```

---

## Task 3: Record arrivals on the live projection path

**Files:**
- Modify: `packages/db/src/projection/cycle.ts:39-60` (`applyProjection`)
- Modify: `packages/db/src/projection/arrival-ledger-live.test.ts`

**Interfaces:**
- Consumes: `readArrivals`, `isLedgerResourceType` and `ArrivalEvent` from Task 2's `packages/db/src/projection/ledger.ts`; `RelationalWriter.writeIngestEvents` from Task 2.
- Produces: nothing new. After this task both write paths fill the same table.

**Why a read rather than a wider task type:** `ProjectionTask` is exactly `{ resourceType: string; id: string }` (`packages/db/src/projection/plan.ts:18-21`), and `applyProjection` reads the current canonical row via `getWithProvenance` — so the live path knows *which* resource changed but not which version arrived or when. The spec resolved this: read from `fhir.resource_history` at apply time and leave `ProjectionTask` alone. That type is shared by `planProjection`, the gap logic and the cursor, whose correctness properties around gaps and snapshot boundaries exist because of real ordering bugs; widening it to save one indexed read is a bad trade.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/projection/arrival-ledger-live.test.ts`:

```ts
  it('records the arrival on the LIVE path, without a rebuild', async () => {
    // The rebuild is not run in this test at all. If ingest_events is populated, it is because the
    // projection cycle wrote it.
    await fhirStore.save(makeServiceRequest('live-1'), provenance);
    await runner.runCycle();

    const rows = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version'])
      .where('resource_id', '=', 'live-1').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_type).toBe('ServiceRequest');
  });

  it('live and rebuild agree when two versions arrive between cycles', async () => {
    // The cycle sees ONE task for the resource. Recording only the newest version would lose the
    // first arrival, and a later rebuild would then disagree with the live path.
    await fhirStore.save(makeServiceRequest('live-2'), provenance);
    await fhirStore.save(makeServiceRequest('live-2'), provenance); // second version, same cycle
    await runner.runCycle();

    const live = await db.selectFrom('ingest_events').select(['version'])
      .where('resource_id', '=', 'live-2').orderBy('version').execute();
    expect(live.map((r) => Number(r.version))).toEqual([1, 2]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
TARGET_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr_target INTERNAL_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr pnpm --filter @openldr/db test -- arrival-ledger-live.test.ts
```

Expected: FAIL — both new tests find 0 rows in `ingest_events`.

- [ ] **Step 3: Record arrivals in `applyProjection`**

In `packages/db/src/projection/cycle.ts`, inside `applyProjection`, **after** the existing `relationalWriter.write(...)` call so the clinical projection has already landed:

```ts
  // Record every arrival of this resource, not only the newest.
  //
  // ⛔ WHY ALL VERSIONS. A cycle receives ONE task per changed resource, however many versions
  // arrived since the last cycle. Recording only the newest would silently lose the intermediate
  // arrival — and a later `reprojectAll`, which reads every history row, would then DISAGREE with
  // the live path. Upsert is idempotent on the composite PK, so re-writing versions already
  // recorded costs nothing and makes the two paths converge by construction.
  //
  // Guarded like the existing onProjected hook: a ledger failure must never abort a cycle or be
  // mistaken for a failed clinical write, which has already landed by this point.
  if (isLedgerResourceType(task.resourceType)) {
    try {
      await deps.relationalWriter.writeIngestEvents(
        await readArrivals(deps.internalDb, task.resourceType, task.id),
      );
    } catch (err) {
      deps.logger.error({ err, task }, 'arrival ledger write failed; skipping (reprojectAll can heal)');
    }
  }
```

Import `isLedgerResourceType` and `readArrivals` from `./ledger`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
TARGET_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr_target INTERNAL_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr pnpm --filter @openldr/db test -- arrival-ledger-live.test.ts
```

Expected: PASS, 6 tests, not skipped.

- [ ] **Step 5: Run the whole db package**

```bash
pnpm --filter @openldr/db test
```

Expected: PASS. The live file skips here without the URLs, which is expected — say so in the report rather than presenting a green hermetic run as proof of the live behaviour.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/projection/cycle.ts packages/db/src/projection/arrival-ledger-live.test.ts
git commit -m "feat(db): record arrivals on the live projection path"
```

---

## Task 4: `openldr db reproject`, and retire the misnamed alias

**Files:**
- Modify: `packages/cli/src/db.ts`
- Modify: `packages/cli/src/db.test.ts`
- Modify: `packages/cli/src/terminology.ts:159-175`
- Modify: `packages/cli/src/program.ts:120-160` and `:530-532`

**Interfaces:**
- Consumes: the ledger rebuild inside `reprojectAll` from Task 2.
- Produces: `runDbReproject(opts: { json: boolean; force: boolean }): Promise<number>` exported from `packages/cli/src/db.ts`.

**The situation this task corrects.** `openldr terminology reproject` **already** calls the general `reprojectAll` and rebuilds the entire read model — patients, lab_requests, lab_results and the rest, not only `terminology_codes`. Its own code comment says so (`packages/cli/src/terminology.ts:163-167`), written after someone read its count as "8692 terminology rows" when the dimension held 2,025. Its registered description (`packages/cli/src/program.ts:530`) still reads "Rebuild terminology_codes (the warehouse ValueSet dimension) from canonical FHIR". So the capability is misnamed, not missing — and adding a second command calling the same function would be the duplication `AGENTS.md` §6 forbids. One implementation, correctly named, with the old name kept as a deprecated alias.

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/src/db.test.ts`, following the mocking style already in that file:

```ts
describe('db reproject', () => {
  it('refuses without --force, and rebuilds nothing', async () => {
    // It rewrites the whole read model and every warehouse created_at moves. AGENTS.md §6:
    // destructive commands refuse without --force.
    const code = await runDbReproject({ json: false, force: false });
    expect(code).toBe(1);
    expect(mocks.reprojectAll).not.toHaveBeenCalled();
  });

  it('rebuilds with --force and reports the resource count', async () => {
    mocks.reprojectAll.mockResolvedValueOnce(8692);
    const code = await runDbReproject({ json: false, force: true });
    expect(code).toBe(0);
    expect(mocks.reprojectAll).toHaveBeenCalledTimes(1);
  });

  it('audits as the cli actor', async () => {
    mocks.reprojectAll.mockResolvedValueOnce(1);
    await runDbReproject({ json: false, force: true });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ action: 'db.reproject' }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @openldr/cli test -- db.test.ts
```

Expected: FAIL — `runDbReproject` is not exported.

- [ ] **Step 3: Implement `runDbReproject`**

In `packages/cli/src/db.ts`, following `runDbReset` at `:51-70` for the force guard, audit and context handling:

```ts
/** Rebuild the whole warehouse read model from the canonical FHIR store, including the
 *  `ingest_events` arrival ledger.
 *
 *  ⛔ DESTRUCTIVE-SHAPED, which is why it refuses without --force: it rewrites every projected row,
 *  so every warehouse `created_at` moves to the moment of the rebuild. Anything that treated that
 *  column as an arrival time silently loses its history — which is precisely why the arrival ledger
 *  exists and is rebuilt here rather than derived from it. */
export async function runDbReproject(opts: JsonOpt & { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(
      'db reproject refused: this rebuilds the entire read model and moves every warehouse created_at.\n'
      + 'Re-run with --force if that is what you intend.\n',
    );
    return 1;
  }
  const ctx = await createDbContext(loadConfig());
  try {
    const projected = await reprojectAll({ internalDb: ctx.internalDb, relationalWriter: ctx.relationalWriter });
    try {
      const appCtx = await createAppContext(loadConfig());
      try {
        await recordAuditEvent(appCtx, cliActor(), { action: 'db.reproject', entityType: 'database', entityId: 'external', metadata: { projected } });
      } finally {
        await appCtx.close();
      }
    } catch {
      // audit is best-effort, exactly as db.reset treats it
    }
    emit(opts.json, { projected }, `rebuilt the read model from ${projected} canonical resource${projected === 1 ? '' : 's'}`);
    return 0;
  } finally {
    await ctx.close();
  }
}
```

Import `reprojectAll` from `@openldr/db` alongside the existing imports.

- [ ] **Step 4: Register the command**

In `packages/cli/src/program.ts`, in the `db` group at `:120-160`, after `db.command('seed')`:

```ts
  db.command('reproject')
    .description('Rebuild the warehouse read model from canonical FHIR, including the arrival ledger (refuses without --force)')
    .option('--json', 'emit JSON', false)
    .option('--force', 'confirm the rebuild — it moves every warehouse created_at', false)
    .action(async (opts: { json: boolean; force: boolean }) => {
      try {
        process.exitCode = await runDbReproject(opts);
      } catch (err) {
        process.stderr.write(`db reproject failed: ${redactError(err)}\n`);
        process.exitCode = 1;
      }
    });
```

- [ ] **Step 5: Make the old command a deprecated alias with an honest description**

In `packages/cli/src/program.ts:530`, replace the description so it stops claiming to be terminology-scoped:

```ts
  term.command('reproject').description('DEPRECATED — use `openldr db reproject`. Rebuilds the ENTIRE read model, not only terminology_codes')
```

In `packages/cli/src/terminology.ts`, make `runTerminologyReproject` delegate rather than keep a second copy of the logic:

```ts
/** DEPRECATED — `openldr db reproject` is the same operation under an honest name.
 *
 *  This command has ALWAYS rebuilt the entire read model, not just terminology_codes: it calls the
 *  general `reprojectAll`. The old description said otherwise, and someone read its count as "8692
 *  terminology rows" when the dimension held 2,025. Kept as a thin alias so existing runbooks and
 *  scripts keep working.
 *
 *  ⚠ It inherits the --force guard. That IS a behaviour change for an unattended script calling the
 *  old name, and it is deliberate: an unguarded command that silently moves every warehouse
 *  created_at is the hazard, and a loud refusal is better than a silent rewrite. The deprecation
 *  notice names the replacement so the fix is one line. */
export async function runTerminologyReproject(opts: { json: boolean; force: boolean }): Promise<number> {
  process.stderr.write('warning: `terminology reproject` is deprecated — use `openldr db reproject`.\n');
  return runDbReproject(opts);
}
```

Add the `--force` option to the `term.command('reproject')` registration to match, and import `runDbReproject`.

- [ ] **Step 6: Run the CLI tests**

```bash
pnpm --filter @openldr/cli test
```

Expected: PASS. `terminology.test.ts:248-280` currently asserts the old behaviour and will need updating to the delegating shape — update it to assert delegation and the deprecation notice, rather than deleting it.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/db.ts packages/cli/src/db.test.ts packages/cli/src/terminology.ts packages/cli/src/terminology.test.ts packages/cli/src/program.ts
git commit -m "feat(cli): add db reproject and deprecate the misnamed terminology alias"
```

---

## Task 5: Docs, full gate, and the landing changelog

**Files:**
- Modify: `apps/studio/src/docs/0.1.0/en/` — the page covering database maintenance or the CLI
- Modify: `apps/web/src/landing/changelog.json` (generated)

**Interfaces:** none.

**Docs constraints.** The in-app docs tree holds **only** `en/`, and the web docs tree (`apps/web/src/docs/0.1.0/`) is English-only too. Do **not** create `fr/` or `pt/` trees — that is a docs-infrastructure slice. This task adds no i18n string, so there is no translated surface; say so rather than leaving it to look like an omission. Each docs page follows a fixed template and `validation.test.ts` checks the page shape, so add content to existing sections rather than inventing new headings.

- [ ] **Step 1: Find the right page**

```bash
grep -rln "terminology reproject\|db reset\|db migrate" apps/studio/src/docs/0.1.0/en/
```

Add to the existing maintenance section of whichever page that grep names — as bullets, not a new heading:

```markdown
- **`openldr db reproject --force`** rebuilds the entire warehouse read model from the canonical FHIR store, including the `ingest_events` arrival ledger. It refuses without `--force` because it rewrites every projected row: each table's `created_at` moves to the moment of the rebuild.
- **`openldr terminology reproject` is deprecated** and does exactly the same thing. It always did — despite its name it never rebuilt only `terminology_codes`. Use `db reproject`.
- **`ingest_events` is the record of when data reached OpenLDR.** One row per arrival of each clinical resource, keyed on resource and version, rebuilt from the canonical store. The `created_at` column on `lab_requests`, `specimens` and the other projected tables is **not** an arrival time — it is when the warehouse row was last written, and a reproject resets it. Anything asking "when did this reach us" must read `ingest_events`.
```

- [ ] **Step 2: Verify the docs still validate**

```bash
pnpm --filter @openldr/studio test -- validation.test.ts registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full gate**

```bash
pnpm turbo run typecheck test --force --continue
```

Expected: all packages PASS. **Never pipe through `tail`.** On failure grep for `Test timed out` first — `@openldr/forms` has a known timeout in `src/store.test.ts` that passes when the package is run alone, and it is untouched by this work.

- [ ] **Step 4: Run the live suites with the databases set**

```bash
TARGET_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr_target INTERNAL_DATABASE_URL=postgres://openldr:openldr@127.0.0.1:5433/openldr pnpm --filter @openldr/db test
```

Expected: PASS with `arrival-ledger-live.test.ts` **running**, not skipped. The gate in Step 3 skips it; a green gate alone does not prove any of this slice's behaviour.

- [ ] **Step 5: Prove it end to end against the real warehouse**

```bash
pnpm openldr db migrate
```

```bash
pnpm openldr db reproject --force
```

Then confirm the ledger is populated and spans real days, rather than collapsing to one:

```bash
docker exec openldr_ce-postgres-1 psql -U openldr -d openldr_target -c "select resource_type, count(*), min(recorded_at)::date, max(recorded_at)::date from ingest_events group by 1 order by 2 desc;"
```

Expected: rows for the five clinical types only, ~92,000 total, with `recorded_at` **spanning several dates** — measured 2026-08-17, `resource_history` holds arrivals across 2026-08-07 to 2026-08-17. A single date for every row means the ledger is recording the rebuild rather than the arrival, which is the exact failure this slice exists to prevent.

- [ ] **Step 6: Merge to local `main`**

Work merges to local `main` first, then syncs to origin. Confirm the origin SHA after pushing. Do not open a PR unless asked.

- [ ] **Step 7: Regenerate and commit the landing changelog**

Run **after** merging — the generator reads git history and cannot see commits that are not there yet.

```bash
pnpm make:changelog
```

```bash
git add apps/web/src/landing/changelog.json && git commit -m "chore(web): regenerate the landing changelog"
```

---

## Verification summary — what is proven and what is not

| Claim | Proven by | Layer it does NOT cover |
|---|---|---|
| The table exists on all three dialects | `016_ingest_events.test.ts` width arithmetic + a real Postgres migration run | MSSQL and MySQL DDL is never executed |
| The rebuild records every version | `arrival-ledger-live.test.ts`, real Postgres | Nothing about the live path |
| The ledger survives a reprojection | the before/after contrast in the same file | Only proves it for the fixture's resources |
| Live and rebuild agree | the two-versions-in-one-cycle test | Not proven under concurrent cycles |
| Config resources are excluded | `ledger.test.ts` + a live assertion | — |
| `db reproject` refuses without `--force` | `db.test.ts` | Not that the rebuild itself is correct |

**HONEST NON-PROOF — four gaps, stated rather than buried:**

1. **MSSQL and MySQL are arithmetic and shape only.** The 900-byte and 3072-byte checks are computed from the dialect helpers, not observed. No SQL Server or MySQL instance runs this migration in CI. The `shortKeyType` choice is reasoning about a documented cap, and reasoning is what put the original 900-byte problem into `facility_map`.
2. **Nothing proves the ledger is complete against a real laboratory feed.** It proves the ledger mirrors `resource_history` and survives a rebuild. Whether `resource_history` records every transmission a lab makes — in particular a registration-only submission that may carry no DiagnosticReport — is a question about the ingest path and belongs to slice 2.
3. **Concurrency is untested.** Two projection cycles running against one resource, or a cycle racing a rebuild, are not exercised. The upsert is idempotent so the expected outcome is convergence, but that is an argument, not a test.
4. **Growth has no answer.** `ingest_events` grows with ingest volume and this slice adds no retention or pruning. It mirrors a table that already grows the same way, so the slice does not create the problem — but a national-scale deployment will need one.
