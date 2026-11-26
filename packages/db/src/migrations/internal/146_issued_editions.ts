import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issued_report_editions')
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('edition_id', 'text', (c) => c.notNull())
    .addColumn('content_hash', 'text', (c) => c.notNull())
    .addColumn('report_id', 'text', (c) => c.notNull())
    .addColumn('versions', 'jsonb', (c) => c.notNull())
    .addPrimaryKeyConstraint('issued_report_editions_pk', ['plugin_id', 'edition_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('issued_report_editions').execute();
}
