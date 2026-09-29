import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, floatType, intType, booleanType, timestampType, nowExpr } from './dialect';

// v1 request facts (Mozambique slice C, spec 2026-09-29-v1-request-facts-design.md). One shared model:
// every column is for every country and stays NULL where a source does not send it. Common facts are
// typed columns; rare ones are rows in lab_request_attributes, keyed by a code in the
// urn:openldr:cs:request-attribute vocabulary. section_code and authorised_by sit on the REPORT they
// arrive on, because a report projection must not write the row its ServiceRequest owns.
const REQUEST_TEXT = ['analysis_at', 'point_of_care', 'request_type', 'registered_by', 'tested_by',
  'requester_practitioner', 'clinical_info', 'analyzer_code', 'rejection_code', 'rejection_reason'] as const;
const REQUEST_INT = ['obr_set_id', 'age_years', 'age_days'] as const;
const REPORT_TEXT = ['section_code', 'authorised_by'] as const;

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const int = sql.raw(intType(engine));
  const key = sql.raw(keyType(engine));
  for (const col of REQUEST_TEXT) await db.schema.alterTable('lab_requests').addColumn(col, text).execute();
  for (const col of REQUEST_INT) await db.schema.alterTable('lab_requests').addColumn(col, int).execute();
  for (const col of REPORT_TEXT) await db.schema.alterTable('diagnostic_reports').addColumn(col, text).execute();

  let built = db.schema.createTable('lab_request_attributes')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('lab_request_id', key, (c) => c.notNull())
    .addColumn('system', key, (c) => c.notNull())
    .addColumn('code', key, (c) => c.notNull())
    .addColumn('value_text', text)
    .addColumn('value_number', sql.raw(floatType(engine)))
    .addColumn('value_datetime', text)
    .addColumn('value_boolean', sql.raw(booleanType(engine)))
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // The writer replaces a request's attributes by this column (delete in scope, then insert).
  await db.schema.createIndex('lab_request_attributes_request_idx')
    .on('lab_request_attributes').column('lab_request_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('lab_request_attributes').execute();
  for (const col of [...REPORT_TEXT].reverse()) await db.schema.alterTable('diagnostic_reports').dropColumn(col).execute();
  for (const col of [...REQUEST_INT].reverse()) await db.schema.alterTable('lab_requests').dropColumn(col).execute();
  for (const col of [...REQUEST_TEXT].reverse()) await db.schema.alterTable('lab_requests').dropColumn(col).execute();
}
