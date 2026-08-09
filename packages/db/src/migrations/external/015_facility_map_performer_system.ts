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
// source_code): the pair already narrows to about one row, and a third `keyType` column would put
// MySQL at roughly 3066 of its 3072-byte utf8mb4 index limit — a bound established by arithmetic,
// not measurement. The synthetic PK is untouched, so 012's 900-byte clustered-key reasoning still
// holds unchanged.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('facility_map')
    .addColumn('performer_system', sql.raw(keyType(engine)), (c) => c.notNull().defaultTo(''))
    .execute();
  await backfillPerformerSystem(db, engine);
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
export async function backfillPerformerSystem(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  // ⛔ The cast is not decoration. `diagnostic_reports.performer_system` is `textType`, i.e.
  // `nvarchar(max)` on MSSQL — and SQL Server REFUSES `MIN()` over `nvarchar(max)`. MySQL's CAST
  // spells the target `char(n)`, not `varchar(n)`. Namespace urls are far shorter than either bound.
  const narrowed = sql.raw(castKeyType(engine));
  await sql`
    update facility_map
       set performer_system = coalesce((
             select min(cast(dr.performer_system as ${narrowed}))
               from diagnostic_reports dr
              where coalesce(dr.source_system, '') = facility_map.source_system
                and dr.performer = facility_map.source_code
           ), '')
  `.execute(db);
}

/** `keyType` narrowed for use inside CAST. Kept separate because MySQL's CAST accepts `char(n)`
 *  where its DDL accepts `varchar(n)` — the two are not interchangeable. */
function castKeyType(engine: TargetEngine): string {
  if (engine === 'mssql') return 'varchar(450)';
  if (engine === 'mysql') return 'char(255)';
  return 'text';
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('facility_map').dropColumn('performer_system').execute();
}
