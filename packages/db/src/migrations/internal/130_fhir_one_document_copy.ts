import { type Kysely, sql } from 'kysely';

// One copy of each document (item 16). The current version of a record was stored twice: in
// fhir.fhir_resources and again in fhir.resource_history. Measured on 58,526 real records, the
// second copy was a third of the write-ahead log and 50 of the current table's 60 MiB.
//
// After this, the current table is fhir.fhir_current: one narrow row per record, naming its current
// version, with no document. fhir.fhir_resources stays, as a view that joins that row to the history
// row of that version. So every reader keeps its query, and only the store's writes change.
//
// Before the switch each current row gets the history row the view will read:
//  - Records seeded by older migrations were inserted straight into the current table and have no
//    history row. They get one, at their current version.
//  - Where a history row of the current version holds another document, or none, the current
//    document wins: it is what every reader has seen. Its stored hash no longer describes it, so the
//    hash is cleared. Going down cannot bring the replaced document back. No code writes such a row;
//    this is so that the view can never show a current record with a different or an empty document.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`insert into fhir.resource_history (resource_type, id, version, op, resource)
    select r.resource_type, r.id, r.version, 'upsert', r.resource
    from fhir.fhir_resources r
    left join fhir.resource_history h on h.resource_type = r.resource_type and h.id = r.id and h.version = r.version
    where h.id is null`.execute(db);

  const differing = await sql<{ n: number | string }>`select count(*) as n
    from fhir.fhir_resources r
    join fhir.resource_history h on h.resource_type = r.resource_type and h.id = r.id and h.version = r.version
    where h.resource is null or h.resource::text <> r.resource::text`.execute(db);
  if (Number(differing.rows[0]?.n ?? 0) > 0) {
    await sql`update fhir.resource_history h set resource = r.resource, op = 'upsert', content_hash = null
      from fhir.fhir_resources r
      where h.resource_type = r.resource_type and h.id = r.id and h.version = r.version
        and (h.resource is null or h.resource::text <> r.resource::text)`.execute(db);
  }

  await sql`create table fhir.fhir_current (
    resource_type text not null,
    id text not null,
    version bigint not null default 1,
    version_id text,
    source_system text,
    plugin_id text,
    plugin_version text,
    batch_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (resource_type, id)
  )`.execute(db);
  await sql`insert into fhir.fhir_current (resource_type, id, version, version_id, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at)
    select resource_type, id, version, version_id, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at
    from fhir.fhir_resources`.execute(db);
  // Fresh statistics for the new table, so the first queries over the view plan well. Asked for
  // only where the database has it: pg-mem does not, and a refused statement would end the
  // migration's transaction on PostgreSQL.
  const canAnalyze = await sql<{ v: string }>`select version() as v`.execute(db).then((r) => /PostgreSQL/i.test(r.rows[0]?.v ?? ''), () => false);
  if (canAnalyze) await sql`analyze fhir.fhir_current`.execute(db);
  await sql`drop table fhir.fhir_resources`.execute(db);
  // The columns of the table it replaces, in the same order.
  await sql`create view fhir.fhir_resources as
    select c.resource_type, c.id, c.version_id, h.resource, c.source_system, c.plugin_id, c.plugin_version, c.batch_id,
           c.created_at, c.updated_at, c.version
    from fhir.fhir_current c
    join fhir.resource_history h on h.resource_type = c.resource_type and h.id = c.id and h.version = c.version`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`create table fhir.fhir_resources_table (
    resource_type text not null,
    id text not null,
    version_id text,
    resource jsonb not null,
    source_system text,
    plugin_id text,
    plugin_version text,
    batch_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1,
    primary key (resource_type, id)
  )`.execute(db);
  await sql`insert into fhir.fhir_resources_table (resource_type, id, version_id, resource, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at, version)
    select resource_type, id, version_id, resource, source_system, plugin_id, plugin_version, batch_id, created_at, updated_at, version
    from fhir.fhir_resources`.execute(db);
  await sql`drop view fhir.fhir_resources`.execute(db);
  await sql`alter table fhir.fhir_resources_table rename to fhir_resources`.execute(db);
  await sql`alter index fhir.fhir_resources_table_pkey rename to fhir_resources_pkey`.execute(db);
  await sql`drop table fhir.fhir_current`.execute(db);
}
