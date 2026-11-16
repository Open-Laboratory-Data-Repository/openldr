import { type Kysely, sql } from 'kysely';

// Requests a check run held back or could not decode, kept until the operator deals with them.
//
// One row per copy and key. `reason` is 'held' (the plugin held the request) or 'error' (the decode
// call failed for it). `label` and `error` are bare codes, never a source value. `findings` and
// `check` are the plugin's own JSON, stored as it came. CE reads neither. They may hold source
// values, which is why only this table and `import_copy_rows` keep them.
//
// `check` is a reserved word in SQL. Kysely double-quotes every identifier it writes, so the column
// is safe in this migration and in every query built with Kysely. Do not write it in raw SQL
// without the quotes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('import_check_held').ifNotExists()
    .addColumn('copy_id', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('run_id', 'text', (c) => c.notNull())
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('label', 'text')
    .addColumn('error', 'text')
    .addColumn('findings', 'jsonb', (c) => c.notNull())
    .addColumn('check', 'jsonb', (c) => c.notNull())
    .addColumn('held_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('import_check_held_pk', ['copy_id', 'key'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_check_held').ifExists().execute();
}
