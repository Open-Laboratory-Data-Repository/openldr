import { type Kysely } from 'kysely';

// `ReportDesign.pageNumbers` has been in the zod schema and editable in the Properties tab since the
// designer shipped, but `report_designs` never had a column for it, so the store dropped it on every
// write. That silently broke more than a checkbox: the boot seed compares stored design content
// against the shipped definition via `designContent`, which normalises `pageNumbers ?? false`. All 8
// `simpleTableDesign` built-ins ship `pageNumbers: true`, so the comparison was permanently unequal
// and the seed overwrote them — and any operator edit to them — on every boot.
//
// ⛔ NULLABLE, NO DEFAULT, deliberately. `canonicalHash` (packages/core/src/canonical-hash.ts) is
// JSON.stringify-based, so an ABSENT key and `undefined` hash identically while `false` is a
// distinct value. A `NOT NULL DEFAULT false` column would therefore change the content hash of
// every design that never set the flag, and `reference_change_log` would ship each of them to every
// lab as a change even though nothing about them changed. NULL -> `undefined` keeps those hashes
// byte-identical; only a real toggle moves the hash.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_designs').addColumn('page_numbers', 'boolean').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_designs').dropColumn('page_numbers').execute();
}
