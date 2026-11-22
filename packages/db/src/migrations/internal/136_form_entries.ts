import { type Kysely, sql } from 'kysely';

// One row for each saved form submission. The submit route writes the row before it runs the save,
// so a refused repeat saves nothing.
//
// `facility_id` is the facility register's row id, not the code: a data limit lists row ids.
// `facility_code` and `facility_name` are kept for display only. `entry_key` is the requisition
// number, null when the form has none. `saved` holds the ids of the records the save made.
//
// The repeat rule: at most one `active` or `incomplete` row for each form, facility and key, where
// the key is not null. `coalesce(facility_id, '')` makes two rows with no facility collide, which a
// plain column would not, since Postgres treats nulls as distinct. A row marked entered-in-error
// falls outside the predicate and frees the number.
//
// `sql.lit`, not `${}`, inside the index predicate: Postgres refuses parameters there, and pg-mem
// would hide that by substituting them. pg-mem builds and enforces this index as written (checked
// by form-entry-store.test.ts), so there is no separate pg-mem path.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create table if not exists form_entries (
    id text primary key,
    form_id text not null,
    facility_id text,
    facility_code text,
    facility_name text,
    entry_key text,
    summary jsonb not null default '[]'::jsonb,
    entered_by text not null,
    entered_by_name text not null,
    entered_at timestamptz not null default now(),
    status text not null default 'active'
      check (status in ('active', 'incomplete', 'entered-in-error')),
    status_by text,
    status_at timestamptz,
    status_reason text,
    saved jsonb
  )`.execute(db);

  await sql`create unique index if not exists form_entries_one_open_key
    on form_entries (form_id, coalesce(facility_id, ${sql.lit('')}), entry_key)
    where entry_key is not null and status in (${sql.lit('active')}, ${sql.lit('incomplete')})`.execute(db);

  await sql`create index if not exists form_entries_form_entered
    on form_entries (form_id, entered_at desc, id desc)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists form_entries`.execute(db);
}
