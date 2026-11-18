import { type Kysely } from 'kysely';

// Which roles may see a dashboard (design 2026-11-18-roles-scope, part 2). No row for a dashboard
// means what it meant before: every role with dashboards.view. Rows narrow it. Role ids, so a
// renamed role keeps its access; deleting a role deletes its rows.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('dashboard_access').ifNotExists()
    .addColumn('dashboard_id', 'text', (c) => c.notNull())
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('dashboard_access_pk', ['dashboard_id', 'role_id'])
    .execute();
  await db.schema.createIndex('dashboard_access_role_idx').ifNotExists().on('dashboard_access').column('role_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('dashboard_access').ifExists().execute();
}
