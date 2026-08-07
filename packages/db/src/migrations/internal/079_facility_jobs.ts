import { type Kysely, sql } from 'kysely';

// Durable work for the facility subsystem: rebuilding the report-facing `facility_map`, and
// retrying a concept projection that failed inline. Before this, a rebuild was a hidden manual menu
// action and a failed projection was a `console.error` -- the interface could report success while
// reports disagreed.
//
// ⛔ `active_key` is an app-managed mirror of `kind`, non-null ONLY while the row is 'queued', and
// cleared by `claimNext` in the same statement that sets 'running'. A PLAIN unique index on it then
// buys two different properties:
//   - a rebuild request arriving while one is already QUEUED collides and is absorbed (coalescing),
//     so a 14 000-row CSV import enqueues one rebuild rather than 14 000;
//   - a request arriving while a rebuild is RUNNING sees a NULL active_key, so it inserts a FRESH
//     queued job instead of being swallowed by a build that has already read the data.
// The second property is the one an obvious implementation gets wrong.
//
// ⛔ Deliberately NOT a `WHERE status = 'queued'` partial unique index. Migration
// `061_terminology_ingest_jobs.ts` documents the reason at length: pg-mem's planner mishandles
// partial indexes -- once a row's status leaves the predicate it is excluded from ANY later query
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
    // Rows written by the last successful rebuild -- what the health chip reports, so it does not
    // have to reach into the EXTERNAL warehouse to count them. NULL for a projection-kind job.
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
