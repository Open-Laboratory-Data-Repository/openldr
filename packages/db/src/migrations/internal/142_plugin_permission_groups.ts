import { type Kysely, sql } from 'kysely';

// Plugin host step 2b, ruling 1 as amended on 2026-11-23: plugin permission groups are owned for
// good. A permission key's first segment is its group (`lab` for `lab.orders.receive`). The first
// plugin to install a key in a group owns that group, and no other plugin may ever declare a key in
// it. A row is never deleted, not even when the plugin is removed, so a later plugin cannot pick up
// the grants roles still hold for the group.
//
// A claim belongs to a plugin id and a publisher. `publisher` is the fingerprint of the key the
// install's signature check verified, or null when the plugin was installed without a verified
// signature. A plugin with the same id from another publisher, or unsigned after signed (or the
// reverse), cannot use the group. `plugins.publisher` keeps the same value for each stored version,
// so a rollback or an enable can be checked against the claim.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('plugin_permission_groups')
    .ifNotExists()
    .addColumn('group', 'text', (c) => c.primaryKey())
    .addColumn('plugin_id', 'text', (c) => c.notNull())
    .addColumn('publisher', 'text')
    .addColumn('claimed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.alterTable('plugins').addColumn('publisher', 'text').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('plugins').dropColumn('publisher').execute();
  await db.schema.dropTable('plugin_permission_groups').ifExists().execute();
}
