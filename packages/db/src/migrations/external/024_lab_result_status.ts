import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// A result's FHIR status and its reason for a missing value (docs/superpowers/specs/2026-10-12-
// lab-result-status-design.md). A test the bench rejects is a cancelled Observation carrying a
// dataAbsentReason; without these columns it reached the warehouse as an empty result row.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('lab_results').addColumn('status', text).execute();
  await db.schema.alterTable('lab_results').addColumn('data_absent_code', text).execute();
  await db.schema.alterTable('lab_results').addColumn('data_absent_reason', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('lab_results').dropColumn('data_absent_reason').execute();
  await db.schema.alterTable('lab_results').dropColumn('data_absent_code').execute();
  await db.schema.alterTable('lab_results').dropColumn('status').execute();
}
