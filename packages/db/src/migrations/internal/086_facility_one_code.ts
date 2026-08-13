import { Kysely, sql } from 'kysely';

// One code, one system. `local_code` (OURS) and `national_code` (THEIRS) collapse into
// `facility_code` plus the `facility_system` that names it — which is what `Location.identifier`
// already is, and what removes the `localCode ?? nationalCode` fallback
// (packages/db/src/facility-observed.ts) that made the Facilities table show a code the Edit sheet
// could not bind.
//
// ⛔ ADDITIVE ONLY, and the new columns are NULLABLE. A column rename cannot land in halves, so this
// migration expands and a later one contracts. Nullable because ten test files and several code
// paths insert into `facility_registry` directly without knowing about these columns yet; NOT NULL
// belongs in the contract migration, once every writer sets them.
//
// ⛔ NO ROW IS RE-KEYED. `idFor` is a write key, not an identity contract — nothing looks a row up by
// recomputing it (`importFacilities` matches on ids the parser stamped). So
// `facility_concept_projection`, `facility_jobs`, `facility_map` and `audit_events` all keep pointing
// at rows that never moved. That is the property the whole slice is built on.

/**
 * ⛔ WHY A LOCAL-ONLY ROW GETS NO SYSTEM HERE.
 *
 * The obvious move is to mint an install-local register (`urn:openldr:facility:local`) and backfill
 * every local-only facility onto it. This migration deliberately does NOT, because CE must not ship
 * a facility register as a product default — the same rule `DEFAULT_OBSERVED_FACILITY_SYSTEM` states
 * about itself (packages/db/src/facility-observed.ts:16-20): one deployment's vocabulary shipped as a
 * default makes every other deployment silently wrong. Measured consequence of trying: nine tests
 * across two files, all asserting that a fresh install lists exactly the registers its operator
 * created.
 *
 * So a local-only row gets its CODE here and its SYSTEM later, when the operator names their register
 * in Settings (`lab.facilitySystem`). Until then those rows keep `facility_system` NULL, and the
 * `local_code` UNIQUE constraint from migration 070 — still present through the transition — goes on
 * guarding them exactly as it does today. The contract migration is what makes the column NOT NULL,
 * by which time every row has an answer.
 */

/**
 * Fill `facility_system`/`facility_code` from the pair they replace.
 *
 * Exported so the test can exercise it against rows that exist — `up()` cannot be re-run, since
 * `addColumn` throws the second time, and `makeMigratedDb()` has already run it against an empty
 * table.
 *
 * Idempotent by the `facility_code is null` guard: a row a writer has already set is never
 * overwritten with a value derived from the deprecated columns.
 */
export async function backfill(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;

  // Park a local code that would otherwise be lost. The national pair is the register's identity and
  // wins, but the operator's own code is data they entered and is never simply dropped.
  //
  // ⛔ Done row by row in TypeScript, NOT with `jsonb_build_object`/`jsonb_set`: pg-mem implements
  // none of them, and this migration runs inside every `makeMigratedDb()` in the suite — a JSON
  // function here fails every pg-mem test in the repo, not just this migration's own. Measured: the
  // first draft broke 082's four tests with `function jsonb_build_object(text,text) does not exist`.
  // The loop is affordable because these rows are rare by construction (measured 0 on the dev
  // install); a register import never produces one.
  const both = await d
    .selectFrom('facility_registry')
    .select(['id', 'local_code', 'extras'])
    .where('facility_code', 'is', null)
    .where('local_code', 'is not', null)
    .where('national_code', 'is not', null)
    .execute();
  for (const row of both) {
    const extras = (typeof row.extras === 'string' ? JSON.parse(row.extras) : row.extras) ?? {};
    await d
      .updateTable('facility_registry')
      .set({ extras: JSON.stringify({ ...extras, __localCode: row.local_code }) } as never)
      .where('id', '=', row.id)
      .execute();
  }

  // `facility_system` comes ONLY from `national_system`. A local-only row is left with a NULL system
  // on purpose — see the note above the export for why CE does not mint one.
  await sql`
    update facility_registry
       set facility_code   = coalesce(national_code, local_code),
           facility_system = case when national_code is not null then national_system else null end
     where facility_code is null
       and coalesce(national_code, local_code) is not null`.execute(d);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;

  await d.schema.alterTable('facility_registry').addColumn('facility_system', 'text').execute();
  await d.schema.alterTable('facility_registry').addColumn('facility_code', 'text').execute();

  await backfill(d);

  // PARTIAL, exactly as migration 070's `(national_system, national_code)` index is and for the same
  // reason: the columns are nullable through the transition, and the rows that have not been
  // backfilled must not all collide with each other on NULL.
  await d.schema
    .createIndex('facility_registry_system_code_unique')
    .unique()
    .on('facility_registry')
    .columns(['facility_system', 'facility_code'])
    .where(sql.ref('facility_code'), 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const d = db as Kysely<any>;
  await d.schema.dropIndex('facility_registry_system_code_unique').execute();
  await d.schema.alterTable('facility_registry').dropColumn('facility_code').execute();
  await d.schema.alterTable('facility_registry').dropColumn('facility_system').execute();
  // `extras.__localCode` is deliberately NOT stripped: it is a copy of a column that still exists, so
  // leaving it costs nothing, while removing it would edit rows this down() did not create.
}
