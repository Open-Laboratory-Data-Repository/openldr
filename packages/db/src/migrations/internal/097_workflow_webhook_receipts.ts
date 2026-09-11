import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('workflow_webhook_receipts')
    .addColumn('id', 'text', c => c.primaryKey())
    .addColumn('workflow_id', 'text', c => c.notNull())
    .addColumn('event_id', 'text', c => c.notNull().unique())
    .addColumn('run_id', 'text', c => c.notNull().unique())
    .addColumn('idempotency_key', 'text')
    .addColumn('input_digest', 'text', c => c.notNull())
    .addColumn('definition_digest', 'text', c => c.notNull())
    .addColumn('input', 'jsonb', c => c.notNull())
    .addColumn('files', 'jsonb', c => c.notNull())
    .addColumn('status', 'text', c => c.notNull().defaultTo('queued'))
    .addColumn('claim_token', 'text')
    .addColumn('created_at', 'timestamptz', c => c.notNull().defaultTo(sql`now()`))
    .addColumn('started_at', 'timestamptz')
    .addColumn('finished_at', 'timestamptz')
    .addColumn('reason', 'text')
    .addColumn('outcome', 'jsonb')
    .addUniqueConstraint('workflow_webhook_receipts_identity', ['workflow_id', 'idempotency_key'])
    .addCheckConstraint('workflow_webhook_receipts_status', sql`status in ('queued','running','completed','failed','interrupted','cancelled')`)
    .execute();
  await db.schema.createIndex('idx_workflow_webhook_receipts_history')
    .on('workflow_webhook_receipts').columns(['workflow_id', 'created_at', 'id']).execute();
}
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('workflow_webhook_receipts').execute();
}
