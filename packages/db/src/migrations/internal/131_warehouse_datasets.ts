import { type Kysely, sql } from 'kysely';

// Datasets a content pack defines (pack datasets design, 2026-11-19). Each is a name and one SELECT.
// CE stores the SELECT's result as the table `dataset.<name>` in the warehouse, and rebuilds it after
// the warehouse changes. This table records the definitions and the last build of each. The built
// tables themselves live in the warehouse database, not here.
//
// `built_at_seq` is the newest change number (fhir.change_log.seq) the warehouse held when the last
// build started. A dataset whose number is below the newest change is out of date.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table if not exists warehouse_datasets (
    name text primary key,
    owner_pack text not null,
    sql text not null,
    indexes jsonb not null default '[]',
    position integer not null,
    built_at_seq bigint,
    built_at timestamptz,
    build_ms integer,
    row_count bigint,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists warehouse_datasets`.execute(db);
}
