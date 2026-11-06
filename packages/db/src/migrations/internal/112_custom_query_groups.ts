import { type Kysely, sql } from 'kysely';

// Groups for custom queries on the Query page. A content pack can add twenty queries at once, and
// one flat list made them hard to tell apart. A query is in one group or none.
//
// Groups belong to this install. They are not part of reference sync: the sync body and its hash
// read named columns only (sync-serve.ts, custom-query-store.ts hashOf), and the applier's upsert
// sets only the columns it builds, so a central pull never moves a lab's queries.
//
// No foreign key. Deleting a group clears group_id on its queries in the same transaction
// (createCustomQueryGroupStore.remove).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('custom_query_groups').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.alterTable('custom_queries').addColumn('group_id', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('custom_queries').dropColumn('group_id').execute();
  await db.schema.dropTable('custom_query_groups').ifExists().execute();
}
