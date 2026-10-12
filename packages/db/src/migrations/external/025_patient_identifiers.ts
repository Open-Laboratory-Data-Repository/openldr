import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType, keyType, timestampType, nowExpr } from './dialect';

// Every Patient.identifier, one row each (docs/superpowers/specs/2026-10-12-patient-index-design.md,
// section 1). patients.patient_guid keeps only the first identifier and drops its system, so an MPI
// number, NRC or folder number after the first could not be searched. A Patient owns its rows: the
// writer replaces the whole set on each new version, scoped on patient_id.
//
// `id` is derived from (patient_id, system, value) by boundedRowId, as lab_request_attributes' is.
// system and value are key-sized so (system, value) can be indexed on MySQL and MSSQL. On MSSQL
// two varchar(450) columns are 900 bytes, inside the 1,700-byte nonclustered index key limit.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  const key = sql.raw(keyType(engine));
  let built = db.schema.createTable('patient_identifiers')
    .addColumn('id', key, (c) => c.primaryKey())
    .addColumn('patient_id', key, (c) => c.notNull())
    .addColumn('system', key)
    .addColumn('value', key, (c) => c.notNull())
    .addColumn('type_code', text)
    .addColumn('type_text', text)
    .addColumn('use', text)
    .addColumn('source_system', text)
    .addColumn('plugin_id', text)
    .addColumn('plugin_version', text)
    .addColumn('batch_id', text)
    .addColumn('created_at', sql.raw(timestampType(engine)), (c) => c.notNull().defaultTo(nowExpr(engine)));
  if (engine === 'mysql') built = built.modifyEnd(sql`character set utf8mb4`);
  await built.execute();
  // The writer replaces a patient's identifiers by this column (delete in scope, then insert).
  await db.schema.createIndex('patient_identifiers_patient_idx')
    .on('patient_identifiers').column('patient_id').execute();
  // Search matches an exact value within the searchable systems.
  await db.schema.createIndex('patient_identifiers_system_value_idx')
    .on('patient_identifiers').columns(['system', 'value']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('patient_identifiers').execute();
}
