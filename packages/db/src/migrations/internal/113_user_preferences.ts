import { type Kysely, sql } from 'kysely';

// One row per user for the studio look: theme, sidebar state and first page. These lived only in
// the browser's localStorage, so they did not follow a user to another browser or a phone.
//
// One JSON column, not a column per setting. The keys are read through parseStoredPreferences
// (@openldr/bootstrap), which drops anything it does not know, so adding a setting later needs
// no migration.
//
// No foreign key to users. A user can sign in through the identity provider before a local users
// row exists, and their preferences must still save.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('user_preferences').ifNotExists()
    .addColumn('user_id', 'text', (c) => c.primaryKey())
    .addColumn('prefs', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_preferences').ifExists().execute();
}
