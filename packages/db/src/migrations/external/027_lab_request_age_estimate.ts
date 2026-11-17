import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { booleanType } from './dialect';

// Whether lab_requests.age_days is an estimate (spec 2026-11-17-mapping-review.md, storage agreement).
// Map to FHIR converts months and years to days with average lengths and marks them daysEstimated in
// the age-at-request extension; the projector mirrors that mark here. The operator chose a typed
// column on 2026-11-17 (AGENTS.md section 8). Existing rows stay null: their estimate status is unknown.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('lab_requests').addColumn('age_days_estimated', sql.raw(booleanType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('lab_requests').dropColumn('age_days_estimated').execute();
}
