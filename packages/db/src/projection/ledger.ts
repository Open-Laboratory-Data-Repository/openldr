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

/** Every arrival recorded for one resource, oldest first.
 *
 *  Returns ALL versions, not the newest. The live path upserts the whole set so that it agrees with
 *  a rebuild even when two versions arrive between projection cycles — the cycle sees one task for
 *  the resource, and recording only the newest would silently lose the intermediate arrival while
 *  the rebuild kept it. Idempotent upsert on the composite key makes re-writing the set free. */
export async function readArrivals(
  internalDb: Kysely<InternalSchema>, resourceType: string, id: string,
): Promise<ArrivalEvent[]> {
  const rows = await internalDb
    .selectFrom('fhir.resource_history')
    .select(['resource_type', 'id', 'version', 'recorded_at'])
    .where('resource_type', '=', resourceType)
    .where('id', '=', id)
    .orderBy('version')
    .execute();
  return rows.map((r) => ({
    resource_type: r.resource_type as string,
    resource_id: r.id as string,
    version: Number(r.version),
    recorded_at: r.recorded_at as Date,
  }));
}
