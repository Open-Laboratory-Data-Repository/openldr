import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, shortKeyType, timestampType, nowExpr } from './dialect';

// The warehouse copy of the test mappings (docs/superpowers/specs/2026-10-11-test-mapping-design.md,
// 4.2). term_mappings lives in the INTERNAL db, so a report can only join a lab's test code to its
// catalog test through a copy here, as 012_facility_map does for facilities.
//
// One row per (level, source_system, source_code). `id` is synthetic and deterministic for 012's
// reason: an MSSQL clustered key over keyType columns has no headroom.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  // level is a short word ('test' or 'result'). A narrow column keeps the three-part source index
  // small on SQL Server and MySQL (see shortKeyType in dialect.ts).
  const level = sql.raw(shortKeyType(engine));
  let built = db.schema.createTable('test_map')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('level', level, (c) => c.notNull())
    .addColumn('source_system', key, (c) => c.notNull())
    .addColumn('source_code', key, (c) => c.notNull())
    .addColumn('catalog_code', text)
    .addColumn('catalog_name', text)
    .addColumn('category', text)
    .addColumn('loinc', text)
    .addColumn('updated_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // Every report join filters on all three together.
  await db.schema.createIndex('test_map_source_idx')
    .on('test_map').columns(['level', 'source_system', 'source_code']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('test_map').execute();
}
