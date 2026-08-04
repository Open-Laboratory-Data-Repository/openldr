import { type Kysely, sql } from 'kysely';

// Facility registry slice 1. `facility_registry` is what we KNOW about a facility (curated);
// `facility_aliases` is what an incoming FEED called it (observed). They are deliberately separate
// from the `facilities` table in the ANALYTICS schema, which is the uncurated projection of ingested
// Organization/Location resources — see the spec's §6. Do not consolidate them.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('facility_registry')
    .addColumn('id', 'text', (c) => c.primaryKey())
    // OURS: required at data entry, absent on a nationally-imported row.
    .addColumn('local_code', 'text', (c) => c.unique())
    // THEIRS: the only code an imported row carries.
    .addColumn('national_system', 'text')
    .addColumn('national_code', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('level', 'text')
    .addColumn('ownership', 'text')
    .addColumn('status', 'text')
    // Administrative chain as REAL COLUMNS: anything a report groups by must be indexable, and a
    // jsonb key is not. Free text, not FKs — another country maps its own vocabulary onto these.
    .addColumn('country', 'text')
    .addColumn('zone', 'text')
    .addColumn('region', 'text')
    .addColumn('district', 'text')
    .addColumn('council', 'text')
    .addColumn('ward', 'text')
    .addColumn('village', 'text')
    .addColumn('address_text', 'text')
    .addColumn('phone', 'text')
    // double precision, not numeric: node-postgres returns `numeric` as a STRING (no type parser is
    // configured in this repo), which would make FacilityRecord.latitude/longitude a type lie in
    // production even though pg-mem returns real numbers in tests. Coordinates need no exact decimal.
    .addColumn('latitude', 'double precision')
    .addColumn('longitude', 'double precision')
    // Fields a form added beyond the core, so an admin can extend without a migration (Users pattern).
    .addColumn('extras', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    // NULL = lab-local, 'central' = central-managed and replaceable by down-sync. Matches the
    // existing convention from migration 048 / reference-apply.ts, whose deletes are guarded by it
    // so a lab-local row sharing an id is never touched.
    .addColumn('managed_origin', 'text')
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // A facility must be identifiable SOMEHOW. Neither column can be NOT NULL on its own: an
    // imported row has no local code, and a hand-entered one may never acquire a national code.
    .addCheckConstraint('facility_registry_has_a_code', sql`local_code is not null or national_code is not null`)
    .execute();

  // One national code means one facility, per register. Partial so the many rows without a national
  // code do not collide with each other.
  await db.schema
    .createIndex('facility_registry_national_unique')
    .unique()
    .on('facility_registry')
    .columns(['national_system', 'national_code'])
    .where(sql.ref('national_code'), 'is not', null)
    .execute();

  for (const col of ['region', 'district', 'council', 'status']) {
    await db.schema.createIndex(`facility_registry_${col}_idx`).on('facility_registry').column(col).execute();
  }

  await db.schema
    .createTable('facility_aliases')
    .addColumn('source_system', 'text', (c) => c.notNull())
    .addColumn('source_code', 'text', (c) => c.notNull())
    .addColumn('registry_id', 'text', (c) => c.notNull().references('facility_registry.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_by', 'text')
    // THE PK IS THE DESIGN: one alias resolves to exactly ONE facility, while many aliases point at
    // one registry row. That is the multi-LIS answer — a second LIS adds aliases, never forks the
    // registry — and it makes reconciliation idempotent.
    .addPrimaryKeyConstraint('facility_aliases_pk', ['source_system', 'source_code'])
    .execute();

  await db.schema
    .createIndex('facility_aliases_registry_idx')
    .on('facility_aliases')
    .column('registry_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('facility_aliases').ifExists().execute();
  await db.schema.dropTable('facility_registry').ifExists().execute();
}
