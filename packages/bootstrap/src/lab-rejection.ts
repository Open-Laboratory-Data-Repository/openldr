import { sql } from 'kysely';
import { FACILITY_REGISTRY_SYSTEM, persistResources, requisitionRowOf } from '@openldr/db';
import { validateResource } from '@openldr/fhir';
import {
  LAB_TASK_SYSTEM, ORDER_REJECTION_EXTENSION, facilityReference, labRejectionObservationId, labSpecimenId,
  type LabTaskKind,
} from '@openldr/forms';
import {
  CHANGE_KEYS, LAB_DESK_ORIGIN, SAMPLE_CONDITION_VALUE_SET, ReceptionError, createReceptionCore, deskProvenance,
  invalid, isObject, isLive, orderSpecimenTypes, redrawTaskId, returnTaskId, statusOf, text,
  type LabReceptionDeps, type OrderChanges, type ReceptionOrder,
} from './lab-reception';

// Lab module slice 3: return a request to its site and take it back corrected, reject a sample or
// one test and ask for a redraw, and link the redraw to the order it replaces. Status changes go
// through fhirStore.correct (a Provenance with the reason each); new Tasks, Specimens and
// Observations are saved with a desk Provenance. Every check that reads runs before any write.

/** Why the lab returns an order. Must equal ORDER_RETURN_VALUE_SET in internal migration 137. */
export const ORDER_RETURN_VALUE_SET = 'urn:openldr:valueset:order-return-reason';
/** Why a sample, and so its whole order, is rejected. Must equal 106's ORDER_REJECT_VALUE_SET. */
export const ORDER_REJECT_VALUE_SET = 'urn:openldr:valueset:order-reject-reason';
/** Why one test is rejected. Must equal 106's TEST_REJECT_VALUE_SET. */
export const TEST_REJECT_VALUE_SET = 'urn:openldr:valueset:test-reject-reason';
/** The requester a Task names when the Laboratory settings hold no lab name (ruling 11). */
const DEFAULT_LAB_NAME = 'Laboratory';
const REVOKED = 'revoked';
const ON_HOLD = 'on-hold';

type Json = Record<string, unknown>;
type Coding = { system: string; code: string; display?: string };

export interface ReturnOrderInput { requisition: string; facilityCode: string | null; reasonCode: string; note?: string }
export interface MarkCorrectedInput { requisition: string; facilityCode: string | null; changes: OrderChanges; reason: string }
export interface RejectSampleInput {
  requisition: string; facilityCode: string | null; specimenTypeCode: string; conditionCode: string; reasonCode: string; redraw: boolean;
}
export interface RejectTestInput { serviceRequestId: string; reasonCode: string; redraw: boolean }
export interface LinkRedrawInput { requisition: string; facilityCode: string | null; replacesRequisition: string }

export interface LabRejection {
  /** Puts every live request on hold and asks the site to correct it (ruling 2). Never a desk order. */
  returnOrder(input: ReturnOrderInput, who: string): Promise<ReceptionOrder>;
  /** Applies the site's corrections, sets the requests active and completes the return Task (ruling 1). */
  markCorrected(input: MarkCorrectedInput, who: string): Promise<ReceptionOrder>;
  /** The Specimen becomes unsatisfactory and every request it serves is revoked (ruling 5). */
  rejectSample(input: RejectSampleInput, who: string): Promise<ReceptionOrder>;
  /** A cancelled Observation for the test and its request revoked (ruling 6). */
  rejectTest(input: RejectTestInput, who: string): Promise<ReceptionOrder>;
  /** Sets replaces on each matching test of the redraw and completes the redraw Tasks (ruling 4). */
  linkRedraw(input: LinkRedrawInput, who: string): Promise<ReceptionOrder>;
}

export interface LabRejectionDeps extends LabReceptionDeps {
  /** The lab's name from the Laboratory settings (lab.name). Unset, and a Task names "Laboratory". */
  labName?: () => Promise<string | null | undefined>;
}

export function createLabRejection(deps: LabRejectionDeps): LabRejection {
  const { db, fhirStore, catalog } = deps;
  const now = deps.now ?? (() => new Date());
  const { findOne, orderFor, correctAll, liveTests, specimensOf, subjectFor, corrected, returnedOf } = createReceptionCore(deps).helpers;

  function actorOf(who: string, what: string): string {
    const actor = text(who);
    if (!actor) throw invalid(`${what} needs the name of who made it.`);
    return actor;
  }

  /** The code as the value set holds it, checked by $expand (validateCode answers false for catalog sets). */
  async function codingIn(valueSet: string, code: unknown, what: string): Promise<Coding> {
    const c = text(code);
    if (!c) throw invalid(`${what} is required.`);
    const vs = await deps.ops.expand(valueSet, { filter: c, count: 1000 });
    const hit = (vs.expansion?.contains ?? []).find((e) => e.code === c && typeof e.system === 'string');
    if (!hit) throw invalid(`${c} is not a ${what.toLowerCase()} this lab records.`);
    const display = text(hit.display);
    return { system: hit.system as string, code: c, ...(display ? { display } : {}) };
  }

  async function labName(): Promise<string> {
    try { return text(await deps.labName?.()) ?? DEFAULT_LAB_NAME; } catch { return DEFAULT_LAB_NAME; }
  }

  function ownerOf(order: ReceptionOrder): Json | undefined {
    if (!order.facility) return undefined;
    return facilityReference({
      system: FACILITY_REGISTRY_SYSTEM, code: order.facility.code, ...(order.facility.display ? { display: order.facility.display } : {}),
    }) as Json;
  }

  async function getJson(type: string, id: string): Promise<Json | null> {
    return (await fhirStore.get(type, id)) as Json | null;
  }

  async function readBack(requisition: string, facility: string | null): Promise<ReceptionOrder> {
    const order = await findOne(requisition, facility);
    if (!order) throw new Error(`requisition ${requisition} could not be read back`);
    return order;
  }

  /** A new Task body, built fresh, for a return or a redraw (rulings 2, 7 and 11). */
  async function newTask(
    kind: LabTaskKind, id: string, order: ReceptionOrder, focus: string, basedOn: string[], reason: Coding, note?: string | null,
  ): Promise<Json> {
    const at = now().toISOString();
    const owner = ownerOf(order);
    return {
      resourceType: 'Task',
      id,
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: LAB_TASK_SYSTEM, code: kind }] },
      focus: { reference: focus },
      basedOn: basedOn.map((reference) => ({ reference })),
      ...(order.patient ? { for: { reference: `Patient/${order.patient.id}`, display: order.patient.display } } : {}),
      ...(owner ? { owner } : {}),
      requester: { display: await labName() },
      statusReason: { coding: [reason] },
      authoredOn: at,
      lastModified: at,
      ...(note ? { note: [{ text: note }] } : {}),
    };
  }

  /** Saves a Task with its own Provenance, linked from relevantHistory so the order panel can name who
   *  wrote it with a read by id. Task is not a type fhirStore.correct takes, so it is saved whole. */
  async function writeTask(task: Json, actor: string, reason: string): Promise<void> {
    const id = String(task['id']);
    const existing = await getJson('Task', id);
    // The store numbers versions from the history, as receiveSample reads it.
    const last = await db.selectFrom('fhir.resource_history')
      .select(sql<number | string | null>`max(version)`.as('v'))
      .where('resource_type', '=', 'Task').where('id', '=', id)
      .executeTakeFirst();
    const version = Number(last?.v ?? 0) + 1;
    const recorded = now().toISOString();
    const provenance = deskProvenance([`Task/${id}/_history/${version}`], existing ? 'UPDATE' : 'CREATE', actor, recorded, reason);
    const history = existing && Array.isArray(existing['relevantHistory']) ? existing['relevantHistory'] : [];
    const body = { ...task, lastModified: recorded, relevantHistory: [...history, { reference: `Provenance/${String(provenance['id'])}` }] };
    delete (body as Json)['meta'];
    const checked = validateResource(body);
    if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
    await persistResources({ fhirStore, logger: deps.logger }, [body, provenance], { sourceSystem: LAB_DESK_ORIGIN });
  }

  /** The request revoked with the rejection extension the warehouse reads into rejection_code. */
  function revoked(sr: Json, reason: Coding): Json {
    const others = (Array.isArray(sr['extension']) ? sr['extension'] : [])
      .filter((e) => !(isObject(e) && e['url'] === ORDER_REJECTION_EXTENSION));
    return {
      ...structuredClone(sr),
      status: REVOKED,
      extension: [...others, {
        url: ORDER_REJECTION_EXTENSION,
        extension: [{ url: 'code', valueCode: reason.code }, { url: 'reason', valueString: reason.display ?? reason.code }],
      }],
    };
  }

  function checkedOrThrow(r: Json): void {
    const checked = validateResource(r);
    if (!checked.ok) throw invalid(checked.outcome.issue.map((i) => i.diagnostics ?? i.code).join('; '));
  }

  /** The live requests of an order, read from the store, one per id. */
  async function liveRequests(order: ReceptionOrder): Promise<Json[]> {
    const out: Json[] = [];
    for (const id of [...new Set(liveTests(order).map((t) => t.serviceRequestId))]) {
      const sr = await getJson('ServiceRequest', id);
      if (sr && isLive(sr)) out.push(sr);
    }
    return out;
  }

  async function returnOrder(input: ReturnOrderInput, who: string): Promise<ReceptionOrder> {
    const actor = actorOf(who, 'A return');
    const order = await orderFor(input?.requisition ?? '', input?.facilityCode ?? null);
    const facility = order.facility?.code ?? null;
    if (order.origin === 'lab-desk') {
      throw new ReceptionError('conflict', `Order ${order.requisition} was registered at the desk. A desk order is corrected here, not returned.`);
    }
    if (await returnedOf(facility, order.requisition) || liveTests(order).some((t) => t.status === ON_HOLD)) {
      throw new ReceptionError('conflict', `Order ${order.requisition} is already on hold.`);
    }
    if (!facility) throw invalid(`Order ${order.requisition} names no requesting facility to return it to.`);
    const reason = await codingIn(ORDER_RETURN_VALUE_SET, input.reasonCode, 'Return reason');
    const requests = await liveRequests(order);
    if (requests.length === 0) throw invalid(`Order ${order.requisition} was cancelled. There is nothing to return.`);
    const nexts = requests.map((sr) => ({ resourceType: 'ServiceRequest' as const, next: { ...structuredClone(sr), status: ON_HOLD } }));
    const refs = requests.map((sr) => `ServiceRequest/${String(sr['id'])}`);
    const task = await newTask('correct-request', returnTaskId(facility, order.requisition), order, refs[0]!, refs, reason, text(input.note));
    checkedOrThrow(task);

    const why = reason.display ?? reason.code;
    await correctAll(nexts, actor, why);
    await writeTask(task, actor, why);
    return readBack(order.requisition, facility);
  }

  async function markCorrected(input: MarkCorrectedInput, who: string): Promise<ReceptionOrder> {
    const actor = actorOf(who, 'A correction');
    const reason = text(input?.reason);
    if (!reason) throw invalid('Marking an order corrected needs a reason.');
    const changes: OrderChanges = isObject(input?.changes) ? input.changes as OrderChanges : {};
    const extra = Object.keys(changes).filter((k) => !CHANGE_KEYS.has(k));
    if (extra.length > 0) throw invalid(`A correction may change the priority, clinician, note and patient only, not ${extra.join(', ')}.`);
    const order = await orderFor(input?.requisition ?? '', input?.facilityCode ?? null);
    const facility = order.facility?.code ?? null;
    if (!(await returnedOf(facility, order.requisition))) {
      throw new ReceptionError('conflict', `Order ${order.requisition} was not returned to its site.`);
    }
    const taskId = returnTaskId(facility, order.requisition);
    const task = await getJson('Task', taskId);
    if (!task) throw new Error(`return Task ${taskId} could not be read`);
    const subject = changes.patientId !== undefined ? await subjectFor(String(changes.patientId)) : null;
    const requests = await liveRequests(order);
    const nexts: Array<{ resourceType: 'ServiceRequest' | 'Specimen'; next: Json }> = [];
    for (const sr of requests) {
      const next = corrected(sr, changes, subject);
      if (statusOf(next) === ON_HOLD) next['status'] = 'active';
      checkedOrThrow(next);
      nexts.push({ resourceType: 'ServiceRequest', next });
    }
    // A linked patient is the subject of the order's received samples too, as correctOrder does.
    if (subject) {
      for (const sp of await specimensOf(facility, order.requisition, requests)) {
        const stored = await getJson('Specimen', sp.id);
        if (!stored) continue;
        const next = { ...structuredClone(stored), subject: { ...subject } };
        checkedOrThrow(next);
        nexts.push({ resourceType: 'Specimen', next });
      }
    }
    await correctAll(nexts, actor, reason);
    await writeTask({ ...structuredClone(task), status: 'completed' }, actor, reason);
    return readBack(order.requisition, facility);
  }

  /** The open return Task set to cancelled, for a returned order whose sample was rejected (ruling 8). */
  async function cancelledReturn(order: ReceptionOrder): Promise<Json | null> {
    const facility = order.facility?.code ?? null;
    if (!(await returnedOf(facility, order.requisition))) return null;
    const task = await getJson('Task', returnTaskId(facility, order.requisition));
    return task ? { ...structuredClone(task), status: 'cancelled' } : null;
  }

  async function rejectSample(input: RejectSampleInput, who: string): Promise<ReceptionOrder> {
    const actor = actorOf(who, 'A rejection');
    const order = await orderFor(input?.requisition ?? '', input?.facilityCode ?? null);
    const facility = order.facility?.code ?? null;
    const typeCode = text(input.specimenTypeCode);
    const type = (await orderSpecimenTypes(catalog, order.tests)).find((t) => t.code === typeCode);
    if (!type) throw invalid(`Sample type ${typeCode ?? ''} is not one this order's tests take.`);
    const condition = await codingIn(SAMPLE_CONDITION_VALUE_SET, input.conditionCode, 'Sample condition');
    const reason = await codingIn(ORDER_REJECT_VALUE_SET, input.reasonCode, 'Rejection reason');
    const why = reason.display ?? reason.code;

    // The requests the sample serves: those a receipt named, else every request whose tests take this type.
    const specimenId = labSpecimenId(facility, order.requisition, type);
    const existing = await getJson('Specimen', specimenId);
    const onOrder = [...new Set(order.tests.map((t) => t.serviceRequestId))];
    const named = (existing && Array.isArray(existing['request']) ? existing['request'] : [])
      .map((r) => (isObject(r) ? text(r['reference']) : null))
      .filter((r): r is string => !!r && r.startsWith('ServiceRequest/'))
      .map((r) => r.slice('ServiceRequest/'.length))
      .filter((id) => onOrder.includes(id));
    let served = named;
    if (served.length === 0) {
      served = [];
      for (const id of onOrder) {
        const types = await orderSpecimenTypes(catalog, order.tests.filter((t) => t.serviceRequestId === id));
        if (types.some((t) => t.system === type.system && t.code === type.code)) served.push(id);
      }
    }
    const requests: Json[] = [];
    for (const id of served) {
      const sr = await getJson('ServiceRequest', id);
      if (sr && statusOf(sr) !== 'entered-in-error') requests.push(sr);
    }
    if (requests.length === 0) throw invalid(`Order ${order.requisition} was cancelled. There is nothing to reject.`);
    // A request already revoked is left alone.
    const targets = requests.filter(isLive);
    const nexts: Array<{ resourceType: 'ServiceRequest' | 'Specimen'; next: Json }> = targets.map((sr) => {
      const next = revoked(sr, reason);
      checkedOrThrow(next);
      return { resourceType: 'ServiceRequest' as const, next };
    });

    const conditionOf = (sp: Json | null) => {
      const c = sp && Array.isArray(sp['condition']) && isObject(sp['condition'][0]) ? sp['condition'][0] : null;
      const coding = c && Array.isArray(c['coding']) && isObject(c['coding'][0]) ? c['coding'][0] : null;
      return coding ? `${String(coding['system'])}|${String(coding['code'])}` : null;
    };
    const specimenDone = existing !== null && existing['status'] === 'unsatisfactory'
      && conditionOf(existing) === `${condition.system}|${condition.code}`;
    let specimen: Json | null = null;
    if (!specimenDone) {
      let display: string | null = null;
      if (!existing) {
        const found = await deps.ops.lookup(type.system, type.code);
        display = found.found ? text(found.display) : null;
      }
      specimen = {
        ...(existing ? structuredClone(existing) : {}),
        resourceType: 'Specimen',
        id: specimenId,
        status: 'unsatisfactory',
        ...(existing ? {} : { type: { coding: [{ system: type.system, code: type.code, ...(display ? { display } : {}) }] } }),
        condition: [{ coding: [condition] }],
        // A sample never received is in hand now (ruling 5).
        receivedTime: (existing ? text(existing['receivedTime']) : null) ?? now().toISOString(),
        request: requests.map((sr) => ({ reference: `ServiceRequest/${String(sr['id'])}` })),
        ...(order.patient ? { subject: { reference: `Patient/${order.patient.id}`, display: order.patient.display } } : {}),
      };
      delete specimen['meta'];
      checkedOrThrow(specimen);
      if (existing) nexts.push({ resourceType: 'Specimen', next: specimen });
    }

    const returnTask = await cancelledReturn(order);
    const redrawId = redrawTaskId(specimenId);
    const redrawStored = await getJson('Task', redrawId);
    const redrawDone = redrawStored !== null && ['requested', 'completed'].includes(String(redrawStored['status']));
    const refs = requests.map((sr) => `ServiceRequest/${String(sr['id'])}`);
    const redraw = input.redraw && !redrawDone
      ? await newTask('recollect-sample', redrawId, order, `Specimen/${specimenId}`, refs, reason)
      : null;
    if (redraw) checkedOrThrow(redraw);

    await correctAll(nexts, actor, why);
    if (specimen && !existing) {
      const recorded = now().toISOString();
      await persistResources({ fhirStore, logger: deps.logger },
        [specimen, deskProvenance([`Specimen/${specimenId}`], 'CREATE', actor, recorded, why)], { sourceSystem: LAB_DESK_ORIGIN });
    }
    if (returnTask) await writeTask(returnTask, actor, why);
    if (redraw) await writeTask(redraw, actor, why);
    return readBack(order.requisition, facility);
  }

  async function rejectTest(input: RejectTestInput, who: string): Promise<ReceptionOrder> {
    const actor = actorOf(who, 'A rejection');
    const id = text(input?.serviceRequestId);
    const sr = id ? await getJson('ServiceRequest', id) : null;
    if (!id || !sr) throw new ReceptionError('not-found', `Request ${input?.serviceRequestId ?? ''} was not found.`);
    if (statusOf(sr) === 'entered-in-error') throw invalid(`Request ${id} was cancelled. There is nothing to reject.`);
    const row = requisitionRowOf(sr);
    if (!row) throw invalid(`Request ${id} has no requisition number.`);
    const order = await orderFor(row.requisition, row.facility);
    const test = order.tests.find((t) => t.serviceRequestId === id);
    if (!test) throw new ReceptionError('not-found', `Request ${id} is not on order ${row.requisition}.`);
    const reason = await codingIn(TEST_REJECT_VALUE_SET, input.reasonCode, 'Rejection reason');
    const why = reason.display ?? reason.code;

    const nexts = isLive(sr) ? [{ resourceType: 'ServiceRequest' as const, next: revoked(sr, reason) }] : [];
    for (const n of nexts) checkedOrThrow(n.next);
    const obsId = labRejectionObservationId(id);
    const observation: Json | null = (await fhirStore.exists('Observation', obsId)) ? null : {
      resourceType: 'Observation',
      id: obsId,
      status: 'cancelled',
      code: { coding: [{ system: test.system, code: test.code, ...(test.display ? { display: test.display } : {}) }] },
      subject: isObject(sr['subject']) ? structuredClone(sr['subject']) : { display: 'Unknown subject' },
      basedOn: [{ reference: `ServiceRequest/${id}` }],
      dataAbsentReason: { coding: [reason] },
    };
    if (observation) checkedOrThrow(observation);
    const redrawId = redrawTaskId(id);
    const redrawStored = await getJson('Task', redrawId);
    const redrawDone = redrawStored !== null && ['requested', 'completed'].includes(String(redrawStored['status']));
    const redraw = input.redraw && !redrawDone
      ? await newTask('recollect-sample', redrawId, order, `ServiceRequest/${id}`, [`ServiceRequest/${id}`], reason)
      : null;
    if (redraw) checkedOrThrow(redraw);

    await correctAll(nexts, actor, why);
    if (observation) {
      await persistResources({ fhirStore, logger: deps.logger },
        [observation, deskProvenance([`Observation/${obsId}`], 'CREATE', actor, now().toISOString(), why)], { sourceSystem: LAB_DESK_ORIGIN });
    }
    if (redraw) await writeTask(redraw, actor, why);
    return readBack(order.requisition, order.facility?.code ?? null);
  }

  async function linkRedraw(input: LinkRedrawInput, who: string): Promise<ReceptionOrder> {
    const actor = actorOf(who, 'A redraw link');
    const order = await orderFor(input?.requisition ?? '', input?.facilityCode ?? null);
    const facility = order.facility?.code ?? null;
    const oldNumber = text(input?.replacesRequisition);
    if (!oldNumber) throw invalid('Say which rejected order this one replaces.');
    if (oldNumber === order.requisition) throw invalid('A redraw needs a new requisition number. It cannot replace itself.');
    const old = await findOne(oldNumber, facility);
    // Both orders must be at the same facility (ruling 4), so one found only elsewhere is refused too.
    if (!old) {
      throw invalid(`No order ${oldNumber} from ${facility ?? 'this facility'} was found. A redraw replaces an order from the same facility.`);
    }
    const rejected = new Map(old.tests.filter((t) => t.status === REVOKED).map((t) => [`${t.system}|${t.code}`, t.serviceRequestId]));
    const matches: Array<{ newId: string; oldId: string }> = [];
    for (const t of liveTests(order)) {
      const oldId = rejected.get(`${t.system}|${t.code}`);
      if (oldId && !matches.some((m) => m.newId === t.serviceRequestId)) matches.push({ newId: t.serviceRequestId, oldId });
    }
    if (matches.length === 0) throw invalid(`Order ${order.requisition} has no test that order ${oldNumber} rejected.`);

    const why = `Redraw of ${oldNumber}`;
    const nexts: Array<{ resourceType: 'ServiceRequest'; next: Json }> = [];
    for (const m of matches) {
      const sr = await getJson('ServiceRequest', m.newId);
      if (!sr) continue;
      const ref = `ServiceRequest/${m.oldId}`;
      const replaces = (Array.isArray(sr['replaces']) ? sr['replaces'] : []).filter(isObject);
      if (replaces.some((r) => r['reference'] === ref)) continue;
      const next = { ...structuredClone(sr), replaces: [...replaces, { reference: ref }] };
      checkedOrThrow(next);
      nexts.push({ resourceType: 'ServiceRequest', next });
    }
    // The old order's open redraw Tasks that name a replaced request.
    const replaced = new Set(matches.map((m) => `ServiceRequest/${m.oldId}`));
    const tasks: Json[] = [];
    for (const r of old.redraws.filter((d) => d.status === 'requested')) {
      const task = await getJson('Task', r.taskId);
      const basedOn = task && Array.isArray(task['basedOn']) ? task['basedOn'].filter(isObject) : [];
      if (!task || !basedOn.some((b) => replaced.has(String(b['reference'])))) continue;
      tasks.push({
        ...structuredClone(task),
        status: 'completed',
        output: [{ type: { text: 'Redraw order' }, valueReference: { reference: `ServiceRequest/${matches[0]!.newId}`, display: order.requisition } }],
      });
    }

    await correctAll(nexts, actor, why);
    for (const t of tasks) await writeTask(t, actor, why);
    return readBack(order.requisition, facility);
  }

  return { returnOrder, markCorrected, rejectSample, rejectTest, linkRedraw };
}
