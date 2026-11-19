import { type Kysely } from 'kysely';

// The finding codes of each held request, one row per copy, key and code (demo.4 item 10). The
// plugin names them with the request: the codes of the findings that held it, such as
// `specimen_missing`. A code is a bare word, never a source value. CE never reads inside
// `import_check_held.findings`, so the Held back filter by finding reads this table, and so do the
// counts per code. The rows of a key go with its held row: the held store writes and deletes both.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('import_check_held_codes').ifNotExists()
    .addColumn('copy_id', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('code', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('import_check_held_codes_pk', ['copy_id', 'key', 'code'])
    .execute();
  await db.schema.createIndex('import_check_held_codes_code_idx').ifNotExists()
    .on('import_check_held_codes').columns(['copy_id', 'code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('import_check_held_codes').ifExists().execute();
}
