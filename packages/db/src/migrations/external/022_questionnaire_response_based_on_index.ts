import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// `questionnaire_responses.based_on_id` is the lab request a form response belongs to. Country
// report packs (reports-zm) read form answers per request through it, one lookup per request. Before
// this migration the table had only its primary key, so each lookup scanned the whole table.
//
// ⛔ The column needs WIDENING before it can be indexed on MySQL and MSSQL. 009 declared it
// `textType`, which is `longtext` on MySQL and `nvarchar(max)` on MSSQL, and neither engine can
// index a LOB column (MySQL error 1170, MSSQL Msg 1919). Same fix as 017 for
// `lab_results.request_id`: widen to `keyType`. Postgres needs none; both types are `text` there.
//
// The widening cannot truncate a real value. The projection stores the id part of
// `basedOn[0]` (relational/questionnaire-response.ts), a ServiceRequest id, which is
// `lab_requests.id` and already `keyType` (003_v2_core.ts). A longer value could only be an orphan.
// MySQL only has MODIFY COLUMN and MSSQL only has ALTER COLUMN, hence two builder calls.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  if (engine === 'mysql') {
    await db.schema.alterTable('questionnaire_responses').modifyColumn('based_on_id', sql.raw(keyType(engine))).execute();
  } else if (engine === 'mssql') {
    await db.schema.alterTable('questionnaire_responses').alterColumn('based_on_id', (ac) => ac.setDataType(sql.raw(keyType(engine)))).execute();
  }
  await db.schema.createIndex('questionnaire_responses_based_on_idx')
    .on('questionnaire_responses').column('based_on_id').execute();
}

// MySQL and MSSQL need `drop index ... on table`; Postgres rejects the ON clause (see 017's down).
// Leaves the widened column in place, as 017 does: a wider column is safe to re-run up() against.
export async function down(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  let drop = db.schema.dropIndex('questionnaire_responses_based_on_idx');
  if (engine !== 'postgres') drop = drop.on('questionnaire_responses');
  await drop.execute();
}
