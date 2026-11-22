import { type Kysely, sql } from 'kysely';

// What each content pack made: a role, a layout or a form. The pack installer writes a row for each
// item a pack creates, so a reinstall finds the item it made before and an uninstall knows what is
// the pack's.
//
// `key` is the item's name inside the pack. `item_id` is the id of the row the pack made.
// The primary key (pack_id, kind, key) gives one row per pack item. The unique (kind, item_id)
// stops two packs claiming the same role, layout or form.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table if not exists content_pack_items (
    pack_id text not null,
    kind text not null,
    key text not null,
    item_id text not null,
    primary key (pack_id, kind, key),
    unique (kind, item_id)
  )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists content_pack_items`.execute(db);
}
