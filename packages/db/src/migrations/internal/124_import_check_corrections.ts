import { type Kysely, sql } from 'kysely';

// Corrections a person made to a held request before checking it again (design
// 2026-11-18-held-corrections). The source rows in `import_copy_rows` are never changed: a
// correction sits beside them, one row per copy, key and field, with the value it replaces, the
// reason, who and when. A second correction of the same field replaces the first.
//
// `import_check_held.fields` keeps the values as read that the plugin sent with a held request,
// so the form can show them without reading the source again. Null when the plugin sent none.
// Both may hold source values, as `import_check_held.findings` does.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('import_check_corrections').ifNotExists()
    .addColumn('copy_id', 'text', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('field', 'text', (c) => c.notNull())
    .addColumn('value', 'text')
    .addColumn('original', 'text')
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('corrected_by', 'text', (c) => c.notNull())
    .addColumn('corrected_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('import_check_corrections_pk', ['copy_id', 'key', 'field'])
    .execute();
  await sql`alter table import_check_held add column if not exists fields jsonb`.execute(db);
  // The pass of the check run that held the request, so a recheck moves the counts only of the pass
  // that counted it (review H4). Null on rows held before passes were named.
  await sql`alter table import_check_held add column if not exists pass text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table import_check_held drop column if exists pass`.execute(db);
  await sql`alter table import_check_held drop column if exists fields`.execute(db);
  await db.schema.dropTable('import_check_corrections').ifExists().execute();
}
