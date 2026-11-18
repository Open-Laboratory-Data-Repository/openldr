import { type Kysely, sql } from 'kysely';

/**
 * One row per time a long job was cut off: a server restart, a lease that ran out, or an event
 * that ran out of attempts. Each worker that takes a job back writes it, and the studio and CLI
 * show it (design 2026-11-18-interrupted-jobs). `(job_kind, job_id, at)` is unique, so a worker
 * that meets the same cut twice records it once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('job_interruptions')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('job_kind', 'text', (c) => c.notNull())
    .addColumn('job_id', 'text', (c) => c.notNull())
    .addColumn('phase', 'text')
    .addColumn('at', 'timestamptz', (c) => c.notNull())
    .addColumn('cause', 'text', (c) => c.notNull())
    .addColumn('resumed_at', 'timestamptz')
    .addColumn('resumed_by', 'text')
    .addColumn('continued_as', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('job_interruptions_one_cut', ['job_kind', 'job_id', 'at'])
    .execute();
  await db.schema.createIndex('job_interruptions_job').on('job_interruptions').columns(['job_kind', 'job_id']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('job_interruptions').execute();
}
