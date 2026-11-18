import { type Kysely, sql } from 'kysely';

/**
 * A running job writes its heartbeat; a worker takes back only a job whose heartbeat is old, so a
 * job a live process is still running (such as a CLI's inline terminology import) is never taken
 * back and run a second time (design 2026-11-18-interrupted-jobs).
 *
 * `if not exists`: the 2026-11-18 demo build added these columns under migration 122, so a demo
 * install upgraded to a release must not fail here.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table terminology_ingest_jobs add column if not exists heartbeat_at timestamptz`.execute(db);
  await sql`alter table facility_jobs add column if not exists heartbeat_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facility_jobs').dropColumn('heartbeat_at').execute();
  await db.schema.alterTable('terminology_ingest_jobs').dropColumn('heartbeat_at').execute();
}
