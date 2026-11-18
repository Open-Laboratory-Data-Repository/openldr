import { type Kysely } from 'kysely';

// Which roles may open and which may submit a form (design 2026-11-18-roles-scope, part 1). No row
// for a form and mode means what it meant before: every role with the capability. Rows narrow it.
// Role ids, so a renamed role keeps its access; deleting a role deletes its rows.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('form_access').ifNotExists()
    .addColumn('form_id', 'text', (c) => c.notNull())
    .addColumn('role_id', 'text', (c) => c.notNull())
    .addColumn('mode', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('form_access_pk', ['form_id', 'role_id', 'mode'])
    .execute();
  await db.schema.createIndex('form_access_role_idx').ifNotExists().on('form_access').column('role_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('form_access').ifExists().execute();
}
