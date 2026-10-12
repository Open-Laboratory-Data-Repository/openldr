import { type Kysely, sql } from 'kysely';

// Patient duplicate detection (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md,
// section 2). One row says two patients are different people. The ids are stored in sorted order
// (patient_a < patient_b), so a pair has one row whichever way round it was dismissed. Patients live
// in the warehouse, so there is no foreign key.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('patient_duplicate_dismissals').ifNotExists()
    .addColumn('patient_a', 'text', (c) => c.notNull())
    .addColumn('patient_b', 'text', (c) => c.notNull())
    .addColumn('reason', 'text')
    .addColumn('dismissed_by', 'text', (c) => c.notNull())
    .addColumn('dismissed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('patient_duplicate_dismissals_pk', ['patient_a', 'patient_b'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('patient_duplicate_dismissals').ifExists().execute();
}
