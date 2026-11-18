import { type Kysely, sql } from 'kysely';

// A user's data limit (design 2026-11-18-roles-scope, part 3). Keyed by the role subject, the same
// key as user_roles.user_id, so capability resolution can read it. No row, or a row with limited
// false, means Everything: what every user had before. A limited row with no items sees nothing.
// An item is a register facility (value = facility_registry.id), a region (value = the region), or
// a district (value = the district, region = its region, because district names repeat).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('user_data_scopes').ifNotExists()
    .addColumn('subject', 'text', (c) => c.primaryKey())
    .addColumn('limited', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createTable('user_data_scope_items').ifNotExists()
    .addColumn('subject', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('region', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('value', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('user_data_scope_items_pk', ['subject', 'kind', 'region', 'value'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_data_scope_items').ifExists().execute();
  await db.schema.dropTable('user_data_scopes').ifExists().execute();
}
