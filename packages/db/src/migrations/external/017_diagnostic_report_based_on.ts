import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// `diagnostic_reports.batch_id` carries up to 15 reports (measured on the current warehouse), so
// `min(issued)` over a batch attributes one report's authorisation date to a different request. The
// transmission report's step-3 fallback (registered -> tested -> authorised) needs one report tied
// to one request, not to a whole submission. This column is that tie: `DiagnosticReport.basedOn[0]`,
// the ServiceRequest the report answers.
//
// ⛔ NULLABLE, NO BACKFILL. Unlike migration 015's `performer_system`, this value cannot be derived
// from existing warehouse rows: `diagnostic_reports.id` is the wire id the CDR toolchain mints, and
// it happens to equal `lab_requests.id` for that one source, for no reason a migration can rely on
// (see the projection's own comment). The source of truth is `fhir.fhir_resources`, so populating
// existing rows needs `openldr db reproject --force`, a deploy step, not a migration step.
//
// The two indexes are REQUIRED, not optional. The transmission report runs one correlated lookup per
// request against `lab_results` (80,141 rows measured) and one against `diagnostic_reports` (23,285
// rows measured), and neither table carried an index beyond its primary key before this migration.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('diagnostic_reports')
    .addColumn('based_on_id', sql.raw(keyType(engine)))
    .execute();
  await db.schema.createIndex('diagnostic_reports_based_on_idx')
    .on('diagnostic_reports').column('based_on_id').execute();
  await db.schema.createIndex('lab_results_request_idx')
    .on('lab_results').column('request_id').execute();
}

// ⛔ ENGINE-CONDITIONAL, measured, not guessed. Kysely's dropIndex().on(table) always compiles to
// `drop index name on table`, on every dialect (there is no dialect-specific override in Kysely
// 0.28.17's DropIndexBuilder). MySQL and MSSQL both require that ON clause. Postgres does not have
// one at all; DROP INDEX there is bare `drop index name`, because index names are unique per schema.
// Calling `.on()` unconditionally breaks Postgres: pg-mem (which emulates Postgres) rejects it with
// a parse error, `Unexpected kw_on token`, and that is the same grammar real Postgres enforces.
export async function down(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  let dropResultIdx = db.schema.dropIndex('lab_results_request_idx');
  let dropReportIdx = db.schema.dropIndex('diagnostic_reports_based_on_idx');
  if (engine !== 'postgres') {
    dropResultIdx = dropResultIdx.on('lab_results');
    dropReportIdx = dropReportIdx.on('diagnostic_reports');
  }
  await dropResultIdx.execute();
  await dropReportIdx.execute();
  await db.schema.alterTable('diagnostic_reports').dropColumn('based_on_id').execute();
}
