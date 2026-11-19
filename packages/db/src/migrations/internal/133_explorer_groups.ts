import { type Kysely, sql } from 'kysely';

// Groups for the Query page's Connectors and Datasets branches, as Custom Queries already has
// (operator, 2026-11-19: "make groups a feature for all, connectors, datasets and custom queries").
//
// One pair of tables serves both branches. `kind` is 'connector' or 'dataset'. A group is a row of its
// own, so an empty group can exist. An item's row says which group it sits in. A row with a null
// group means the item was placed in no group on purpose, which a missing row does not say.
// Custom Queries keeps its own tables (migration for custom_query_groups): those travel with sync.
//
// Migration 132 kept a dataset's group as a name on the dataset. That moves here and the column goes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table if not exists explorer_groups (
    kind text not null,
    name text not null,
    created_at timestamptz not null default now(),
    primary key (kind, name)
  )`.execute(db);
  await sql`create table if not exists explorer_group_items (
    kind text not null,
    item_id text not null,
    group_name text,
    updated_at timestamptz not null default now(),
    primary key (kind, item_id)
  )`.execute(db);
  await sql`insert into explorer_groups (kind, name)
    select distinct 'dataset', group_name from warehouse_datasets where group_name is not null
    on conflict (kind, name) do nothing`.execute(db);
  await sql`insert into explorer_group_items (kind, item_id, group_name)
    select 'dataset', name, group_name from warehouse_datasets
    on conflict (kind, item_id) do nothing`.execute(db);
  await sql`alter table warehouse_datasets drop column if exists group_name`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table warehouse_datasets add column if not exists group_name text`.execute(db);
  await sql`update warehouse_datasets d set group_name = i.group_name
    from explorer_group_items i where i.kind = 'dataset' and i.item_id = d.name`.execute(db);
  await sql`drop table if exists explorer_group_items`.execute(db);
  await sql`drop table if exists explorer_groups`.execute(db);
}
