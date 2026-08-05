import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// The resolved facility dimension. `facility_registry` and `term_mappings` live in the INTERNAL db
// while `diagnostic_reports.performer` lives here in the warehouse, so a report cannot resolve a
// performing laboratory unless the resolution is projected here — the same constraint
// 011_terminology_codes documents for terminology.
//
// One row per (source_system, source_code) — i.e. per observed facility string per feed.
//
// `id` is synthetic (`<source_system>|<source_code>`, hashed when long) rather than a composite
// primary key on those two columns. `keyType` is `varchar(450)` on MSSQL, and a PRIMARY KEY is
// CLUSTERED by default, whose key is capped at 900 bytes — two of them land on exactly 900, with
// zero headroom for any later widening of either column. The nonclustered index below is fine (that
// cap is 1700), and MySQL's `varchar(255)` utf8mb4 pair is 2040 of its 3072. A synthetic key sheds
// the whole constraint. It must be DETERMINISTIC because a re-publish recomputes it.
//
// ⛔ NOT the same table as `facilities` — that is the uncurated projection of ingested
// Organization/Location resources. These two look joinable and are not.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  let built = db.schema.createTable('facility_map')
    .addColumn('id', key, (c) => c.primaryKey())
    // Indexed below — the join predicate is (source_system, source_code), so both are keyType.
    // ⛔ NOT NULL on both: `FacilityMapTable` types them `string` (not `string | null`), and every
    // other table in schema/external.ts keeps type and DDL honest with each other. Without the
    // constraint the type promises a guarantee the schema does not enforce, on the two columns
    // every report join predicates on. The publish path always supplies both.
    .addColumn('source_system', key, (c) => c.notNull())
    .addColumn('source_code', key, (c) => c.notNull())
    // The resolved facility. NULL is a legitimate, meaningful state: the string was observed but is
    // not mapped, or its mapping's target no longer exists. A report falls back to the raw string.
    .addColumn('registry_id', text)
    // `facility_registry.local_code` — carried through so a report/UI can disambiguate two
    // similarly-named facilities (e.g. "Dodoma Regional Referral" vs "Dodoma Zonal Lab"). `textType`,
    // not `keyType`: this is descriptive data copied from the registry, never a join predicate here.
    .addColumn('local_code', text)
    .addColumn('name', text)
    .addColumn('level', text)
    .addColumn('status', text)
    .addColumn('region', text)
    .addColumn('district', text)
    .addColumn('council', text)
    .addColumn('national_system', text)
    .addColumn('national_code', text)
    // 'registry' | 'national' | null — which route resolved this row. Lets the Observed tab and any
    // future audit explain a name rather than merely assert it.
    .addColumn('resolved_via', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  // Mirrors 001_flat_tables' withCommon: facility names carry diacritics, and a self-hosted
  // MySQL/MariaDB may default to latin1/utf8mb3.
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every report join filters on both columns together.
  await db.schema.createIndex('facility_map_source_idx')
    .on('facility_map').columns(['source_system', 'source_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('facility_map').execute();
}
