import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('fhir.projection_retries')
    .addColumn('resource_type', 'text', c => c.notNull())
    .addColumn('resource_id', 'text', c => c.notNull())
    .addColumn('attempts', 'integer', c => c.notNull())
    .addColumn('next_attempt_at', 'timestamptz', c => c.notNull())
    .addPrimaryKeyConstraint('projection_retries_pkey', ['resource_type', 'resource_id'])
    .execute();
  await db.schema.createIndex('projection_retries_due')
    .on('fhir.projection_retries').columns(['next_attempt_at', 'resource_type', 'resource_id']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('fhir.projection_retries').execute();
}
