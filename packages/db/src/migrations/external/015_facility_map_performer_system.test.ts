import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { createMigrator } from '../../migrator';
import { externalMigrations } from './index';
import { backfillPerformerSystem } from './015_facility_map_performer_system';

// ⛔ MEASURED, not assumed: pg-mem cannot execute this migration's backfill at all. It has no
// support for a correlated subquery referencing the UPDATE target's own table -- verified in
// isolation (bypassing Kysely entirely) with the simplest possible case: a bare
// `select ... from t2 where t2.k = t1.k` inside either a SELECT list or a WHERE clause, aliased or
// not, with or without the CAST, all fail identically with "column t1.k does not exist" at
// query-build time (not a data-dependent runtime failure -- it throws even over an empty table).
// This is a pg-mem gap, not a defect in the migration: the identical statement, run against a real
// throwaway Postgres via this same createMigrator/migrateToLatest path, produces exactly the three
// rows the scenarios below expect (see the task-1 report for the raw run). Per this repo's own
// precedent for "provably correct on Postgres, unrunnable on the fake"
// (migrations/external/reset-roundtrip-live.test.ts,
// relational/questionnaire-response.roundtrip.test.ts), this exercises the real migration against a
// real, throwaway Postgres database rather than rewriting the SQL to placate pg-mem. Skips cleanly
// when no live test DB is configured (TARGET_DATABASE_URL unset); `makeMigratedExternalDb()` (used
// by every OTHER external-migration test) tolerates this same pg-mem gap for migration 015
// specifically -- see the comment in test-helpers-external.ts.
const url = process.env.TARGET_DATABASE_URL;
const live = describe.skipIf(!url);

live('015_facility_map_performer_system (live Postgres)', () => {
  const admin = new pg.Pool({ connectionString: url });
  const dbName = `openldr_rt_${randomUUID().replace(/-/g, '')}`;
  let db: Kysely<any>;

  beforeAll(async () => {
    await admin.query(`create database "${dbName}"`);
    const target = new URL(url!);
    target.pathname = `/${dbName}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: target.toString() }) }) });
    const migrator = createMigrator(db, externalMigrations('postgres'));
    const { error } = await migrator.migrateToLatest();
    expect(error).toBeUndefined();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined); // ends the target pool so the drop can proceed
    await admin
      .query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName])
      .catch(() => undefined);
    await admin.query(`drop database if exists "${dbName}"`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  });

  it('backfills the namespace observed for a (feed, code) pair', async () => {
    await sql`insert into diagnostic_reports (id, performer, performer_system, source_system)
      values ('dr-1', 'BAMAA', 'urn:openldr:default_fac', 'webhook-ingest')`.execute(db);
    await sql`insert into facility_map (id, source_system, source_code)
      values ('webhook-ingest|BAMAA', 'webhook-ingest', 'BAMAA')`.execute(db);

    await backfillPerformerSystem(db as never);

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map where id = 'webhook-ingest|BAMAA'`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: 'urn:openldr:default_fac' }]);
  });

  it("leaves '' when no diagnostic_reports row matches the dimension row", async () => {
    await sql`insert into facility_map (id, source_system, source_code)
      values ('webhook-ingest|ORPHAN', 'webhook-ingest', 'ORPHAN')`.execute(db);

    await backfillPerformerSystem(db as never);

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map where id = 'webhook-ingest|ORPHAN'`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: '' }]);
  });

  it('matches a NULL source_system dimension row stored as the empty string', async () => {
    await sql`insert into diagnostic_reports (id, performer, performer_system, source_system)
      values ('dr-2', 'NOFEED', 'urn:x:ns', null)`.execute(db);
    await sql`insert into facility_map (id, source_system, source_code)
      values ('|NOFEED', '', 'NOFEED')`.execute(db);

    await backfillPerformerSystem(db as never);

    const rows = await sql<{ performer_system: string }>`
      select performer_system from facility_map where id = '|NOFEED'`.execute(db);
    expect(rows.rows).toEqual([{ performer_system: 'urn:x:ns' }]);
  });
});
