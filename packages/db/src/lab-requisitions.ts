import { sql, type Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import { requesterFacility } from './relational/requester';

// Finds a ServiceRequest by its requisition number, whatever saved it: a form, sync or ingest.
// The FHIR store has no search index, so `lab_requisitions` (internal migration 139) holds one row
// per ServiceRequest that has a number. The projection hooks keep it current, and
// `rebuildRequisitions` writes it again from the store.
//
// A ServiceRequest deleted from the store keeps its row until the next rebuild: the projection
// fires no hook on a delete. `findByRequisition` joins `fhir.fhir_current`, so it never returns one.

export interface RequisitionRow { serviceRequestId: string; requisition: string; facility: string | null }

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function trimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** The number: `requisition.value` on a per-test request, else `identifier[0].value`, which is all an
 *  older multi-coding request has. Trimmed, as the form route keys it (`entryKeyOf`). */
function requisitionOf(sr: Json): string | null {
  const fromRequisition = isObject(sr['requisition']) ? trimmed(sr['requisition']['value']) : null;
  if (fromRequisition) return fromRequisition;
  const ids = sr['identifier'];
  const first = Array.isArray(ids) ? ids[0] : undefined;
  return isObject(first) ? trimmed(first['value']) : null;
}

/** The requesting facility's code, read by the warehouse's own `requesterFacility` (which fills
 *  `lab_requests.requester_code`), so both name the same facility. Trimmed here. */
function facilityOf(sr: Json): string | null {
  return trimmed(requesterFacility(sr).code);
}

/** The lookup row of one ServiceRequest, or null when it has no id or no requisition number. */
export function requisitionRowOf(sr: Record<string, unknown>): RequisitionRow | null {
  if (sr['resourceType'] !== undefined && sr['resourceType'] !== 'ServiceRequest') return null;
  const serviceRequestId = trimmed(sr['id']);
  const requisition = requisitionOf(sr);
  if (!serviceRequestId || !requisition) return null;
  return { serviceRequestId, requisition, facility: facilityOf(sr) };
}

const CHUNK = 500;

/** Upserts the row of each ServiceRequest, and removes the row of one that no longer has a number.
 *  Resolves to the number of rows written. */
export async function indexRequisitions(db: Kysely<InternalSchema>, srs: Record<string, unknown>[]): Promise<number> {
  // One row per id, the last copy winning: Postgres refuses an upsert that touches a row twice.
  const rows = new Map<string, RequisitionRow>();
  const without: string[] = [];
  for (const sr of srs) {
    const row = requisitionRowOf(sr);
    if (row) rows.set(row.serviceRequestId, row);
    else if (typeof sr['id'] === 'string' && (sr['resourceType'] ?? 'ServiceRequest') === 'ServiceRequest') without.push(sr['id']);
  }
  const gone = without.filter((id) => !rows.has(id));
  for (let i = 0; i < gone.length; i += CHUNK) {
    await db.deleteFrom('lab_requisitions').where('service_request_id', 'in', gone.slice(i, i + CHUNK)).execute();
  }
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += CHUNK) {
    await db.insertInto('lab_requisitions')
      .values(values.slice(i, i + CHUNK).map((r) => ({ service_request_id: r.serviceRequestId, requisition: r.requisition, facility: r.facility })))
      .onConflict((oc) => oc.column('service_request_id').doUpdateSet((eb) => ({
        requisition: eb.ref('excluded.requisition'),
        facility: eb.ref('excluded.facility'),
        updated_at: sql<Date>`now()`,
      })))
      .execute();
  }
  return values.length;
}

/** The current ServiceRequests with this number, exact after trimming. A blank number finds none. */
export async function findByRequisition(
  db: Kysely<InternalSchema>, requisition: string,
): Promise<Array<{ serviceRequestId: string; facility: string | null }>> {
  const key = requisition.trim();
  if (!key) return [];
  const rows = await db.selectFrom('lab_requisitions as r')
    .innerJoin('fhir.fhir_current as c', (j) => j.onRef('c.id', '=', 'r.service_request_id').on('c.resource_type', '=', 'ServiceRequest'))
    .select(['r.service_request_id', 'r.facility'])
    .where('r.requisition', '=', key)
    .orderBy('r.service_request_id')
    .execute();
  return rows.map((r) => ({ serviceRequestId: r.service_request_id, facility: r.facility }));
}

const PAGE = 1000;

/** Indexes every current ServiceRequest, a page at a time. Writes over existing rows, removes none. */
export async function fillRequisitions(db: Kysely<InternalSchema>): Promise<number> {
  let indexed = 0;
  let after = '';
  for (;;) {
    const page = await db.selectFrom('fhir.fhir_resources')
      .select(['id', 'resource'])
      .where('resource_type', '=', 'ServiceRequest')
      .where('id', '>', after)
      .orderBy('id')
      .limit(PAGE)
      .execute();
    if (page.length === 0) break;
    const srs = page.map((r) => {
      const doc = typeof r.resource === 'string' ? JSON.parse(r.resource) as Json : r.resource as Json;
      return { ...doc, id: r.id };
    });
    indexed += await indexRequisitions(db, srs);
    after = page[page.length - 1]!.id;
    if (page.length < PAGE) break;
  }
  return indexed;
}

/** Indexes every current ServiceRequest again, then drops the rows the fill did not touch: those of
 *  requests deleted from the store, or that no longer have a number. No single transaction and no
 *  full-table delete first, so the projection hooks keep writing while it runs. A row the projection
 *  writes during the rebuild carries a newer `updated_at` and stays. */
export async function rebuildRequisitions(db: Kysely<InternalSchema>): Promise<{ indexed: number }> {
  const started = await sql<{ now: Date }>`select now() as now`.execute(db);
  const since = started.rows[0]!.now;
  const indexed = await fillRequisitions(db);
  await db.deleteFrom('lab_requisitions').where('updated_at', '<', since).execute();
  // A left join, not `not exists`: pg-mem has no correlated subqueries.
  const orphans = await db.selectFrom('lab_requisitions as r')
    .leftJoin('fhir.fhir_current as c', (j) => j.onRef('c.id', '=', 'r.service_request_id').on('c.resource_type', '=', 'ServiceRequest'))
    .select('r.service_request_id')
    .where('c.id', 'is', null)
    .execute();
  const ids = orphans.map((o) => o.service_request_id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    await db.deleteFrom('lab_requisitions').where('service_request_id', 'in', ids.slice(i, i + CHUNK)).execute();
  }
  return { indexed };
}
