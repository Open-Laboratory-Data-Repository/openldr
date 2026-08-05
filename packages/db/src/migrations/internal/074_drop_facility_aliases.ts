import { type Kysely, sql } from 'kysely';

// `facility_aliases` (migration 070) is superseded by the terminology approach: observed facility
// strings are concepts in a per-feed coding system, mapped through `term_mappings` to
// `facility_registry` rows. Keeping both would leave two answers to one question in the codebase.
//
// Measured 0 rows before the drop, so nothing is lost. Its FK was `registry_id → facility_registry.id
// ON DELETE CASCADE`, which silently destroyed a lab's mappings whenever a facility was deleted —
// the exact behaviour the new design replaces with a warn-before / surface-after orphan state
// (`GET /api/facilities/:id/impact` plus the Observed tab's `target missing`).
//
// `down` recreates the table's shape (transcribed from 070_facility_registry.ts) but cannot recover
// rows; it exists so the migration is reversible in shape, not in data.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_aliases').ifExists().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('facility_aliases')
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('registry_id', 'text', (c) => c.notNull().references('facility_registry.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text')
    // THE PK IS THE DESIGN: one alias resolves to exactly ONE facility, while many aliases point at
    // one registry row. That is the multi-LIS answer — a second LIS adds aliases, never forks the
    // registry — and it makes reconciliation idempotent.
    .addPrimaryKeyConstraint('facility_aliases_pk', ['source_system', 'source_code'])
    .execute();

  await db.schema
    .createIndex('facility_aliases_registry_idx')
    .on('facility_aliases')
    .column('registry_id')
    .execute();
}
