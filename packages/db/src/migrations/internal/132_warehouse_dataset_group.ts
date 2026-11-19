import { type Kysely, sql } from 'kysely';

// The Query page group a pack dataset sits in (pack datasets design). A dataset starts in a group
// named for the pack that installed it, so a reader can tell where it came from, and it can be moved
// to another group or to none, as a custom query can. A group here is only a name on the dataset:
// it exists while a dataset carries it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table warehouse_datasets add column if not exists group_name text`.execute(db);
  await sql`update warehouse_datasets set group_name = owner_pack where group_name is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table warehouse_datasets drop column if exists group_name`.execute(db);
}
