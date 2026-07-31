import { type Kysely, sql } from 'kysely';

// Normalise `terminology_concepts.status` to upper case.
//
// Status is compared case-SENSITIVELY downstream: valueset expansion's `filterConcepts()` gates on
// `status = 'ACTIVE'`. Every concept source wrote upper case EXCEPT the SNOMED and RxNorm ontology
// adapters, which hardcoded lowercase 'active'. On an install that had imported SNOMED, all of its
// concepts were therefore invisible to any activeOnly ValueSet expansion — and it failed SILENTLY,
// returning an empty expansion rather than an error. The visible symptom was a specimen picker that
// found nothing while half a million matching concepts sat in the table.
//
// The adapters now emit 'ACTIVE' and `upsertConcepts()` normalises at the write choke point, but
// both only affect FUTURE writes. This migration repairs concepts already ingested.
//
// Unlike a capability backfill there is no operator intent to preserve here: nobody chose lowercase
// status, so normalising every row is unambiguously safe. `upper()` rather than a literal so real
// non-active statuses (LOINC ships DEPRECATED / DISCOURAGED / TRIAL in its own STATUS column) keep
// their meaning instead of being flattened to ACTIVE. NULL stays NULL — WHONET writes it
// deliberately — because `upper(NULL)` is NULL.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`update terminology_concepts set status = upper(status) where status is not null and status <> upper(status)`.execute(db);
}

export async function down(): Promise<void> {
  // Deliberately empty. The original casing was a defect, not information: the rows this migration
  // touched were unreachable by the only consumer that reads status. Re-lowercasing them would
  // restore the bug, and there is no record of which rows were affected.
}
