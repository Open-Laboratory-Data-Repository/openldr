import { type Kysely, sql } from 'kysely';

/**
 * Starter packs: the fields OpenLDR's own form collects for one resource type, offered when an author
 * starts a form. Read-only seeded data. Boot writes the content on every start from
 * `packages/forms/src/samples/starter-packs.ts`; this migration only makes the tables. Spec:
 * `docs/superpowers/specs/2026-09-14-form-builder-corlix-parity-design.md`, S5.
 *
 * Differs from corlix's tables on purpose. No `suggested_codes`: codes in a seed break AGENTS.md §8.
 * `fhir_path` is nullable: CE's Facility form has three fields with no path. No `facility_id`: CE form
 * definitions are not facility-scoped. `reference_target` and `reference_multiple` are added: a
 * reference field with no source cannot publish (`packages/forms/src/lint.ts:108`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('starter_packs')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('resource_type', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('version', 'text', (c) => c.notNull())
    .addColumn('seeded', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('starter_packs_resource_type').on('starter_packs').column('resource_type').execute();

  await db.schema
    .createTable('starter_pack_entries')
    .addColumn('pack_id', 'text', (c) => c.notNull().references('starter_packs.id').onDelete('cascade'))
    .addColumn('ord', 'integer', (c) => c.notNull())
    .addColumn('fhir_path', 'text')
    .addColumn('label', 'text', (c) => c.notNull())
    .addColumn('api_property', 'text')
    .addColumn('field_type', 'text')
    .addColumn('fhir_value_field', 'text')
    .addColumn('required', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('locked', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('default_on', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('discriminator', 'jsonb')
    .addColumn('bound_value_set', 'text')
    .addColumn('reference_target', 'text')
    .addColumn('reference_multiple', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('rationale', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('starter_pack_entries_pkey', ['pack_id', 'ord'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('starter_pack_entries').execute();
  await db.schema.dropTable('starter_packs').execute();
}
