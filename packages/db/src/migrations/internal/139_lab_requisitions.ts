import { type Kysely, sql } from 'kysely';
import type { InternalSchema } from '../../schema/internal';
import { fillRequisitions } from '../../lab-requisitions';

// Lab module slices 1b and 2, ruling 7: a table that finds a ServiceRequest by its requisition
// number, whatever saved it. The FHIR store has no search index and the warehouse's
// `lab_requests.request_id` is unindexed text, so nothing finds an order by its number today.
//
// One row per ServiceRequest with a number. `requisition` is the trimmed number, `facility` the
// requesting facility's code, or null. Two sites may use the same number, so the number is not
// unique: the index is a plain one.
//
// The fill runs in TypeScript, a page at a time, through `requisitionRowOf`, so the migration and
// the projection hooks read a request the same way. It is an upsert, so a second run changes
// nothing. `openldr lab requisitions rebuild` writes the table again later.
//
// The table is looked up in information_schema rather than made with `create table if not exists`:
// pg-mem refuses that statement when the table is already there, so a second run could not be tested.
export async function up(db: Kysely<unknown>): Promise<void> {
  const there = await sql<{ table_name: string }>`select table_name from information_schema.tables
    where table_name = ${'lab_requisitions'} and table_schema = current_schema()`.execute(db);
  if (there.rows.length === 0) {
    await sql`create table lab_requisitions (
      service_request_id text primary key,
      requisition text not null,
      facility text,
      updated_at timestamptz not null default now()
    )`.execute(db);
  }
  await sql`create index if not exists lab_requisitions_requisition_idx on lab_requisitions (requisition)`.execute(db);
  await fillRequisitions(db as unknown as Kysely<InternalSchema>);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists lab_requisitions`.execute(db);
}
