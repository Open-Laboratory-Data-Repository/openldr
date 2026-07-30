import type { Kysely, Transaction } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S2: reference-data change capture. Config stores call recordReferenceChange
// inside their own write transaction so the append to reference_change_log is atomic with the
// store write (Task 4 instruments the stores; this is the capture primitive).

export type ReferenceEntityType =
  | 'form'
  | 'dashboard'
  | 'report'
  // A `report` is inert without these two: reports.design_id -> report_designs and
  // reports.primary_query_id -> custom_queries. Syncing the definition alone shipped labs 8
  // published reports with dangling pointers (0 designs / 0 queries), so their Reports page
  // read "No reports yet" and central's reports never reached a lab.
  | 'report_design'
  | 'custom_query'
  | 'setting'
  | 'publisher'
  | 'coding_system'
  | 'term_mapping'
  | 'terminology_system'
  | 'concept_map';
// Order matters for a first-pull replay: a report's dependencies are listed BEFORE `report`, and
// the seed writes queries -> designs -> report defs, so seq order already delivers deps first.
// (No FK constraints exist between the three tables, so an out-of-order arrival cannot error —
// the report simply stays unrenderable until its design and query land.)
export const ENTITY_TYPES: ReferenceEntityType[] = [
  'form', 'dashboard', 'custom_query', 'report_design', 'report', 'setting',
  'publisher', 'coding_system', 'term_mapping', 'terminology_system', 'concept_map',
];
export type ReferenceOp = 'upsert' | 'delete';

/** Append a reference-data change to the log — but only if it differs from the entity's latest logged
 *  state (same content_hash on an upsert, or a delete after a delete → no-op; a delete of a never-logged
 *  entity → no-op). Runs inside the caller's transaction so capture is atomic with the store write. */
export async function recordReferenceChange(
  trx: Transaction<InternalSchema> | Kysely<InternalSchema>,
  entityType: ReferenceEntityType,
  entityId: string,
  op: ReferenceOp,
  contentHash: string | null,
): Promise<void> {
  const latest = await trx
    .selectFrom('reference_change_log')
    .select(['op', 'content_hash'])
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (latest) {
    if (op === 'upsert' && latest.op === 'upsert' && latest.content_hash === contentHash) return; // unchanged
    if (op === 'delete' && latest.op === 'delete') return; // already tombstoned
  } else if (op === 'delete') {
    return; // nothing to tombstone
  }

  await trx
    .insertInto('reference_change_log')
    .values({ entity_type: entityType, entity_id: entityId, op, content_hash: contentHash })
    .execute();
}
