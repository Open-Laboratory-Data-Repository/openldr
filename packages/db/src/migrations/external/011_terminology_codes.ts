import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// The warehouse's first TERMINOLOGY dimension. Reports run against the external warehouse via
// runConnectorSql, while value_sets lives in the internal DB, so a report cannot join terminology
// unless it is projected here. One row per (value set, concept).
//
// `id` is synthetic — `<value_set_id>|<system>|<code>` — because all three batch upserts conflict
// on `id` (batch-upsert.ts). It must be DETERMINISTIC: a reprojection recomputes it, and a
// non-deterministic id would duplicate every row on rebuild instead of updating it.
//
// `id` uses `keyType`, not `textType`, even though it holds a composite string: it is the PRIMARY
// KEY, and MySQL's `ON DUPLICATE KEY UPDATE` (insertBatchMysql) and a real primary-key constraint
// both require a bounded, indexable column — `longtext`/`nvarchar(max)` cannot be a key on
// MySQL/MSSQL (see dialect.ts's keyType comment). Every other flat table's `id` column follows the
// same rule (001_flat_tables.ts).
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  await db.schema.createTable('terminology_codes')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('value_set_id', text)
    .addColumn('value_set_url', text)
    .addColumn('system', text)
    .addColumn('code', text)
    .addColumn('display', text)
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)))
    .execute();
  // The projection replaces a whole value set at once, so every write and every delete filters on
  // value_set_id. Without this index that is a full scan of the dimension on each terminology edit.
  await db.schema.createIndex('terminology_codes_value_set_id_idx')
    .on('terminology_codes').column('value_set_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('terminology_codes').execute();
}
