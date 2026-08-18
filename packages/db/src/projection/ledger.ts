import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';

/** One recorded arrival of one version of one resource. Mirrors a `fhir.resource_history` row. */
export interface ArrivalEvent {
  resource_type: string;
  resource_id: string;
  version: number;
  recorded_at: Date;
}

/** The resource types whose arrivals are recorded in `ingest_events`.
 *
 *  Clinical only. Config and reference resources are excluded because they are re-saved by seeding
 *  and admin edits — measured 2026-08-17: Organization 46.4 versions each, Questionnaire 93.0,
 *  Location 399.0, against 2.0-2.2 for every clinical type. Recording them would let an operator
 *  editing a form look identical to a laboratory transmitting results. */
export const LEDGER_RESOURCE_TYPES = [
  'ServiceRequest',
  'Specimen',
  'Observation',
  'DiagnosticReport',
  'Patient',
] as const;

const TYPE_SET: ReadonlySet<string> = new Set(LEDGER_RESOURCE_TYPES);

export function isLedgerResourceType(resourceType: string): boolean {
  return TYPE_SET.has(resourceType);
}

/** A `fhir.resource_history` row, as selected by both `readArrivals` and `reprojectAll`'s rebuild
 *  scan — same table, same four columns, same shape. `version`'s type varies by driver (number here,
 *  string/bigint over some Postgres bigint decoders), which is why `toArrivalEvent` re-normalizes it. */
export interface ResourceHistoryRow {
  resource_type: string;
  id: string;
  version: number | string | bigint;
  recorded_at: unknown;
}

/** Map one `fhir.resource_history` row to the `ArrivalEvent` shape `writeIngestEvents` accepts.
 *  Extracted so the rebuild scan (`cycle.ts`) and the live path (`readArrivals`, below) cannot drift
 *  apart on column mapping — this used to be copy-pasted in both places. */
export function toArrivalEvent(row: ResourceHistoryRow): ArrivalEvent {
  return {
    resource_type: row.resource_type,
    resource_id: row.id,
    version: Number(row.version),
    recorded_at: row.recorded_at as Date,
  };
}

/** Every arrival recorded for one resource, oldest first.
 *
 *  Returns ALL versions, not the newest. The live path upserts the whole set so that it agrees with
 *  a rebuild when two versions arrive between projection cycles — the cycle sees one task for
 *  the resource, and recording only the newest would silently lose the intermediate arrival while
 *  the rebuild kept it. Idempotent upsert on the composite key makes re-writing the set free.
 *
 *  This does not make the live path and a rebuild identical by construction; they run different
 *  queries over the same table, and a failed live ledger write is logged and skipped (`cycle.ts`).
 *  It makes them agree on the multi-version case. `applyProjection` calls this on BOTH the found and
 *  the deleted branch for the same reason — see its comment for the two ways a real arrival exists
 *  with no canonical row. A rebuild stays the repair path.
 *
 *  Filtered to `op = 'upsert'`: a `delete()` tombstone (`fhir-store.ts`'s `op: 'delete'`, `resource:
 *  null`) is data going AWAY, not an arrival. `ingest_events` has no `op` column to record a
 *  retraction separately — if that is ever needed it is a deliberate design change with its own
 *  migration, not a filter tweak here. */
export async function readArrivals(
  internalDb: Kysely<InternalSchema>, resourceType: string, id: string,
): Promise<ArrivalEvent[]> {
  const rows = await internalDb
    .selectFrom('fhir.resource_history')
    .select(['resource_type', 'id', 'version', 'recorded_at'])
    .where('resource_type', '=', resourceType)
    .where('id', '=', id)
    .where('op', '=', 'upsert')
    .orderBy('version')
    .execute();
  return rows.map(toArrivalEvent);
}
