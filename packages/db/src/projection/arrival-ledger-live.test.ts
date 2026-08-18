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
import { reprojectAll } from './cycle';

// The contrast this file exists to prove: `ingest_events` records WHEN a resource arrived, and that
// record survives a reprojection even though reprojection rewrites every warehouse `created_at`.
// `lab_requests.created_at` looks like an arrival time and is not — the projection never writes it,
// so it falls to the column default `now()`, the moment the WAREHOUSE row was written, and
// `reprojectAll` rewrites every one of them (016_ingest_events.ts's own comment: all 7,520 real
// requests carried created_at 2026-08-06 while their authored_at spanned 2013-03-01..2013-11-07).
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

live('arrival ledger rebuild from resource_history (live Postgres)', () => {
  const targetAdmin = new pg.Pool({ connectionString: targetUrl });
  const internalAdmin = new pg.Pool({ connectionString: internalUrl });
  const targetDbName = `openldr_al_target_${randomUUID().replace(/-/g, '')}`;
  const internalDbName = `openldr_al_internal_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<ExternalSchema>;
  let internal: InternalDb;
  let fhirStore: FhirStore;
  let relationalWriter: RelationalWriter;
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

  it('survives a reprojection that rewrites every warehouse created_at', async () => {
    const before = await db.selectFrom('ingest_events')
      .select(['resource_type', 'resource_id', 'version', 'recorded_at'])
      .orderBy('resource_type').orderBy('resource_id').orderBy('version').execute();
    const createdBefore = await db.selectFrom('lab_requests').select(['id', 'created_at'])
      .orderBy('id').execute();
    expect(before.length, 'fixture must produce arrivals or this test proves nothing').toBeGreaterThan(0);
    expect(createdBefore.length, 'fixture must have already-projected warehouse rows or this test proves nothing').toBeGreaterThan(0);

    // DEVIATION FROM THE BRIEF, explained in the Task 2 report: `insertBatchPg`'s ON CONFLICT
    // deliberately EXCLUDES `created_at` from its UPDATE SET (verified: packages/db/src/batch-upsert.ts,
    // `updateCols = ... filter(c => !conflictCols.includes(c) && c !== 'created_at')`), so a plain
    // second reprojectAll call over rows that already exist leaves every created_at untouched — the
    // literal brief test body proved nothing here because the three tests above already reprojected
    // these same resources once, so this call would only ever UPDATE, never INSERT.
    // `created_at` is a "first written" stamp, not a "last written" one, and it only moves when the
    // warehouse row does not exist yet — exactly the situation after a warehouse-side wipe (e.g. a
    // real `db reset` on the target schema before `db reproject`). Deleting the projected rows here,
    // without touching `fhir.resource_history` or `ingest_events`, reproduces that scenario honestly.
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
});
