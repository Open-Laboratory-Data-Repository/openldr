import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// A numeric result can be censored: "< 20" is stored as value 20 plus the comparator "<".
// The column holds one of <, <=, >=, > and stays NULL for an exact value.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('lab_results').addColumn('numeric_comparator', sql.raw(textType(engine))).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('lab_results').dropColumn('numeric_comparator').execute();
}
