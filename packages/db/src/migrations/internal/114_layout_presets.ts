import { type Kysely, sql } from 'kysely';

// Named studio layouts: which sidebar pages show and which page opens first. An admin makes them
// and picks one as the default for a role; a user may pick another (user_preferences.prefs.layout,
// migration 113, so no column here). A layout only hides pages, it never grants one.
//
// `pages` is a JSON array of studio paths, read through the shared layout code in
// @openldr/bootstrap, which drops anything that is not a studio path.
//
// role_layout_defaults: at most one default per role (role_id is the key). Both foreign keys
// cascade, so deleting a layout or a role leaves no default pointing at nothing.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createTable('layout_presets').ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('start_page', 'text')
    .addColumn('pages', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'text')
    .execute();
  await db.schema.createTable('role_layout_defaults').ifNotExists()
    .addColumn('role_id', 'text', (c) => c.primaryKey().references('roles.id').onDelete('cascade'))
    .addColumn('layout_id', 'text', (c) => c.notNull().references('layout_presets.id').onDelete('cascade'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('role_layout_defaults').ifExists().execute();
  await db.schema.dropTable('layout_presets').ifExists().execute();
}
