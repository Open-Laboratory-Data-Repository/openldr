import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { keyType } from './dialect';

// Patient duplicate detection (docs/superpowers/specs/2026-10-12-patient-duplicates-design.md,
// section 2). The projector stores a normalised surname|firstname|dob here, so finding patients with
// the same details is a GROUP BY. Normalising in SQL is not portable: stripping accents needs an
// extension on Postgres and collations on MySQL and SQL Server. Key-sized so it can be indexed.
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  await db.schema.alterTable('patients').addColumn('match_key', sql.raw(keyType(engine))).execute();
  await db.schema.createIndex('patients_match_key_idx').on('patients').column('match_key').execute();
}

// MySQL and MSSQL need `drop index ... on table`; Postgres rejects the ON clause (see 017 and 022).
export async function down(db: Kysely<unknown>, engine: TargetEngine = 'postgres'): Promise<void> {
  let drop = db.schema.dropIndex('patients_match_key_idx');
  if (engine !== 'postgres') drop = drop.on('patients');
  await drop.execute();
  await db.schema.alterTable('patients').dropColumn('match_key').execute();
}
