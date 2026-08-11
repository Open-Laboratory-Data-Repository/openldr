import { type Kysely, sql } from 'kysely';

// Draft/published for report designs, mirroring form_definitions + form_versions (016, 019).
//
// The Report Designer autosaves 1.2s after a keystroke, and the design store captures a
// reference-sync change inside EVERY update transaction — so a mid-edit design propagated to every
// enrolled lab. Forms already solved this: the working copy stays in the main table, publishing
// snapshots into a versions table, and capture fires only when the result is published.
//
// ⛔ The backfill is not optional. `DEFAULT 'draft'` is right for new rows and WRONG for existing
// ones: they are live and already mirrored by labs, so leaving them draft means capture never fires
// for them again and every lab's copy freezes at whatever it holds — silently, and invisibly in the
// change log.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('report_designs')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('draft'))
    .execute();

  // Every design that existed before this migration is already published, by definition.
  await db.updateTable('report_designs').set({ status: 'published' } as never).execute();

  await db.schema.createIndex('report_designs_status').ifNotExists().on('report_designs').column('status').execute();

  await db.schema
    .createTable('report_design_versions')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('design_id', 'text', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('paper', 'text', (c) => c.notNull().defaultTo('A4'))
    .addColumn('orientation', 'text', (c) => c.notNull().defaultTo('portrait'))
    .addColumn('pages', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('parameters', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('margins', 'jsonb')
    .addColumn('page_numbers', 'boolean')
    .addColumn('published_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('published_by', 'text')
    .execute();

  await db.schema
    .createIndex('report_design_versions_design_version')
    .ifNotExists().on('report_design_versions').columns(['design_id', 'version']).unique()
    .execute();

  await db.schema
    .createIndex('report_design_versions_design_id')
    .ifNotExists().on('report_design_versions').column('design_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('report_design_versions').ifExists().execute();
  await db.schema.alterTable('report_designs').dropColumn('status').execute();
}
