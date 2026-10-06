import { type Kysely, sql } from 'kysely';

// A content pack is recorded in marketplace_installs without a form, and an install can now fail
// part way. So target_form_id may be null, and each row carries a status, the step that failed, and
// the error text. Rows written before this migration read as installed.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('marketplace_installs').alterColumn('target_form_id', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('marketplace_installs')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('installed'))
    .addColumn('failed_step', 'integer')
    .addColumn('error', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('marketplace_installs').dropColumn('error').dropColumn('failed_step').dropColumn('status').execute();
  await sql`delete from marketplace_installs where target_form_id is null`.execute(db);
  await db.schema.alterTable('marketplace_installs').alterColumn('target_form_id', (c) => c.setNotNull()).execute();
}
