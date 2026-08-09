import { type Kysely, sql } from 'kysely';

// One durable record per facility import — FAC-P1-03's "record file hash, source release/version, row count,
// schema mapping, actor, and result", and (in A2b) the job row a background import is claimed from. Modelled on
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
    .addColumn('byte_size', 'integer', (c) => c.notNull()) // integer (not bigint): 2 GB ceiling is far above the 8 MB upload cap; round-trips as JS number
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
