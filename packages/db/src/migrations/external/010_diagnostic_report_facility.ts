import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The AMR "resistance by facility" report had no facility to group by: it keyed off
// `patients.managing_organization`, which the CDR/DISA source never sets (measured: 1 of 589
// patients, and that one is the seed), so the report returned zero rows on real data.
//
// The facility IS present — every ingested DiagnosticReport carries `performer[0].display`
// (measured: 1303 of 1303, 15+ distinct Tanzanian facilities: Dodoma, Mwananyamala, Mnazi Mmoja,
// Muhimbili, Aga Khan, ...). The projection simply had nowhere to put it.
//
// `specimen_id` comes along because it is the JOIN KEY. An AST result is tied to its report by
// specimen (`DiagnosticReport.specimen[0]`), which is also how every other AMR query links results
// to isolates. Joining on `patient_id` instead would fan out whenever one patient has reports from
// two facilities, silently multiplying that patient's resistance counts.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('diagnostic_reports').addColumn('performer', text).execute();
  await db.schema.alterTable('diagnostic_reports').addColumn('specimen_id', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('diagnostic_reports').dropColumn('performer').execute();
  await db.schema.alterTable('diagnostic_reports').dropColumn('specimen_id').execute();
}
