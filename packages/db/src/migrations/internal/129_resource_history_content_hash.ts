import { type Kysely, sql } from 'kysely';

// The content hash of each stored version (item 16). A save that asks to skip unchanged records
// compares a record's hash with the hash on the latest history row of that record. The hash sits on
// the version it describes, so it cannot go stale: a writer that does not set it leaves it empty,
// and an empty hash never matches. Nullable, with no backfill: a row from before has none, so its
// record is written once more and can be skipped from then on.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table fhir.resource_history add column if not exists content_hash text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table fhir.resource_history drop column if exists content_hash`.execute(db);
}
