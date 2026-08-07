import { sql, type Kysely } from 'kysely';

// The durable answer to "what code does facility X currently project as?".
//
// ⛔ NOT concept `properties`. There is a live open bug where `terms.update` destroys unknown
// concept properties (it rewrites the jsonb wholesale), which would silently eat this link and take
// the mapping-migration layer down with it — the layer would then compute "no code change" for a row
// whose code had in fact moved, which is exactly the failure it exists to prevent.
//
// ⛔ Deliberately INLINED, not imported from FACILITY_REGISTRY_SYSTEM: frozen-snapshot rule.
const REGISTRY_SYSTEM = 'urn:openldr:cs:facility-registry';

export async function up(db: Kysely<unknown>): Promise<void> {
  const anyDb = db as Kysely<any>;

  await anyDb.schema
    .createTable('facility_concept_projection')
    .addColumn('registry_id', 'text', (c) =>
      c.primaryKey().references('facility_registry.id').onDelete('cascade'))
    .addColumn('concept_code', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Backfill from the LIVE concept, not by recomputing the preferred code: the point of this table
  // is to record what was actually projected, including any collision fallback to the row's id that
  // a past projection applied. Recomputing here would assert a code the concepts may not carry, and
  // the first projection after this migration would then "migrate" mappings that were never broken.
  await sql`
    insert into facility_concept_projection (registry_id, concept_code, updated_at)
    select r.id, c.code, now()
      from facility_registry r
      join terminology_concepts c
        on c.system = ${REGISTRY_SYSTEM}
       and c.code in (coalesce(r.local_code, r.national_code), r.id)
     on conflict (registry_id) do nothing
  `.execute(anyDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<any>).schema.dropTable('facility_concept_projection').execute();
}
