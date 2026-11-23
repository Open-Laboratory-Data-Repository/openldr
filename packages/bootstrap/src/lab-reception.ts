import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Logger } from '@openldr/core';
import {
  CorrectionError, FACILITY_REGISTRY_SYSTEM, findByRequisition, indexRequisitions, patientMatchKey, persistResources,
  requesterFacility, requesterPractitionerDisplay, type ExternalSchema, type FhirStore, type InternalSchema,
} from '@openldr/db';
import { Patient, validateResource } from '@openldr/fhir';
import {
  ORDER_ORIGIN_SYSTEM, ORDER_REJECTION_EXTENSION, ORDER_REQUISITION_SYSTEM, facilityReference, labOrderId, labSpecimenId,
  labTaskId, orderKey, orderRequester,
} from '@openldr/forms';
import type { Operations } from '@openldr/terminology';
import type { PatientIndex } from './patient-index';
import { TEST_CATALOG_SYSTEM, type TestCatalog } from './test-catalog';
import {
  CHANGE_KEYS, LAB_DESK_ORIGIN, NOT_LIVE, ReceptionError, VOIDED, deskProvenance, invalid, isDeskOrder, isLive, isObject,
  statusOf, text,
} from './lab-shared';

// The package root exports these two from here, as before lab slice 3 moved them to lab-shared.ts.
export { LAB_DESK_ORIGIN, ReceptionError };

// The lab desk's orders (lab module slices 1b and 2, spec 5.2 and 5.3): find an order by its
// requisition number whatever saved it, register one at the desk, and correct a typo on one.
// It also finds and registers patients and receives samples. The routes and the reception page call this.

/** Says a Patient's birth date was worked out from an age, as 1 January of that year (ruling 10). */
export const BIRTHDATE_ESTIMATED_EXTENSION = 'urn:openldr:ext:birthdate-estimated';
/** The sample conditions a lab may record. Must equal SAMPLE_CONDITION_VALUE_SET in internal migration 137. */
export const SAMPLE_CONDITION_VALUE_SET = 'urn:openldr:valueset:sample-condition';
/** The oldest age a registration takes. */
const MAX_AGE_YEARS = 130;
/** The most patients one search shows. A strong match finds one or two. */
const SEARCH_LIMIT = 25;
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The most words a name search takes. Each split of the words is a key, so this bounds the lookup. */
const NAME_SEARCH_MAX_WORDS = 6;
/** The sexes a Patient may have, from the Patient schema itself (ruling 11). */
const GENDERS: readonly string[] = Patient.shape.gender.unwrap().options;

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
  tests: Array<{
    serviceRequestId: string; system: string; code: string; display: string | null; status: string;
    /** Why the request was rejected, from its rejection extension. */
    rejection: { code: string; display: string | null } | null;
  }>;
  specimens: Array<{
    id: string;
    type: { system: string; code: string; display: string | null } | null;
    condition: string | null;
    receivedTime: string | null;
    /** The Specimen status as stored: unsatisfactory is a rejected sample. */
    status: string | null;
  }>;
  /** The open return Task (lab slice 3, ruling 2): why the lab returned the order, who did and when. */
  returned: { reason: { code: string; display: string | null }; by: string | null; at: string } | null;
  /** The redraw Tasks of the order's samples and requests (ruling 7), read at their fixed ids. */
  redraws: Array<{ taskId: string; status: 'requested' | 'completed'; focus: string; replacedBy: string | null }>;
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
 *  of the ids, so a wrong one is fixed by cancelling a desk order (cancelOrder) and registering it
 *  again, or by voiding a form order from its form entry. */
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

export interface CancelOrderInput {
  requisition: string;
  facilityCode: string | null;
  reason: string;
}


export interface PatientSearch { identifier?: string; name?: string; birthDate?: string }

export interface FoundPatient {
  id: string;
  name: string;
  birthDate: string | null;
  gender: string | null;
  identifiers: Array<{ system: string; value: string }>;
}

export interface RegisterPatientInput {
  given: string;
  family: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  /** When both are given, the birth date wins and the age is ignored. */
  birthDate?: string;
  ageYears?: number;
  identifier?: { system: string; value: string };
}

export interface ReceiveSampleInput {
  requisition: string;
  facilityCode: string | null;
  type: { system: string; code: string; display?: string };
  condition?: { system: string; code: string; display?: string };
  /** The requests this sample serves. Left out, it serves every live request of the order. */
  serviceRequestIds?: string[];
  /** Left out, a first receipt takes the time now and a second keeps the time stored. */
  receivedTime?: string;
}

export interface SampleChoices { types: Array<{ system: string; code: string; display: string | null }> }

export interface LabReception {
  /** The orders with this number, one per facility. */
  findOrders(requisition: string): Promise<ReceptionOrder[]>;
  registerOrder(input: RegisterOrderInput, who: string): Promise<ReceptionOrder>;
  correctOrder(input: CorrectOrderInput, who: string): Promise<ReceptionOrder>;
  /** Voids every live request of a desk order (status entered-in-error), so its number can be
   *  registered again. A form order is voided from its form entry instead. */
  cancelOrder(input: CancelOrderInput, who: string): Promise<ReceptionOrder>;
  /** Patients on a strong match only (ruling 9): an exact identifier, or a full name of 2 to 6 words
   *  with the full birth date. Anything else finds no one, so the desk never browses patients. */
  searchPatients(q: PatientSearch): Promise<FoundPatient[]>;
  registerPatient(input: RegisterPatientInput, who: string): Promise<{ id: string; display: string }>;
  /** Writes, or updates, the one Specimen of this sample type for the order (ruling 13). */
  receiveSample(input: ReceiveSampleInput, who: string): Promise<ReceptionOrder>;
  sampleChoices(requisition: string, facilityCode: string | null): Promise<SampleChoices>;
}

export interface LabReceptionDeps {
  db: Kysely<InternalSchema>;
  /** The warehouse, where patient search reads `patients`. */
  externalDb: Kysely<ExternalSchema>;
  fhirStore: FhirStore;
  catalog: Pick<TestCatalog, 'get' | 'loincCodingsFor'>;
  ops: Pick<Operations, 'expand' | 'lookup'>;
  patientIndex: Pick<PatientIndex, 'list' | 'idForRef' | 'rowsByIds'>;
  logger: Logger;
  /** The lab's own time zone (the lab.timezone setting). Unset, or a zone the runtime cannot read,
   *  and the lab's date is the UTC date. */
  labTimeZone?: () => Promise<string | null | undefined>;
  /** The clock. Tests set it. */
  now?: () => Date;
}

type Json = Record<string, unknown>;

/** A YYYY-MM-DD that names a real day: 1990-02-31 is refused. */
export function isCalendarDate(v: string): boolean {
  if (!FULL_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The date at this moment in the given IANA zone, as YYYY-MM-DD. No zone, or one the runtime does
 *  not know, gives the UTC date. */
export function dateInZone(at: Date, zone: string | null | undefined): string {
  const z = zone?.trim();
  if (z) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(at);
      const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      const out = `${part('year')}-${part('month')}-${part('day')}`;
      if (FULL_DATE.test(out)) return out;
    } catch { /* an unknown zone falls back to UTC */ }
  }
  return at.toISOString().slice(0, 10);
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

function noteOf(sr: Json): string | null {
  const notes = Array.isArray(sr['note']) ? sr['note'] : [];
  return isObject(notes[0]) ? text(notes[0]['text']) : null;
}

/**
 * The tests of one request. An old order saved by the Lab order form holds every test as a coding
 * (ruling 2), so each catalog coding is a test of its own. A request with no catalog coding (one sent
 * by sync or ingest, coded by its source) counts its first coding as its test.
 */
/** The rejection a request carries in its rejection extension, the shape the warehouse reads. */
function rejectionOf(sr: Json): { code: string; display: string | null } | null {
  const ext = (Array.isArray(sr['extension']) ? sr['extension'] : [])
    .find((e): e is Json => isObject(e) && e['url'] === ORDER_REJECTION_EXTENSION);
  const parts = ext && Array.isArray(ext['extension']) ? ext['extension'].filter(isObject) : [];
  const code = text(parts.find((p) => p['url'] === 'code')?.['valueCode']);
  return code ? { code, display: text(parts.find((p) => p['url'] === 'reason')?.['valueString']) } : null;
}

function testsOf(sr: Json): ReceptionOrder['tests'] {
  const id = String(sr['id']);
  const rejection = rejectionOf(sr);
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
    rejection,
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
    status: text(sp['status']),
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

/** The id of an order's return Task (lab slice 3, ruling 2): one per order, not per test. */
export function returnTaskId(facility: string | null, requisition: string): string {
  return labTaskId('correct-request', orderKey(facility, requisition));
}

/** The id of a redraw Task (ruling 7). The focus is a Specimen id or a ServiceRequest id. */
export function redrawTaskId(focusId: string): string {
  return labTaskId('recollect-sample', focusId);
}

/** The coding a Task's statusReason holds, as the order panel shows it. */
function reasonOf(task: Json): { code: string; display: string | null } | null {
  const reason = task['statusReason'];
  const coding = isObject(reason) && Array.isArray(reason['coding']) && isObject(reason['coding'][0]) ? reason['coding'][0] : null;
  const code = coding ? text(coding['code']) : null;
  return code ? { code, display: text(coding!['display']) } : null;
}

export function createLabReception(deps: LabReceptionDeps): LabReception {
  return createReceptionCore(deps).reception;
}

/** Reception and the helpers the rejection module (lab-rejection.ts) shares with it. */
export function createReceptionCore(deps: LabReceptionDeps) {
  const { db, fhirStore, catalog } = deps;
  const now = deps.now ?? (() => new Date());

  /** Today at the lab, from the lab.timezone setting; the UTC date when it is unset or unreadable. */
  async function labToday(): Promise<string> {
    let zone: string | null | undefined;
    try { zone = await deps.labTimeZone?.(); } catch { zone = null; }
    return dateInZone(now(), zone);
  }

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
    // The order's details come from a live request: a cancelled one may hold what was replaced.
    const first = requests.find(isLive) ?? requests[0]!;
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
    const specimens = await specimensOf(facility, requisition, requests);
    return {
      requisition,
      facility: facility ? { code: facility, display: named.code === facility ? named.display : null } : null,
      origin,
      patient,
      priority: text(first['priority']),
      clinician: requesterPractitionerDisplay(first),
      note: noteOf(first),
      tests: requests.flatMap(testsOf),
      specimens,
      returned: await returnedOf(facility, requisition),
      redraws: await redrawsOf([
        ...specimens.map((s) => `Specimen/${s.id}`),
        ...requests.map((r) => `ServiceRequest/${String(r['id'])}`),
      ]),
    };
  }

  /** The person named by the last Provenance a Task links in relevantHistory: a read by id, not a scan. */
  async function taskActor(task: Json): Promise<string | null> {
    const history = Array.isArray(task['relevantHistory']) ? task['relevantHistory'] : [];
    const last = history[history.length - 1];
    const ref = isObject(last) ? text(last['reference']) : null;
    if (!ref || !ref.startsWith('Provenance/')) return null;
    const prov = (await fhirStore.get('Provenance', ref.slice('Provenance/'.length))) as Json | null;
    const agent = prov && Array.isArray(prov['agent']) && isObject(prov['agent'][0]) ? prov['agent'][0] : null;
    return agent && isObject(agent['who']) ? text(agent['who']['display']) : null;
  }

  /** The order's return Task while it is open (status requested), else null. */
  async function returnedOf(facility: string | null, requisition: string): Promise<ReceptionOrder['returned']> {
    const task = (await fhirStore.get('Task', returnTaskId(facility, requisition))) as Json | null;
    if (!task || task['status'] !== 'requested') return null;
    return {
      reason: reasonOf(task) ?? { code: 'unknown', display: null },
      by: await taskActor(task),
      at: text(task['authoredOn']) ?? text(task['lastModified']) ?? '',
    };
  }

  /** The redraw Tasks for these focus references, each read at its fixed id. A cancelled one is not shown. */
  async function redrawsOf(focuses: string[]): Promise<ReceptionOrder['redraws']> {
    const out: ReceptionOrder['redraws'] = [];
    for (const focus of [...new Set(focuses)]) {
      const taskId = redrawTaskId(focus.slice(focus.indexOf('/') + 1));
      const task = (await fhirStore.get('Task', taskId)) as Json | null;
      const status = task?.['status'];
      if (status !== 'requested' && status !== 'completed') continue;
      // The redraw order a completed Task names in its output (linkRedraw), by its requisition number.
      const outputs = Array.isArray(task!['output']) ? task!['output'].filter(isObject) : [];
      const ref = outputs.map((o) => o['valueReference']).find(isObject);
      out.push({ taskId, status, focus, replacedBy: status === 'completed' && ref ? text(ref['display']) : null });
    }
    return out;
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
    // The index lags a save by one projection cycle, so the fixed ids are checked as well. A voided
    // request (a cancelled desk order, a voided form entry) no longer holds the number, and the
    // save below writes over its fixed id as a new version.
    const held = async (id: string): Promise<boolean> => {
      const sr = (await fhirStore.get('ServiceRequest', id)) as Json | null;
      return sr !== null && statusOf(sr) !== VOIDED;
    };
    let stored = false;
    for (const r of await findByRequisition(db, requisition)) {
      if (!stored && r.facility === facilityCode && await held(r.serviceRequestId)) stored = true;
    }
    for (const id of ids) if (!stored && await held(id)) stored = true;
    if (stored) throw new ReceptionError('conflict', `Requisition ${requisition} from ${facilityCode} is already registered.`);

    const loinc = await catalog.loincCodingsFor(named);
    const clinician = text(input.clinician) ?? undefined;
    const requester = orderRequester(clinician, facilityReference({
      system: FACILITY_REGISTRY_SYSTEM, code: facilityCode, ...(facilityName ? { display: facilityName } : {}),
    }));
    const priority = text(input.priority);
    const note = text(input.note);
    const authoredOn = now().toISOString();
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
    const provenance = deskProvenance(ids.map((id) => `ServiceRequest/${id}`), 'CREATE', actor, authoredOn);
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
      const requester = isObject(next['requester']) ? next['requester'] : null;
      // The contained role the requester points at, followed the way requesterFacility does.
      const ref = requester ? text(requester['reference']) : null;
      const role = ref && ref.startsWith('#')
        ? (Array.isArray(next['contained']) ? next['contained'] : [])
          .find((c): c is Json => isObject(c) && c['resourceType'] === 'PractitionerRole' && c['id'] === ref.slice(1))
        : undefined;
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
        + 'A wrong requisition number, facility or test list is fixed by cancelling a desk order and registering it again, '
        + 'or by voiding a form order from its form entry.');
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
    // A returned order is corrected by its site, then marked corrected (lab slice 3, ruling 8).
    if (await returnedOf(facility, requisition)) {
      throw new ReceptionError('conflict', `Order ${requisition} was returned to its site. Mark it corrected instead.`);
    }
    const subject = changes.patientId !== undefined ? await subjectFor(String(changes.patientId)) : null;
    const requests: Json[] = [];
    let any = false;
    for (const id of group.ids) {
      const sr = (await fhirStore.get('ServiceRequest', id)) as Json | null;
      if (!sr) continue;
      any = true;
      // A voided or revoked request stays as it is.
      if (isLive(sr)) requests.push(sr);
    }
    if (!any) throw new ReceptionError('not-found', `No order ${requisition} was found.`);
    if (requests.length === 0) throw invalid(`Order ${requisition} was cancelled. There is nothing left to correct.`);
    const nexts: Array<{ resourceType: 'ServiceRequest' | 'Specimen'; next: Json }> = [];
    for (const sr of requests) {
      const next = corrected(sr, changes, subject);
      const checked = validateResource(next);
      if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
      nexts.push({ resourceType: 'ServiceRequest', next });
    }
    // A linked patient is the subject of the order's received samples too (ruling 24).
    if (subject) {
      for (const sp of await specimensOf(facility, requisition, requests)) {
        const stored = (await fhirStore.get('Specimen', sp.id)) as Json | null;
        if (!stored) continue;
        const next = { ...structuredClone(stored), subject: { ...subject } };
        const checked = validateResource(next);
        if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
        nexts.push({ resourceType: 'Specimen', next });
      }
    }
    await correctAll(nexts, actor, reason);
    const order = await findOne(requisition, facility);
    if (!order) throw new Error(`corrected requisition ${requisition} could not be read back`);
    return order;
  }

  /** One correction per record, each with its own Provenance and the same reason. Every body was
   *  checked before, so a refusal part way through is a store failure, not a bad edit. */
  async function correctAll(
    nexts: Array<{ resourceType: 'ServiceRequest' | 'Specimen'; next: Json }>, actor: string, reason: string,
  ): Promise<void> {
    for (const { resourceType, next } of nexts) {
      try {
        await fhirStore.correct({ resourceType, id: String(next['id']), next, who: actor, reason });
      } catch (err) {
        if (err instanceof CorrectionError) {
          throw new ReceptionError(err.reason === 'not-found' ? 'not-found' : 'invalid', err.message);
        }
        throw err;
      }
    }
  }

  async function cancelOrder(input: CancelOrderInput, who: string): Promise<ReceptionOrder> {
    const reason = text(input?.reason);
    if (!reason) throw invalid('A cancellation needs a reason.');
    const actor = text(who);
    if (!actor) throw invalid('A cancellation needs the name of who made it.');
    const requisition = text(input?.requisition);
    if (!requisition) throw invalid('A requisition number is required.');
    const facility = text(input?.facilityCode);

    const group = (await groups(requisition)).find((g) => g.facility === facility);
    const requests: Json[] = [];
    for (const id of group?.ids ?? []) {
      const sr = (await fhirStore.get('ServiceRequest', id)) as Json | null;
      if (sr) requests.push(sr);
    }
    if (requests.length === 0) {
      throw new ReceptionError('not-found', `No order ${requisition}${facility ? ` from ${facility}` : ''} was found.`);
    }
    if (!requests.some(isDeskOrder)) {
      throw invalid(`Order ${requisition} was not registered at the desk. A form order is voided from its form entry.`);
    }
    const live = requests.filter(isLive);
    if (live.length === 0) throw invalid(`Order ${requisition} is already cancelled.`);
    const nexts = live.map((sr) => ({ resourceType: 'ServiceRequest' as const, next: { ...structuredClone(sr), status: VOIDED } }));
    await correctAll(nexts, actor, reason);
    const order = await findOne(requisition, facility);
    if (!order) throw new Error(`cancelled requisition ${requisition} could not be read back`);
    return order;
  }

  /** A warehouse sex letter as a Patient gender: the gender whose first letter it is, as the
   *  warehouse projection writes it. */
  function genderOf(sex: string | null): string | null {
    const letter = sex?.trim().toUpperCase();
    return (letter && GENDERS.find((g) => g[0]!.toUpperCase() === letter)) ?? null;
  }

  async function foundPatients(ids: string[]): Promise<FoundPatient[]> {
    const rows = await deps.patientIndex.rowsByIds(ids.slice(0, SEARCH_LIMIT), { unmask: true });
    return rows.filter((r): r is typeof r & { id: string } => r.id !== null).map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      birthDate: r.birthDate,
      gender: genderOf(r.sex),
      identifiers: r.identifiers.filter((i): i is typeof i & { system: string } => i.system !== null)
        .map((i) => ({ system: i.system, value: i.value })),
    }));
  }

  /** The duplicate keys a full name could have with this birth date: each split of its words into a
   *  first name and a surname, in either order. The warehouse keeps the first given name only, so a
   *  first name of several words is also tried as its first word. The surname is always whole.
   *  One word gives none, so a partial name finds no one; more than six words give none too. */
  function matchKeys(name: string, birthDate: string): string[] {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length > NAME_SEARCH_MAX_WORDS) return [];
    const keys = new Set<string>();
    for (let i = 1; i < words.length; i++) {
      const front = words.slice(0, i);
      const back = words.slice(i);
      for (const [first, surname] of [[front, back], [back, front]] as const) {
        for (const given of new Set([first.join(' '), first[0]!])) {
          const key = patientMatchKey(surname.join(' '), given, birthDate);
          if (key) keys.add(key);
        }
      }
    }
    return [...keys];
  }

  async function searchPatients(q: PatientSearch): Promise<FoundPatient[]> {
    const identifier = text(q?.identifier);
    if (identifier) {
      // The patient index's own exact match: a searchable identifier or the patient guid, active
      // patients only. Its masked list is the exact-match-only one.
      const list = await deps.patientIndex.list(
        { q: identifier, status: 'active', limit: SEARCH_LIMIT, offset: 0 }, { unmask: false });
      return foundPatients(list.rows.map((r) => deps.patientIndex.idForRef(r.ref)).filter((id): id is string => !!id));
    }
    const name = text(q?.name);
    const birthDate = text(q?.birthDate);
    if (!name || !birthDate || !isCalendarDate(birthDate)) return [];
    const keys = matchKeys(name, birthDate);
    if (keys.length === 0) return [];
    // match_key is the duplicate-detection key (surname, first name, birth date; external migration
    // 026, indexed). The patient index has no name and birth date lookup to reuse.
    const rows = await deps.externalDb.selectFrom('patients').select('id')
      .where('match_key', 'in', keys).where('active', '=', true).where('replaced_by_id', 'is', null)
      .orderBy('id').limit(SEARCH_LIMIT).execute();
    return foundPatients(rows.map((r) => r.id));
  }

  async function registerPatient(input: RegisterPatientInput, who: string): Promise<{ id: string; display: string }> {
    const actor = text(who);
    if (!actor) throw invalid('A registration needs the name of who made it.');
    const given = text(input?.given);
    const family = text(input?.family);
    if (!given || !family) throw invalid('A patient needs a first name and a surname.');
    if (!GENDERS.includes(input.gender)) throw invalid(`Sex must be one of ${GENDERS.join(', ')}.`);
    // The lab's own date, so a baby born today is not refused just after the lab's midnight.
    const today = await labToday();
    let birthDate = text(input.birthDate);
    let estimated = false;
    // A birth date wins over an age when both are given.
    if (birthDate) {
      if (!isCalendarDate(birthDate)) throw invalid('A birth date must be a real date, YYYY-MM-DD.');
      if (birthDate > today) throw invalid('A birth date cannot be in the future.');
    } else if (input.ageYears !== undefined && input.ageYears !== null) {
      const age = input.ageYears;
      if (!Number.isInteger(age) || age < 0 || age > MAX_AGE_YEARS) throw invalid(`An age must be a whole number of years from 0 to ${MAX_AGE_YEARS}.`);
      birthDate = `${Number(today.slice(0, 4)) - age}-01-01`;
      estimated = true;
    } else {
      throw invalid('A patient needs a birth date or an age.');
    }
    let identifier: { system: string; value: string } | null = null;
    if (input.identifier !== undefined) {
      const system = text(input.identifier?.system);
      const value = text(input.identifier?.value);
      if (!system || !value) throw invalid('An identifier needs a system and a value.');
      identifier = { system, value };
    }

    const id = randomUUID();
    const recorded = now().toISOString();
    const patient: Json = {
      resourceType: 'Patient',
      id,
      ...(estimated ? { extension: [{ url: BIRTHDATE_ESTIMATED_EXTENSION, valueBoolean: true }] } : {}),
      ...(identifier ? { identifier: [identifier] } : {}),
      name: [{ given: [given], family }],
      gender: input.gender,
      birthDate,
    };
    const checked = validateResource(patient);
    if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
    const provenance = deskProvenance([`Patient/${id}`], 'CREATE', actor, recorded);
    await persistResources({ fhirStore, logger: deps.logger }, [patient, provenance], { sourceSystem: LAB_DESK_ORIGIN });
    return { id, display: `${given} ${family}` };
  }

  async function orderFor(requisition: string, facilityCode: string | null): Promise<ReceptionOrder> {
    const key = text(requisition);
    if (!key) throw invalid('A requisition number is required.');
    const facility = text(facilityCode);
    const order = await findOne(key, facility);
    if (!order) throw new ReceptionError('not-found', `No order ${key}${facility ? ` from ${facility}` : ''} was found.`);
    return order;
  }

  async function sampleChoices(requisition: string, facilityCode: string | null): Promise<SampleChoices> {
    return choicesOf(liveTests(await orderFor(requisition, facilityCode)));
  }

  /** The tests of an order a sample may still be received for: not voided, not revoked. */
  function liveTests(order: ReceptionOrder): ReceptionOrder['tests'] {
    return order.tests.filter((t) => !NOT_LIVE.has(t.status));
  }

  /** The sample types these tests take, each with the terminology's display. */
  async function choicesOf(tests: ReceptionOrder['tests']): Promise<SampleChoices> {
    const types: SampleChoices['types'] = [];
    for (const t of await orderSpecimenTypes(catalog, tests)) {
      const found = await deps.ops.lookup(t.system, t.code);
      types.push({ system: t.system, code: t.code, display: found.found ? text(found.display) : null });
    }
    return { types };
  }

  /** The condition as the value set holds it, or a refusal when the set does not hold it. */
  async function conditionCoding(c: NonNullable<ReceiveSampleInput['condition']>): Promise<{ system: string; code: string; display?: string }> {
    const system = text(c?.system);
    const code = text(c?.code);
    if (!system || !code) throw invalid('A sample condition needs a system and a code.');
    const vs = await deps.ops.expand(SAMPLE_CONDITION_VALUE_SET, { filter: code, count: 1000 });
    const hit = (vs.expansion?.contains ?? []).find((e) => e.system === system && e.code === code);
    if (!hit) throw invalid(`Condition ${code} is not a sample condition this lab records.`);
    const display = text(c.display) ?? text(hit.display);
    return { system, code, ...(display ? { display } : {}) };
  }

  async function receiveSample(input: ReceiveSampleInput, who: string): Promise<ReceptionOrder> {
    const actor = text(who);
    if (!actor) throw invalid('A receipt needs the name of who received the sample.');
    const order = await orderFor(input?.requisition ?? '', input?.facilityCode ?? null);
    const facility = order.facility?.code ?? null;

    // Every check that reads, before any write. A voided or revoked request takes no sample.
    const tests = liveTests(order);
    if (tests.length === 0) throw invalid(`Order ${order.requisition} was cancelled. No sample can be received for it.`);
    const typeSystem = text(input.type?.system);
    const typeCode = text(input.type?.code);
    // A rejected sample stays rejected: a new sample comes in on a redraw order. This runs before the
    // type check, since the rejection revoked the tests that took the type.
    if (typeSystem && typeCode) {
      const stored = (await fhirStore.get('Specimen', labSpecimenId(facility, order.requisition, { system: typeSystem, code: typeCode }))) as Json | null;
      if (stored && stored['status'] === 'unsatisfactory') {
        const named = text(input.type?.display) ?? typeCode;
        throw new ReceptionError('conflict', `This ${named} sample was rejected. Register a redraw order for the new sample.`);
      }
    }
    const choices = await choicesOf(tests);
    const choice = choices.types.find((t) => t.system === typeSystem && t.code === typeCode);
    if (!choice) throw invalid(`Sample type ${typeCode ?? ''} is not one this order's tests take.`);
    const condition = input.condition !== undefined ? await conditionCoding(input.condition) : null;
    const allRequests = new Set(order.tests.map((t) => t.serviceRequestId));
    const liveRequests = [...new Set(tests.map((t) => t.serviceRequestId))];
    // By default the sample serves only the live requests whose tests take its type, by the same
    // catalog read choicesOf uses. A test with no catalog sample type offers no type, so it is not linked.
    let requests: string[] = [];
    for (const r of liveRequests) {
      const types = await orderSpecimenTypes(catalog, tests.filter((t) => t.serviceRequestId === r));
      if (types.some((t) => t.system === choice.system && t.code === choice.code)) requests.push(r);
    }
    if (input.serviceRequestIds !== undefined) {
      const chosen = [...new Set((input.serviceRequestIds ?? []).map((i) => String(i).trim()))];
      const stranger = chosen.find((i) => !allRequests.has(i));
      const dead = chosen.find((i) => allRequests.has(i) && !liveRequests.includes(i));
      if (chosen.length === 0 || stranger !== undefined) {
        throw invalid(stranger !== undefined ? `Request ${stranger} is not on this order.` : 'A sample serves at least one test.');
      }
      if (dead !== undefined) throw invalid(`Request ${dead} was cancelled. No sample can be received for it.`);
      requests = chosen;
    }

    const id = labSpecimenId(facility, order.requisition, choice);
    const existing = (await fhirStore.get('Specimen', id)) as Json | null;
    const display = text(input.type.display) ?? choice.display;
    const recorded = now().toISOString();
    const specimen: Json = {
      ...(existing ? structuredClone(existing) : {}),
      resourceType: 'Specimen',
      id,
      status: 'available',
      type: { coding: [{ system: choice.system, code: choice.code, ...(display ? { display } : {}) }] },
      // A second receipt keeps the time stored unless it gives one (ruling 16).
      receivedTime: text(input.receivedTime) ?? (existing ? text(existing['receivedTime']) : null) ?? recorded,
      request: requests.map((r) => ({ reference: `ServiceRequest/${r}` })),
    };
    if (condition) specimen['condition'] = [{ coding: [condition] }];
    if (order.patient) specimen['subject'] = { reference: `Patient/${order.patient.id}`, display: order.patient.display };
    else delete specimen['subject'];
    const checked = validateResource(specimen);
    if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));

    // The store numbers versions from the history (fhir-store.ts writeMany), so the next one is
    // its highest plus one. A receipt of the same sample at the same moment could take that number
    // first; the Provenance would then name the version before this one.
    const last = await db.selectFrom('fhir.resource_history')
      .select(sql<number | string | null>`max(version)`.as('v'))
      .where('resource_type', '=', 'Specimen').where('id', '=', id)
      .executeTakeFirst();
    const version = Number(last?.v ?? 0) + 1;
    const provenance = deskProvenance([`Specimen/${id}/_history/${version}`], existing ? 'UPDATE' : 'CREATE', actor, recorded);
    await persistResources({ fhirStore, logger: deps.logger }, [specimen, provenance], { sourceSystem: LAB_DESK_ORIGIN });
    const after = await findOne(order.requisition, facility);
    if (!after) throw new Error(`received a sample for requisition ${order.requisition} but could not read the order back`);
    return after;
  }

  const reception: LabReception = {
    findOrders, registerOrder, correctOrder, cancelOrder, searchPatients, registerPatient, receiveSample, sampleChoices,
  };
  return {
    reception,
    helpers: { findOne, orderFor, correctAll, liveTests, specimensOf, subjectFor, corrected, returnedOf },
  };
}
