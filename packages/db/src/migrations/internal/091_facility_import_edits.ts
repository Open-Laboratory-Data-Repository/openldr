import { type Kysely, sql } from 'kysely';

// Slice C of the facility import data stage. One row per cell repair the operator made on the
// Data grid, so a repaired file imports as repaired without the uploaded blob ever being rewritten.
//
// Keyed on `(national_system, file_hash)`, NOT on the run. A re-upload of the same bytes mints a
// new run, so run-keyed edits would vanish the moment the operator re-uploaded for an unrelated
// reason. `file_hash` is a sha256 of the bytes and is `notNull` on every run (migration 080), so a
// file that actually changed gets a different hash and its old edits stop applying, which is right:
// the line numbers they name would no longer mean anything.
//
// Two shapes share this table. `line` set with `from_value` null is one cell. `line` null with
// `from_value` set is every cell in that column holding that value, which is what the grid's
// "change it everywhere" writes: one row instead of 3 788.
//
// PLAIN unique index over a computed `edit_key`, never a partial index on `line`. pg-mem
// mishandles partial indexes for the reason migration 080 documents at length, and the two shapes
// above would otherwise need one predicate each.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_import_edits')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('national_system', 'text', (c) => c.notNull())
    .addColumn('file_hash', 'text', (c) => c.notNull())
    // The SOURCE header, spelled exactly as the file spells it, never a contract field. That is what
    // lets an edit reach a column carried through as extra data, which has no contract field at all.
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

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_import_edits').execute();
}
