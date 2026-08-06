import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The CDR toolchain now sends `DiagnosticReport.performer[0]` as a FHIR logical reference:
// `{ identifier: { system, value }, display }` — no Organization resource to point at, so the
// facility code lives on `identifier.value` and the human name on `display`. Migration 010 gave
// `diagnostic_reports.performer` a home for the code (now the match key, see relational/
// diagnostic-report.ts); this migration adds two columns for the two pieces the projection
// previously discarded:
//
// - `performer_display` — the human name ("Aga Khan"), carried so the operator sees a name rather
//   than a bare code, without ever using it as a match key (five distinct DISA facility codes —
//   BAMAA/BBFAF/CDABE/EAFAE/NDFAM — measured all sharing the display "Aga Khan").
// - `performer_system` — `identifier.system`, the code's namespace, when the wire supplies one.
//
// Both `textType`, neither a key: descriptive/reference data copied off the wire, never a join
// predicate (unlike `performer` itself, which IS a join predicate against `facility_map`).
export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  await db.schema.alterTable('diagnostic_reports').addColumn('performer_display', text).execute();
  await db.schema.alterTable('diagnostic_reports').addColumn('performer_system', text).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('diagnostic_reports').dropColumn('performer_display').execute();
  await db.schema.alterTable('diagnostic_reports').dropColumn('performer_system').execute();
}
