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
  //
  // ⛔ `distinct on (r.id)` + the `order by` are LOAD-BEARING, not tidiness. A registry row can match
  // TWO concepts at once — its human code AND its id — and that is not hypothetical: facility A owns
  // code `X`, facility B is imported carrying `national_code = X`, a Scan parks BOTH onto their ids
  // and (the projection write is upsert-only) leaves the now-unowned `X` concept behind. Both rows
  // then satisfy the join twice. Without an explicit pick, the row that survives is whichever the
  // join happens to yield first, and `on conflict (registry_id) do nothing` cannot help — the two
  // candidate rows have DIFFERENT `registry_id`s, so nothing conflicts and BOTH facilities can be
  // linked to the SAME `concept_code`. Measured under pg-mem: the unordered form links fac-A and
  // fac-B both to `'X'`, the ordered form gives each its own id.
  //
  // The tie is broken TOWARDS the id-keyed concept, which is the safe candidate in both directions:
  //  - a PARKED row (the case above) is genuinely projected under its id, so this records the truth;
  //  - a LEGACY id-keyed row (pre-0518e7d3 scheme, no collision) is also genuinely projected under
  //    its id, and recording that makes the first reprojection compute `from = id -> to = human
  //    code` — exactly the repair `deleteSupersededIdConcepts` already exists to perform.
  // And no other registry row can ever claim this row's id, so an id-keyed link is unshareable by
  // construction.
  //
  // ⚠ EXACTLY WHAT THAT BUYS, AND WHAT IT DOES NOT. `distinct on (r.id)` guarantees AT MOST ONE LINK
  // PER FACILITY, and the `order by` guarantees the id-keyed concept is preferred WHEN ONE EXISTS.
  // Neither makes `concept_code` unique ACROSS facilities. If two registry rows claim the same human
  // code and NEITHER has a concept keyed on its own id, the shared concept is each row's ONLY
  // candidate, and this insert still writes two links naming it — nothing conflicts, the
  // `registry_id`s differ. That state is reachable, not theoretical: `projectRegistryRows` never
  // throws and swallows its own failures (called from apps/server/src/facilities-routes.ts and
  // packages/bootstrap/src/facility-import.ts), so a registry row can exist having never had a
  // concept of its own written. Installs whose concepts predate commit 0518e7d3 are id-keyed and
  // unaffected; the exposure is a post-0518e7d3 install where a projection call was swallowed.
  //
  // What CONTAINS that residual is downstream, not here: `reprojectRegistryRows`' in-batch
  // duplicate-`from` guard refuses the carry-over for every row naming a contested code, reports
  // `carryOverSkipped: true` and warns, rather than silently re-pointing an operator's mapping at
  // the wrong facility. Both halves — this insert producing the shared link, and the guard refusing
  // it — are pinned end-to-end by facility-reconcile.test.ts's "refuses the carry-over when 077's
  // own backfill links two facilities to one code". See that guard's comment for what an operator is
  // then left with: there is no repair tool.
  //
  // `on conflict (registry_id) do nothing` is kept as a belt-and-braces no-op: `distinct on (r.id)`
  // already emits at most one row per facility, and the table was created empty two statements ago.
  await sql`
    insert into facility_concept_projection (registry_id, concept_code, updated_at)
    select distinct on (r.id) r.id, c.code, now()
      from facility_registry r
      join terminology_concepts c
        on c.system = ${REGISTRY_SYSTEM}
       and c.code in (coalesce(r.local_code, r.national_code), r.id)
     order by r.id, (c.code = r.id) desc
     on conflict (registry_id) do nothing
  `.execute(anyDb);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await (db as Kysely<any>).schema.dropTable('facility_concept_projection').execute();
}
