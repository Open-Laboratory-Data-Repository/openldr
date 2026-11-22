import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import {
  CorrectionError, FACILITY_REGISTRY_SYSTEM, findByRequisition, indexRequisitions, persistResources,
  requesterFacility, requesterPractitionerDisplay, type FhirStore, type InternalSchema,
} from '@openldr/db';
import { validateResource } from '@openldr/fhir';
import {
  ORDER_ORIGIN_SYSTEM, ORDER_REQUISITION_SYSTEM, facilityReference, labOrderId, labSpecimenId, orderRequester,
} from '@openldr/forms';
import { TEST_CATALOG_SYSTEM, type TestCatalog } from './test-catalog';

// The lab desk's orders (lab module slices 1b and 2, spec 5.2 and 5.3): find an order by its
// requisition number whatever saved it, register one at the desk, and correct a typo on one.
// The routes and the reception page call this. Patients and samples join it in Task 6.

/** The tag code that says an order was registered at the lab's desk (ruling 14). */
export const LAB_DESK_ORIGIN = 'lab-desk';
/** The provenance source system the form routes stamp on what a form saves
 *  (`apps/server/src/forms-routes.ts` and `form-entries.ts`, through the wf-ingest Persist Store node). */
const FORM_SOURCE_SYSTEM = 'form-capture';

export interface ReceptionOrder {
  requisition: string;
  facility: { code: string; display: string | null } | null;
  origin: 'lab-desk' | 'form' | 'other';
  patient: { id: string; display: string } | null;
  priority: string | null;
  clinician: string | null;
  note: string | null;
  tests: Array<{ serviceRequestId: string; system: string; code: string; display: string | null; status: string }>;
  specimens: Array<{
    id: string;
    type: { system: string; code: string; display: string | null } | null;
    condition: string | null;
    receivedTime: string | null;
  }>;
}

export interface RegisterOrderInput {
  requisition: string;
  facilityCode: string;
  patientId: string;
  tests: Array<{ system: string; code: string }>;
  priority?: string;
  clinician?: string;
  note?: string;
}

/** What a typo correction may change (ruling 12). The facility, the number and the tests are part
 *  of the ids, so a wrong one is fixed by voiding the order and registering it again. */
export interface OrderChanges {
  priority?: string | null;
  clinician?: string | null;
  note?: string | null;
  patientId?: string;
}

export interface CorrectOrderInput {
  requisition: string;
  facilityCode: string | null;
  changes: OrderChanges;
  reason: string;
}

/** Why reception refused. A refusal writes nothing. */
export class ReceptionError extends Error {
  constructor(readonly reason: 'not-found' | 'invalid' | 'conflict', message: string) {
    super(message);
    this.name = 'ReceptionError';
  }
}

export interface LabReception {
  /** The orders with this number, one per facility. */
  findOrders(requisition: string): Promise<ReceptionOrder[]>;
  registerOrder(input: RegisterOrderInput, who: string): Promise<ReceptionOrder>;
  correctOrder(input: CorrectOrderInput, who: string): Promise<ReceptionOrder>;
}

export interface LabReceptionDeps {
  db: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  catalog: Pick<TestCatalog, 'get' | 'loincCodingsFor'>;
  logger: Logger;
}

type Json = Record<string, unknown>;

const CHANGE_KEYS: ReadonlySet<string> = new Set(['priority', 'clinician', 'note', 'patientId']);

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function invalid(message: string): ReceptionError {
  return new ReceptionError('invalid', message);
}

/** A patient's name as one line: name.text, else the given names and the family name. */
function patientName(patient: Json | null): string | null {
  const names = patient && Array.isArray(patient['name']) ? patient['name'] : [];
  const first = names[0];
  if (!isObject(first)) return null;
  const whole = text(first['text']);
  if (whole) return whole;
  const given = Array.isArray(first['given']) ? first['given'].filter((g): g is string => typeof g === 'string') : [];
  const joined = [...given, typeof first['family'] === 'string' ? first['family'] : ''].join(' ').trim();
  return joined || null;
}

function patientIdOf(sr: Json): string | null {
  const subject = sr['subject'];
  const ref = isObject(subject) ? text(subject['reference']) : null;
  return ref && ref.startsWith('Patient/') ? ref.slice('Patient/'.length) : null;
}

function isDeskOrder(sr: Json): boolean {
  const meta = sr['meta'];
  const tags = isObject(meta) && Array.isArray(meta['tag']) ? meta['tag'] : [];
  return tags.some((t) => isObject(t) && t['system'] === ORDER_ORIGIN_SYSTEM && t['code'] === LAB_DESK_ORIGIN);
}

function noteOf(sr: Json): string | null {
  const notes = Array.isArray(sr['note']) ? sr['note'] : [];
  return isObject(notes[0]) ? text(notes[0]['text']) : null;
}

/**
 * The tests of one request. An old order saved by the Lab order form holds every test as a coding
 * (ruling 2), so each catalog coding is a test of its own. A request with no catalog coding (one sent
 * by sync or ingest, coded by its source) counts its first coding as its test.
 */
function testsOf(sr: Json): ReceptionOrder['tests'] {
  const id = String(sr['id']);
  const status = typeof sr['status'] === 'string' ? sr['status'] : 'unknown';
  const code = sr['code'];
  const codings = (isObject(code) && Array.isArray(code['coding']) ? code['coding'] : [])
    .filter((c): c is Json => isObject(c) && typeof c['code'] === 'string' && typeof c['system'] === 'string');
  const catalog = codings.filter((c) => c['system'] === TEST_CATALOG_SYSTEM);
  const chosen = catalog.length > 0 ? catalog : codings.slice(0, 1);
  return chosen.map((c) => ({
    serviceRequestId: id,
    system: c['system'] as string,
    code: c['code'] as string,
    display: text(c['display']),
    status,
  }));
}

function specimenOf(sp: Json): ReceptionOrder['specimens'][number] {
  const type = sp['type'];
  const coding = isObject(type) && Array.isArray(type['coding']) && isObject(type['coding'][0]) ? type['coding'][0] : null;
  const conditions = Array.isArray(sp['condition']) ? sp['condition'] : [];
  const cond = isObject(conditions[0]) ? conditions[0] : null;
  const condCoding = cond && Array.isArray(cond['coding']) && isObject(cond['coding'][0]) ? cond['coding'][0] : null;
  return {
    id: String(sp['id']),
    type: coding && typeof coding['system'] === 'string' && typeof coding['code'] === 'string'
      ? { system: coding['system'], code: coding['code'], display: text(coding['display']) }
      : null,
    condition: (cond && text(cond['text'])) ?? (condCoding && (text(condCoding['display']) ?? text(condCoding['code']))) ?? null,
    receivedTime: text(sp['receivedTime']),
  };
}

/**
 * The sample types an order's tests take: the union, in first-seen order, of each catalog test's
 * types (the lab's own list when it set one, else the catalog's). Tests outside the catalog take
 * none. Reception reads an order's Specimens at these types' fixed ids, and the sample choices
 * offered for an order come from the same list.
 */
export async function orderSpecimenTypes(
  catalog: Pick<TestCatalog, 'get'>, tests: Array<{ system: string; code: string }>,
): Promise<Array<{ system: string; code: string }>> {
  const types = new Map<string, { system: string; code: string }>();
  const seen = new Set<string>();
  for (const t of tests) {
    if (t.system !== TEST_CATALOG_SYSTEM || seen.has(t.code)) continue;
    seen.add(t.code);
    const test = await catalog.get(t.code);
    for (const s of test ? (test.lab.specimenTypes ?? test.specimenTypes) : []) {
      const key = `${s.system}|${s.code}`;
      if (!types.has(key)) types.set(key, { system: s.system, code: s.code });
    }
  }
  return [...types.values()];
}

export function createLabReception(deps: LabReceptionDeps): LabReception {
  const { db, fhirStore, catalog } = deps;

  async function patientOf(id: string): Promise<Json | null> {
    return (await fhirStore.get('Patient', id)) as Json | null;
  }

  /** The Specimens of one order, read at their fixed ids: one per sample type its tests take
   *  (ruling 13). A Specimen with any other id is not shown, so a lookup never scans the store. */
  async function specimensOf(facility: string | null, requisition: string, requests: Json[]): Promise<ReceptionOrder['specimens']> {
    const out: ReceptionOrder['specimens'] = [];
    for (const type of await orderSpecimenTypes(catalog, requests.flatMap(testsOf))) {
      const sp = (await fhirStore.get('Specimen', labSpecimenId(facility, requisition, type))) as Json | null;
      if (sp) out.push(specimenOf(sp));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async function orderOf(requisition: string, facility: string | null, ids: string[]): Promise<ReceptionOrder | null> {
    const loaded: Array<{ sr: Json; source: string | null }> = [];
    for (const id of ids) {
      const got = await fhirStore.getWithProvenance('ServiceRequest', id);
      if (got) loaded.push({ sr: got.resource as unknown as Json, source: got.provenance.sourceSystem ?? null });
    }
    if (loaded.length === 0) return null;
    const requests = loaded.map((l) => l.sr);
    const first = requests[0]!;
    const named = requesterFacility(first);
    const origin: ReceptionOrder['origin'] = requests.some(isDeskOrder)
      ? 'lab-desk'
      : loaded.some((l) => l.source === FORM_SOURCE_SYSTEM) ? 'form' : 'other';
    const pid = patientIdOf(first);
    let patient: ReceptionOrder['patient'] = null;
    if (pid) {
      const subject = first['subject'] as Json;
      patient = { id: pid, display: text(subject['display']) ?? patientName(await patientOf(pid)) ?? pid };
    }
    return {
      requisition,
      facility: facility ? { code: facility, display: named.code === facility ? named.display : null } : null,
      origin,
      patient,
      priority: text(first['priority']),
      clinician: requesterPractitionerDisplay(first),
      note: noteOf(first),
      tests: requests.flatMap(testsOf),
      specimens: await specimensOf(facility, requisition, requests),
    };
  }

  /** The request ids of each facility's order under this number, facilities in code order. */
  async function groups(requisition: string): Promise<Array<{ facility: string | null; ids: string[] }>> {
    const byFacility = new Map<string | null, string[]>();
    for (const row of await findByRequisition(db, requisition)) {
      const ids = byFacility.get(row.facility) ?? [];
      ids.push(row.serviceRequestId);
      byFacility.set(row.facility, ids);
    }
    return [...byFacility.entries()]
      .map(([facility, ids]) => ({ facility, ids }))
      .sort((a, b) => (a.facility ?? '').localeCompare(b.facility ?? ''));
  }

  async function findOrders(requisition: string): Promise<ReceptionOrder[]> {
    const key = text(requisition);
    if (!key) return [];
    const out: ReceptionOrder[] = [];
    for (const g of await groups(key)) {
      const order = await orderOf(key, g.facility, g.ids);
      if (order) out.push(order);
    }
    return out;
  }

  async function findOne(requisition: string, facility: string | null): Promise<ReceptionOrder | null> {
    return (await findOrders(requisition)).find((o) => (o.facility?.code ?? null) === facility) ?? null;
  }

  async function subjectFor(patientId: string): Promise<{ reference: string; display?: string }> {
    const id = patientId.trim();
    const patient = id ? await patientOf(id) : null;
    if (!patient) throw invalid(`Patient ${patientId} was not found.`);
    const name = patientName(patient);
    return { reference: `Patient/${id}`, ...(name ? { display: name } : {}) };
  }

  async function facilityDisplay(code: string): Promise<string | null> {
    const row = await db.selectFrom('terminology_concepts').select('display')
      .where('system', '=', FACILITY_REGISTRY_SYSTEM).where('code', '=', code)
      .executeTakeFirst();
    if (!row) throw invalid(`Facility ${code} is not in the facility register.`);
    return row.display;
  }

  async function registerOrder(input: RegisterOrderInput, who: string): Promise<ReceptionOrder> {
    const requisition = text(input.requisition);
    if (!requisition) throw invalid('A requisition number is required.');
    const facilityCode = text(input.facilityCode);
    if (!facilityCode) throw invalid('A facility is required.');
    const actor = text(who);
    if (!actor) throw invalid('A registration needs the name of who made it.');
    const tests = [...new Map((input.tests ?? []).map((t) => [`${t.system}|${t.code}`, t])).values()];
    if (tests.length === 0) throw invalid('An order needs at least one test.');

    // Every check that reads, before any write.
    const facilityName = await facilityDisplay(facilityCode);
    const subject = await subjectFor(input.patientId ?? '');
    const named: Array<{ system: string; code: string; display: string }> = [];
    for (const t of tests) {
      const test = t.system === TEST_CATALOG_SYSTEM ? await catalog.get(t.code) : null;
      if (!test || !test.active || !test.lab.enabled) throw invalid(`Test ${t.code} is not a test this lab offers.`);
      named.push({ system: TEST_CATALOG_SYSTEM, code: test.code, display: test.lab.localDisplay ?? test.display ?? test.code });
    }
    const ids = named.map((t) => labOrderId(facilityCode, requisition, t));
    // The index lags a save by one projection cycle, so the fixed ids are checked as well.
    const known = (await findByRequisition(db, requisition)).some((r) => r.facility === facilityCode);
    let stored = known;
    for (const id of ids) if (!stored && await fhirStore.exists('ServiceRequest', id)) stored = true;
    if (stored) throw new ReceptionError('conflict', `Requisition ${requisition} from ${facilityCode} is already registered.`);

    const loinc = await catalog.loincCodingsFor(named);
    const clinician = text(input.clinician) ?? undefined;
    const requester = orderRequester(clinician, facilityReference({
      system: FACILITY_REGISTRY_SYSTEM, code: facilityCode, ...(facilityName ? { display: facilityName } : {}),
    }));
    const priority = text(input.priority);
    const note = text(input.note);
    const authoredOn = new Date().toISOString();
    const number = { system: ORDER_REQUISITION_SYSTEM, value: requisition };
    // The form's shape (ruling 2): one request per test, LOINC in front when linked, and the
    // requester the extractor writes.
    const requests: Json[] = named.map((t, i) => {
      const before = loinc.get(`${t.system}|${t.code}`);
      return {
        resourceType: 'ServiceRequest',
        id: ids[i],
        meta: { tag: [{ system: ORDER_ORIGIN_SYSTEM, code: LAB_DESK_ORIGIN }] },
        status: 'active',
        intent: 'order',
        subject,
        authoredOn,
        identifier: [{ ...number }],
        requisition: { ...number },
        code: { coding: [...(before ? [{ ...before }] : []), { ...t }], text: t.display },
        ...(priority ? { priority } : {}),
        ...(note ? { note: [{ text: note }] } : {}),
        ...(requester ? { contained: [requester.contained], requester: requester.requester } : {}),
      };
    });
    const provenance = {
      resourceType: 'Provenance',
      id: randomUUID(),
      target: ids.map((id) => ({ reference: `ServiceRequest/${id}` })),
      recorded: authoredOn,
      activity: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'CREATE' }] },
      agent: [{ who: { display: actor } }],
    };
    for (const r of requests) {
      const checked = validateResource(r);
      if (!checked.ok) {
        throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
      }
    }
    await persistResources({ fhirStore, logger: deps.logger }, [...requests, provenance], { sourceSystem: LAB_DESK_ORIGIN });
    await indexRequisitions(db, requests);
    const order = await findOne(requisition, facilityCode);
    if (!order) throw new Error(`registered requisition ${requisition} could not be read back`);
    return order;
  }

  /** The request with the typo corrected. */
  function corrected(sr: Json, changes: OrderChanges, subject: Json | null): Json {
    // The tags (the desk origin) stay. The store stamps the version and the time again.
    const next = structuredClone(sr);
    if ('priority' in changes) {
      const p = text(changes.priority);
      if (p) next['priority'] = p; else delete next['priority'];
    }
    if ('note' in changes) {
      const n = text(changes.note);
      if (n) next['note'] = [{ text: n }]; else delete next['note'];
    }
    if (subject) next['subject'] = subject;
    if ('clinician' in changes) {
      const clinician = text(changes.clinician) ?? undefined;
      const role = (Array.isArray(next['contained']) ? next['contained'] : [])
        .find((c): c is Json => isObject(c) && c['resourceType'] === 'PractitionerRole' && c['id'] === 'requester');
      const requester = isObject(next['requester']) ? next['requester'] : null;
      // The facility the order already names stays: from the contained role, or a requester that
      // is itself a facility reference.
      const organization = role && isObject(role['organization'])
        ? role['organization']
        : requester && isObject(requester['identifier']) ? requester : undefined;
      const built = orderRequester(clinician, organization as never);
      const others = (Array.isArray(next['contained']) ? next['contained'] : []).filter((c) => c !== role);
      if (built) {
        next['contained'] = [...others, built.contained];
        next['requester'] = built.requester;
      } else {
        if (others.length > 0) next['contained'] = others; else delete next['contained'];
        delete next['requester'];
      }
    }
    return next;
  }

  async function correctOrder(input: CorrectOrderInput, who: string): Promise<ReceptionOrder> {
    const changes: OrderChanges | null = isObject(input.changes) ? input.changes as OrderChanges : null;
    if (!changes) throw invalid('Say what to correct.');
    const extra = Object.keys(changes).filter((k) => !CHANGE_KEYS.has(k));
    if (extra.length > 0) {
      throw invalid(`A correction may change the priority, clinician, note and patient only, not ${extra.join(', ')}. `
        + 'A wrong requisition number, facility or test list is fixed by voiding the order and registering it again.');
    }
    if (Object.keys(changes).length === 0) throw invalid('Say what to correct.');
    const reason = text(input.reason);
    if (!reason) throw invalid('A correction needs a reason.');
    const actor = text(who);
    if (!actor) throw invalid('A correction needs the name of who made it.');
    const requisition = text(input.requisition);
    if (!requisition) throw invalid('A requisition number is required.');
    const facility = text(input.facilityCode);

    const group = (await groups(requisition)).find((g) => g.facility === facility);
    if (!group) throw new ReceptionError('not-found', `No order ${requisition}${facility ? ` from ${facility}` : ''} was found.`);
    const subject = changes.patientId !== undefined ? await subjectFor(String(changes.patientId)) : null;
    const nexts: Json[] = [];
    for (const id of group.ids) {
      const sr = (await fhirStore.get('ServiceRequest', id)) as Json | null;
      if (!sr) continue;
      const next = corrected(sr, changes, subject);
      const checked = validateResource(next);
      if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
      nexts.push(next);
    }
    if (nexts.length === 0) throw new ReceptionError('not-found', `No order ${requisition} was found.`);
    // One correction per request, each with its own Provenance and the same reason. Every body was
    // checked above, so a refusal part way through is a store failure, not a bad edit.
    for (const next of nexts) {
      try {
        await fhirStore.correct({ resourceType: 'ServiceRequest', id: String(next['id']), next, who: actor, reason });
      } catch (err) {
        if (err instanceof CorrectionError) {
          throw new ReceptionError(err.reason === 'not-found' ? 'not-found' : 'invalid', err.message);
        }
        throw err;
      }
    }
    const order = await findOne(requisition, facility);
    if (!order) throw new Error(`corrected requisition ${requisition} could not be read back`);
    return order;
  }

  return { findOrders, registerOrder, correctOrder };
}
