import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// `facility_map`'s natural key omitted the observed coding namespace, so two facilities sharing a
// code under different namespaces collided on one synthetic `id` and publish dropped one; and two
// feeds sharing a namespace folded onto ONE feed's row, so the other feed's reports matched nothing.
// Both are closed by re-keying the dimension on the raw observed wire tuple
// (source_system, performer_system, source_code) — the only grain a report join can match on, since
// `observedSystemForFeed` is TypeScript with no SQL equivalent.
//
// ⛔ NOT NULL DEFAULT '': `performer_system` is nullable on `diagnostic_reports`, and `NULL = NULL`
// is false in SQL. The whole dimension already spells an absent feed as '' for exactly this reason
// (see every `coalesce(dr.source_system, '')` in the seeded report joins); the namespace follows the
// same convention rather than inventing a second one.
//
// ⛔ The index is deliberately NOT widened. `facility_map_source_idx` stays (source_system,
// source_code): the pair narrows to one row PER NAMESPACE observed for that code — one row on all
// measured data, and a handful in the case this column exists to represent — while a third
// `keyType` column would put MySQL at roughly 3066 of its 3072-byte utf8mb4 index limit, a bound
// established by arithmetic and not by measurement. Selectivity, not uniqueness: the pair stopped
// being unique the moment the dimension gained this column, which is the whole point of it. The
// synthetic PK is untouched, so 012's 900-byte clustered-key reasoning still holds unchanged.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('facility_map')
    .addColumn('performer_system', sql.raw(keyType(engine)), (c) => c.notNull().defaultTo(''))
    .execute();
  await backfillPerformerSystem(db);
}

/**
 * Relabel every existing dimension row with the namespace its reports actually carry.
 *
 * ⛔ This CANNOT split a row. `facility_map.id` is `facilityMapId`, a djb2 hash above
 * MAX_ID_LENGTH — a TypeScript function with no SQL equivalent — so a migration cannot mint ids for
 * rows it would create. Where one (feed, code) genuinely spans two namespaces this takes the
 * alphabetically first non-null one and the other namespace's row simply does not exist yet; the
 * rebuild enqueued at boot creates it. Impossible on measured data today (1 distinct namespace).
 *
 * ⛔ Without this backfill the fix would ship a REGRESSION, not a repair: every live report row
 * carries a populated `performer_system`, so leaving the dimension on the '' default would make the
 * new join predicate fail for every dimension row and drop every resolved facility name back to the
 * raw code, immediately on upgrade.
 *
 * Exported so the tests exercise the shipped statement rather than a transcription of it.
 */
export async function backfillPerformerSystem(db: Kysely<unknown>): Promise<void> {
  // ⛔ NO CAST around `min(...)`, and that is a MEASURED decision — an earlier revision of this file
  // wrapped it in a per-dialect narrowing cast on the belief that "SQL Server REFUSES `MIN()` over
  // `nvarchar(max)`". That belief was WRONG, and the cast it justified was actively harmful.
  //
  // Measured 2026-08-09 against real servers, not inferred:
  //  - SQL Server 2022 (RTM-CU25, 16.0.4255.1): `min(v)` and `select g, min(v) ... group by g` over
  //    an `nvarchar(max)` column both succeed. The legacy "invalid operand for min" restriction
  //    applies to `text`/`ntext`, NOT to `nvarchar(max)` — and `textType('mssql')` is `nvarchar(max)`.
  //  - MySQL 8.4.10: `min(v)` over `longtext` succeeds, bare and grouped.
  //  - This exact statement was run on both, plus Postgres, over the three fixture cases the test
  //    file pins, and produced identical results on all three.
  //
  // ⛔ Why the cast had to GO rather than merely being redundant: on MSSQL, casting to
  // `varchar(450)` SILENTLY TRUNCATES a namespace longer than that, and the truncated value is then
  // one the report join (`fm.performer_system = coalesce(dr.performer_system, '')`) can never match —
  // so the facility's curated name would quietly fall back to the raw code, which is the exact
  // failure class this whole column exists to remove. Uncast, MSSQL instead raises
  // `Msg 2628 — String or binary data would be truncated` and terminates the statement. MySQL errors
  // loudly either way (`ERROR 1406` uncast, `ERROR 1292` cast) under its default STRICT_TRANS_TABLES.
  // A loud failure on absurd input beats a silent one.
  //
  // Consequently the seeded reports' PRE-EXISTING uncast `min(performer)` / `min(performer_display)` /
  // `min(source_system)` in `q-amr-facility-summary` and `q-clinical-micro-header`
  // (packages/reporting/src/seed/report-seeds.ts) are fine on MSSQL too — there is no pre-existing
  // breakage there, contrary to what the superseded comment implied.
  await sql`
    update facility_map
       set performer_system = coalesce((
             select min(dr.performer_system)
               from diagnostic_reports dr
              where coalesce(dr.source_system, '') = facility_map.source_system
                and dr.performer = facility_map.source_code
           ), '')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facility_map').dropColumn('performer_system').execute();
}
