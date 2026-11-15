import { type Kysely, sql } from 'kysely';

// Rows copied from a source database, kept on CE's own disk.
//
// One row per source row. `copy_id` names the copy, `set_name` the set of queries, and
// `detail_name` the query inside that set the row came from. `key` is the source key the row is
// filed under, and `seq` counts the rows of one detail and key from 0, in the order they arrived.
// `row` is the row as the reader returned it.
//
// The primary key is all five names, so a page written twice cannot store a row twice, and a
// copy can be emptied in primary key order. `key` comes before `detail_name` because a page is
// deleted and read by copy, set and key. With that order Postgres seeks to each key instead of
// scanning every stored row of the set.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('import_copy_rows').ifNotExists()
    .addColumn('copy_id', 'text', (c) => c.notNull())
    .addColumn('set_name', 'text', (c) => c.notNull())
    .addColumn('detail_name', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull())
    .addColumn('row', 'jsonb', (c) => c.notNull())
    .addColumn('read_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('import_copy_rows_pk', ['copy_id', 'set_name', 'key', 'detail_name', 'seq'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_copy_rows').ifExists().execute();
}
