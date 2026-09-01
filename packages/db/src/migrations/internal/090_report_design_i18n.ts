import { type Kysely } from 'kysely';

// Printed translations for report designs (`ReportDesign.i18n`): language -> key -> text, where a
// key is an element id or `<elementId>.col.<columnKey>`. The studio ships in en, fr and pt; its
// printed output was English only, so a French-speaking laboratory printed English reports.
//
// Two tables, because a design's translations must survive both paths: `report_designs` is the
// working copy, and `report_design_versions` is what `publish()` snapshots and what a restore reads
// back. A column on only the first would lose every translation the moment a design was published.
//
// ⛔ NULLABLE, NO DEFAULT, for exactly the reason 083 documents for `page_numbers`. `canonicalHash`
// is JSON.stringify-based, so an ABSENT key and `undefined` hash identically while `{}` is a
// distinct value. A `NOT NULL DEFAULT '{}'` column would move the content hash of every design that
// has no translations, and `reference_change_log` would ship all of them to every enrolled lab as
// changes even though nothing about them changed.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_designs').addColumn('i18n', 'jsonb').execute();
  await db.schema.alterTable('report_design_versions').addColumn('i18n', 'jsonb').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('report_design_versions').dropColumn('i18n').execute();
  await db.schema.alterTable('report_designs').dropColumn('i18n').execute();
}
