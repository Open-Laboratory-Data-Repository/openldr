import { type Kysely, sql } from 'kysely';

// Results that are not yet authorised stay out of the warehouse (lab module design 2026-11-22,
// ruling 5). The projection now deletes such a row when it sees the Observation, but a row
// projected before that stays until the Observation changes. This removes those rows once.
// The two statuses are written out here, not read from UNAUTHORISED_RESULT_STATUSES: a migration
// must do the same thing forever, even if that list changes later.
// Safe to run twice: a second run finds nothing to delete. Rows from before 024 have a null status
// and are not caught; a reproject fills their status and then deletes them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`delete from lab_results where status in ('preliminary', 'registered')`.execute(db);
}

// Nothing to restore. The rows came from FHIR, which still holds them; a reproject refills them if
// the projection filter is ever removed.
export async function down(_db: Kysely<unknown>): Promise<void> {}
