import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { createInternalDb, type InternalDb } from '../internal-db';
import { createMigrator } from '../migrator';
import { internalMigrations } from '../migrations/internal/index';
import { externalMigrations } from '../migrations/external/index';
import type { ExternalSchema } from '../schema/external';
import { createFhirStore, type FhirStore } from '../fhir-store';
import { createRelationalWriter, type RelationalWriter } from '../relational-writer';
import type { Provenance } from '../provenance';
import type { FhirResource } from '@openldr/fhir';
import { createProjectionRunner, reprojectAll, type ProjectionRunner } from './cycle';
import { fetchSafeChangeRows } from './fetch';
import { readArrivals } from './ledger';

const logger = { info() {}, error() {}, warn() {}, debug() {} };

// The contrast this file exists to prove: `ingest_events` records WHEN a resource arrived, and that
// record survives a reprojection even though `created_at` cannot answer the same question.
// `lab_requests.created_at` looks like an arrival time and is not — the projection never writes it,
// so it falls to the column default `now()`, the moment the WAREHOUSE row was FIRST written. It is
// a "first written" stamp, not a "last written" one: `batch-upsert.ts`'s `ON CONFLICT` deliberately
// excludes `created_at` from its UPDATE SET, so an ordinary reprojection over rows that already
// exist leaves it untouched, and it only moves on a fresh INSERT (e.g. after a warehouse-side wipe).
// Either way it holds exactly one timestamp per row, for ever, so a resource that arrives on the 5th
// and is corrected on the 12th answers "did anything arrive that day" twice and `created_at` can
// only answer once (016_ingest_events.ts's own comment: all 7,520 real requests carried created_at
// 2026-08-06 while their authored_at spanned 2013-03-01..2013-11-07).
//
// This needs REAL Postgres on both sides — pg-mem cannot prove a rebuild (AGENTS.md §7: no
// correlated-subquery support, stable scan order) — and it needs BOTH an internal database (where
// fhirStore.save() writes fhir.resource_history, the source this rebuild reads) and a target/external
// database (where ingest_events lives). Gated and provisioned like
// packages/bootstrap/src/facility-import-live.test.ts (internal) and
// packages/reporting/src/seed/clinical-micro-header-live.test.ts (external): each side gets its OWN
// throwaway database, dropped in afterAll, so this never touches a shared dev database. Skipped when
// either URL is unset, so it does not run in the ordinary gate; a skipped run is not a pass.
const targetUrl = process.env.TARGET_DATABASE_URL;
const internalUrl = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!targetUrl || !internalUrl);

const makeServiceRequest = (id: string): FhirResource => ({
  resourceType: 'ServiceRequest', id, status: 'completed', intent: 'order',
  subject: { reference: 'Patient/p-1' },
}) as unknown as FhirResource;

// WHY THIS EXISTS — do not "simplify" back to a single `runner.runCycle()` call.
//
// `fetchSafeChangeRows` (fetch.ts:20-23) reads `pg_snapshot_xmin`/`xmax` for the WHOLE Postgres
// INSTANCE, not scoped to this test's own throwaway database, and `planProjection` (plan.ts:66,82)
// deliberately DEFERS any row at or past that boundary to a later cycle — that is correct
// production gap-safety logic, not a bug, so one `runCycle()` is not a guarantee a just-saved
// row projects on that tick.
//
// Reproduced concretely, twice: when the full @openldr/db suite runs with both live URLs set,
// `082_facility_canonical_identity.live.test.ts` holds a ~240s bulk-insert transaction open
// against the SAME Postgres instance, pinning the cluster-wide xmin low enough that a
// freshly-committed row in this file's unrelated throwaway database still reads as unsafe. A
// single `runCycle()` then sees zero tasks for it — not because live projection is broken, but
// because the deferral is doing its job and this test didn't wait for it to clear. That read as a
// flaky test failure until traced back to this cause.
//
// So: poll `runCycle()` until the expected rows land, bounded by wall-clock time, and fail loudly
// (never silently) if they never do — a timeout here must still read as a failure, not let the
// caller's assertion run against an empty result and report a confusing, unrelated mismatch.
async function pollUntilProjected(runner: ProjectionRunner, check: () => Promise<boolean>, what: string): Promise<void> {
  const maxWaitMs = 250_000; // > the ~240s 082 bulk-insert transaction observed pinning xmin
  const intervalMs = 2_000;
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    await runner.runCycle();
    if (await check()) return;
    if (Date.now() >= deadline) {
      throw new Error(`pollUntilProjected: "${what}" did not land within ${maxWaitMs}ms across repeated runCycle() calls`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

live('arrival ledger rebuild from resource_history (live Postgres)', () => {
  const targetAdmin = new pg.Pool({ connectionString: targetUrl });
  const internalAdmin = new pg.Pool({ connectionString: internalUrl });
  const targetDbName = `openldr_al_target_${randomUUID().replace(/-/g, '')}`;
  const internalDbName = `openldr_al_internal_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<ExternalSchema>;
  let internal: InternalDb;
  let fhirStore: FhirStore;
  let relationalWriter: RelationalWriter;
  let runner: ProjectionRunner;
  const provenance: Provenance = {};

  beforeAll(async () => {
    await targetAdmin.query(`create database "${targetDbName}"`);
    await internalAdmin.query(`create database "${internalDbName}"`);

    const target = new URL(targetUrl!);
    target.pathname = `/${targetDbName}`;
    db = new Kysely<ExternalSchema>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const upExternal = await createMigrator(db as never, externalMigrations('postgres')).migrateToLatest();
    expect(upExternal.error).toBeUndefined();

    const internalTarget = new URL(internalUrl!);
    internalTarget.pathname = `/${internalDbName}`;
    internal = createInternalDb(internalTarget.toString());
    const upInternal = await createMigrator(internal.db as never, internalMigrations).migrateToLatest();
    if (upInternal.error) throw upInternal.error;

    fhirStore = createFhirStore(internal.db);
    relationalWriter = createRelationalWriter(db, 'postgres');
    runner = createProjectionRunner({
      internalDb: internal.db, fhirStore, relationalWriter, logger, fetch: fetchSafeChangeRows,
    });
  }, 120_000);

  afterAll(async () => {
    await internal?.close().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
    await targetAdmin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [targetDbName])
      .catch(() => undefined);
    await internalAdmin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [internalDbName])
      .catch(() => undefined);
    await targetAdmin.query(`drop database if exists "${targetDbName}"`).catch(() => undefined);
    await internalAdmin.query(`drop database if exists "${internalDbName}"`).catch(() => undefined);
    await targetAdmin.end().catch(() => undefined);
    await internalAdmin.end().catch(() => undefined);
  });

  it('records every version, not only the newest', async () => {
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);
    await fhirStore.save(makeServiceRequest('multi-1'), provenance);

    await reprojectAll({ internalDb: internal.db, relationalWriter });

    const rows = await db.selectFrom('ingest_events').select(['version', 'recorded_at'])
      .where('resource_id', '=', 'multi-1').orderBy('version').execute();
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2, 3]);
    // Three DISTINCT arrival times, not one repeated — the ledger records when each version
    // landed, which is the whole point. Equal timestamps would mean it recorded the rebuild.
    //
    // DEVIATION FROM THE BRIEF: `String(date)` (`Date.prototype.toString()`) prints only
    // whole-second precision ("Tue Aug 18 2026 00:52:01 GMT+0000..."), not milliseconds. Three
    // real saves complete well within one second, so the brief's literal `String(r.recorded_at)`
    // collapsed all three into one identical string and failed even though the underlying rows
    // carried genuinely distinct millisecond timestamps — confirmed by re-running the same fixture
    // with `JSON.stringify` (which calls `toISOString()`) instead, which showed three different
    // values. `.toISOString()` is the correct way to compare Date instances by wall-clock value.
    expect(new Set(rows.map((r) => (r.recorded_at as Date).toISOString())).size).toBe(3);
  });

  it('is idempotent — a second rebuild changes nothing', async () => {
    await fhirStore.save(makeServiceRequest('idem-1'), provenance);
    await reprojectAll({ internalDb: internal.db, relationalWriter });

    const first = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();

    await reprojectAll({ internalDb: internal.db, relationalWriter });

    const second = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    expect(second).toEqual(first);
  });

  it('records no arrival for a config resource', async () => {
    // Organization churns 46x per resource on real data; Location 399x. Recording config edits
    // would let an operator saving a form look identical to a laboratory transmitting results.
    await fhirStore.save({ resourceType: 'Organization', id: 'org-1', name: 'Somewhere' } as unknown as FhirResource, provenance);
    await reprojectAll({ internalDb: internal.db, relationalWriter });

    const rows = await db.selectFrom('ingest_events').select(['resource_id'])
      .where('resource_type', '=', 'Organization').execute();
    expect(rows).toHaveLength(0);
  });

  it('survives a rebuild that re-inserts the projected rows', async () => {
    const before = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    const createdBefore = await db.selectFrom('lab_requests').select(['id', 'created_at'])
      .orderBy('id').execute();
    expect(before.length, 'fixture must produce arrivals or this test proves nothing').toBeGreaterThan(0);
    expect(createdBefore.length, 'fixture must have already-projected warehouse rows or this test proves nothing').toBeGreaterThan(0);

    // `insertBatchPg`'s ON CONFLICT deliberately EXCLUDES `created_at` from its UPDATE SET (verified:
    // packages/db/src/batch-upsert.ts, `updateCols = ... filter(c => !conflictCols.includes(c) &&
    // c !== 'created_at')`), so a plain second `reprojectAll` call over rows that already exist would
    // leave every `created_at` untouched and prove nothing — the three tests above already
    // reprojected these same resources once, so that call would only ever UPDATE, never INSERT.
    // Deleting the projected rows here, without touching `fhir.resource_history` or `ingest_events`,
    // forces the next `reprojectAll` down the INSERT path instead — reproducing a real warehouse-side
    // wipe (e.g. `db reset` on the target schema followed by `db reproject`), the one case where
    // `created_at` genuinely moves.
    await db.deleteFrom('lab_requests').execute();

    await reprojectAll({ internalDb: internal.db, relationalWriter });

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

  it('records no arrival for a deleted version, permanently', async () => {
    // Two real upserts, then a real delete(). fhirStore.delete() writes its OWN resource_history
    // row: { op: 'delete', resource: null } (fhir-store.ts:347) at the next version number — so this
    // resource has THREE history rows (v1 upsert, v2 upsert, v3 delete tombstone) by the time we
    // reproject. Fixtures go through the real save()/delete() paths, never a hand-inserted row, so
    // resource_history is populated by the code under test.
    await fhirStore.save(makeServiceRequest('deleted-1'), provenance);
    await fhirStore.save(makeServiceRequest('deleted-1'), provenance);
    const del = await fhirStore.delete('ServiceRequest', 'deleted-1');
    expect(del).toEqual({ deleted: true, version: 3 });

    await reprojectAll({ internalDb: internal.db, relationalWriter });

    const rows = await db.selectFrom('ingest_events').select(['version'])
      .where('resource_type', '=', 'ServiceRequest').where('resource_id', '=', 'deleted-1')
      .orderBy('version').execute();
    // The two real upserts are recorded...
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2]);
    // ...and the tombstone (version 3) is not, and never becomes one on a later rebuild:
    // resource_history is append-only, so an unfiltered scan would make this false arrival permanent.
    await reprojectAll({ internalDb: internal.db, relationalWriter });
    const afterSecondRebuild = await db.selectFrom('ingest_events').select(['version'])
      .where('resource_type', '=', 'ServiceRequest').where('resource_id', '=', 'deleted-1')
      .orderBy('version').execute();
    expect(afterSecondRebuild.map((r) => Number(r.version))).toEqual([1, 2]);
  });

  it('readArrivals returns exactly the upsert versions, oldest first, correctly mapped', async () => {
    // Exercises readArrivals directly (Task 3's live path depends on it) rather than only the
    // rebuild scan's own inline mapping — this is the only test that calls it against real Postgres.
    await fhirStore.save(makeServiceRequest('read-arrivals-1'), provenance);
    await fhirStore.save(makeServiceRequest('read-arrivals-1'), provenance);
    await fhirStore.save(makeServiceRequest('read-arrivals-1'), provenance);
    await fhirStore.delete('ServiceRequest', 'read-arrivals-1');

    const arrivals = await readArrivals(internal.db, 'ServiceRequest', 'read-arrivals-1');

    expect(arrivals).toHaveLength(3);
    expect(arrivals.map((a) => a.version)).toEqual([1, 2, 3]);
    for (const a of arrivals) {
      expect(a.resource_type).toBe('ServiceRequest');
      expect(a.resource_id).toBe('read-arrivals-1');
      expect(a.recorded_at).toBeInstanceOf(Date);
    }
    // Strictly increasing recorded_at, oldest first — not just three distinct values in any order.
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i].recorded_at.getTime()).toBeGreaterThanOrEqual(arrivals[i - 1].recorded_at.getTime());
    }
  });

  it('records the arrival on the LIVE path, without a rebuild', async () => {
    // The rebuild is not run in this test at all. If ingest_events is populated, it is because the
    // projection cycle wrote it.
    await fhirStore.save(makeServiceRequest('live-1'), provenance);
    // Not a single runCycle() — see pollUntilProjected's comment above.
    await pollUntilProjected(runner, async () => {
      const rows = await db.selectFrom('ingest_events').select(['resource_id'])
        .where('resource_id', '=', 'live-1').execute();
      return rows.length >= 1;
    }, 'live-1 arrival');

    const rows = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version'])
      .where('resource_id', '=', 'live-1').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_type).toBe('ServiceRequest');
  }, 260_000);

  it('live and rebuild agree when two versions arrive between cycles', async () => {
    // The cycle sees ONE task for the resource. Recording only the newest version would lose the
    // first arrival, and a later rebuild would then disagree with the live path.
    await fhirStore.save(makeServiceRequest('live-2'), provenance);
    await fhirStore.save(makeServiceRequest('live-2'), provenance); // second version, same cycle
    // Not a single runCycle() — see pollUntilProjected's comment above.
    await pollUntilProjected(runner, async () => {
      const rows = await db.selectFrom('ingest_events').select(['version'])
        .where('resource_id', '=', 'live-2').execute();
      return rows.length >= 2;
    }, 'live-2 both versions');

    const live = await db.selectFrom('ingest_events').select(['version'])
      .where('resource_id', '=', 'live-2').orderBy('version').execute();
    expect(live.map((r) => Number(r.version))).toEqual([1, 2]);
  }, 260_000);
});
