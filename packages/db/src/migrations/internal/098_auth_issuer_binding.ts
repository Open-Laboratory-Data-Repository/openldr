import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('auth_issuer_binding')
    .addColumn('id', 'integer', c => c.primaryKey())
    .addColumn('issuer', 'text', c => c.notNull())
    .addCheckConstraint('auth_issuer_binding_singleton', sql`id = 1`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('auth_issuer_binding').execute();
}
