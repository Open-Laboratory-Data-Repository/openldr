import { type Kysely, sql } from 'kysely';

// Where a coding system came from: 'core' (CE seeds it), 'ingest' (made while projecting received
// data), 'import' (an admin imported a resource), or 'pack' (a content pack installed it, with the
// pack id in origin_ref). Null on rows written before this migration; the store falls back to
// register, core or user for those. Local metadata only: it is not part of the sync content hash.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('coding_systems')
    .addColumn('origin', 'text')
    .addColumn('origin_ref', 'text')
    .execute();
  // Rows whose source the writer's own constants make certain. Everything else stays null.
  await sql`update coding_systems set origin = 'ingest' where origin is null and system_name = 'Observed facilities'`.execute(db);
  await sql`update coding_systems set origin = 'import' where origin is null and system_code like 'FAC-%-OBSERVED'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('coding_systems').dropColumn('origin_ref').dropColumn('origin').execute();
}
