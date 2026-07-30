import { type Kysely } from 'kysely';

// A report definition is inert without the two things it points at: `reports.design_id` ->
// report_designs, and `reports.primary_query_id` -> custom_queries. Migration 048 stamped
// form_definitions/dashboards/reports as center-managed, but NOT those two dependency tables, so
// they could not join the reference-sync set — central published 8 reports and a lab received 8
// rows in `reports` with 0 designs and 0 queries. Every synced definition had a dangling
// design_id/primary_query_id, so the lab's Reports page showed "No reports yet" and central's
// reports never actually reached a lab.
//
// Same shape as 048: nullable, no default, so existing/locally-authored rows stay
// `managed_origin IS NULL` (lab-local, never touched by pull) until the applier stamps 'central'.
const TABLES = ['report_designs', 'custom_queries'] as const;

export async function up(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await db.schema.alterTable(table).addColumn('managed_origin', 'text').execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await db.schema.alterTable(table).dropColumn('managed_origin').execute();
  }
}
