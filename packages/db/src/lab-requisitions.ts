import type { Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';

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

function identifierValue(ref: unknown): string | null {
  if (!isObject(ref) || !isObject(ref['identifier'])) return null;
  return trimmed(ref['identifier']['value']);
}

/** The requesting facility's code. A form order points `requester` at a contained PractitionerRole
 *  (`#requester`) whose `organization.identifier.value` is the code. A requester that is itself an
 *  Organization reference with an identifier gives that value. Anything else gives null. */
function facilityOf(sr: Json): string | null {
  const requester = sr['requester'];
  if (!isObject(requester)) return null;
  const reference = typeof requester['reference'] === 'string' ? requester['reference'] : null;
  if (reference?.startsWith('#')) {
    const id = reference.slice(1);
    const contained = Array.isArray(sr['contained']) ? sr['contained'] : [];
    const target = contained.find((c): c is Json => isObject(c) && c['id'] === id);
    if (!target) return null;
    if (target['resourceType'] === 'PractitionerRole') return identifierValue(target['organization']);
    if (target['resourceType'] === 'Organization') {
      const ids = target['identifier'];
      const first = Array.isArray(ids) ? ids[0] : undefined;
      return isObject(first) ? trimmed(first['value']) : null;
    }
    return null;
  }
  if (requester['type'] === 'Organization' || requester['type'] === undefined) return identifierValue(requester);
  return null;
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
        updated_at: new Date(),
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

/** Empties the table and indexes every current ServiceRequest again, in one transaction. This also
 *  drops the rows of ServiceRequests deleted since they were indexed. */
export async function rebuildRequisitions(db: Kysely<InternalSchema>): Promise<{ indexed: number }> {
  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom('lab_requisitions').execute();
    return { indexed: await fillRequisitions(trx) };
  });
}
