import { type Kysely, sql } from 'kysely';

// Plugin host step 2b, ruling 1 as amended on 2026-11-23: plugin permission groups are owned for
// good. A permission key's first segment is its group (`lab` for `lab.orders.receive`). The first
// plugin to install a key in a group owns that group, and no other plugin may ever declare a key in
// it. A row is never deleted, not even when the plugin is removed, so a later plugin cannot pick up
// the grants roles still hold for the group.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('plugin_permission_groups')
    .ifNotExists()
    .addColumn('group', 'text', (c) => c.primaryKey())
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('claimed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('plugin_permission_groups').ifExists().execute();
}
