import { type Kysely, sql } from 'kysely';

// Drops the table migration 091 created. The facility import's Data step let an operator repair a
// cell in the uploaded file, and the repairs lived here. The step was removed once the wizard worked
// end to end: every repair is made on the source file instead.
//
// 091 IS NOT DELETED, deliberately. It is already applied and recorded in `kysely_migration` on
// running installs. Removing the file would leave Kysely a recorded migration with no file, and the
// next feature to claim 091 would collide. So the history stays linear and this undoes the effect.
//
// `if exists`, because an install that never reached 091 has no table to drop and this must not be
// the migration that blocks its boot.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists facility_import_edits`.execute(db);
}

// Recreates the table exactly as 091 built it, so a down-migration past this point leaves 091's
// schema intact. The rows are gone either way: a drop is not reversible.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_import_edits')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('national_system', 'text', (c) => c.notNull())
    .addColumn('file_hash', 'text', (c) => c.notNull())
    .addColumn('header', 'text', (c) => c.notNull())
    .addColumn('line', 'integer')
    .addColumn('from_value', 'text')
    .addColumn('to_value', 'text', (c) => c.notNull())
    .addColumn('edit_key', 'text', (c) => c.notNull())
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create unique index facility_import_edits_key on facility_import_edits (edit_key)`.execute(db);

  await db.schema.createIndex('facility_import_edits_file')
    .on('facility_import_edits').columns(['national_system', 'file_hash']).execute();
}
