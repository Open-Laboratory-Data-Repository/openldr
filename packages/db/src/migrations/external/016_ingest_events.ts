import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType, shortKeyType, timestampType } from './dialect';

// The warehouse mirror of `fhir.resource_history` — one row per arrival of a clinical resource.
//
// ⛔ WHY THIS TABLE EXISTS AT ALL. `lab_requests.created_at` looks like an arrival time and is not:
// the projection never writes it (`relational/service-request.ts` writes nine columns plus
// `provColumns`, which is four provenance columns and no timestamp), so it falls to the column
// default `now()` — the moment the WAREHOUSE row was FIRST written. `batch-upsert.ts` deliberately
// excludes `created_at` from every UPDATE SET, so a reprojection over an existing row leaves it
// untouched; it only moves on a fresh INSERT (e.g. after a warehouse-side wipe). Either way it holds
// exactly one timestamp per row, for ever, so it cannot answer "did anything arrive on day X" for a
// resource that also arrived, or was corrected, on some other day. Measured 2026-08-17: all 7,520
// requests carried created_at 2026-08-06 (the day they were first (re)projected) while their
// authored_at spanned 2013-03-01..2013-11-07. A transmission report built on that column shows a
// wall of green on the projection date and nothing anywhere else.
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
