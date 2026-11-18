import type { Kysely } from 'kysely';

/**
 * A running job writes its heartbeat; a worker takes back only a job whose heartbeat is old, so a
 * job a live process is still running (such as a CLI's inline terminology import) is never taken
 * back and run a second time (design 2026-11-18-interrupted-jobs).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('terminology_ingest_jobs').addColumn('heartbeat_at', 'timestamptz').execute();
  await db.schema.alterTable('facility_jobs').addColumn('heartbeat_at', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facility_jobs').dropColumn('heartbeat_at').execute();
  await db.schema.alterTable('terminology_ingest_jobs').dropColumn('heartbeat_at').execute();
}
