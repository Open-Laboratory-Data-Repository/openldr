import { type Kysely, sql } from 'kysely';
import type { TargetEngine } from '../../engine';
import { textType } from './dialect';

// The requesting facility of a lab request, from `ServiceRequest.requester`. Until slice B of the
// Mozambique work, cdr-toolchain sent the requesting clinic as `DiagnosticReport.performer`, so
// `diagnostic_reports.performer` held the clinic. From slice B it holds the testing laboratory and
// the clinic lands here. Same types as the `performer` trio on `diagnostic_reports` (migrations 010
// and 013). Spec: docs/superpowers/specs/2026-09-28-testing-lab-on-the-wire-design.md.
const COLUMNS = ['requester_code', 'requester_system', 'requester_display'] as const;

export async function up(db: Kysely<unknown>, engine: TargetEngine): Promise<void> {
  const text = sql.raw(textType(engine));
  for (const col of COLUMNS) {
    await db.schema.alterTable('lab_requests').addColumn(col, text).execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const col of [...COLUMNS].reverse()) {
    await db.schema.alterTable('lab_requests').dropColumn(col).execute();
  }
}
