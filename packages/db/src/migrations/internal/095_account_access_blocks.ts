import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('account_access_blocks').ifNotExists()
    .addColumn('subject', 'text', c => c.primaryKey()).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('account_access_blocks').ifExists().execute();
}
