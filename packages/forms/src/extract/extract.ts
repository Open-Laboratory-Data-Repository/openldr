import type {
  Coding,
  FhirResource,
  Observation,
  PractitionerRole,
  Quantity,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
  Reference,
  ServiceRequest,
  Specimen,
} from 'fhir/r4'
import type { FieldDiscriminator, FormField, FormSchema } from '../schema/form-schema'
import { fromAnswer } from '../answer-value'
import { discriminatorEquals, extrasDiscriminator } from '../discriminator'
import { parseTestDetails } from '../test-details'
import { ORDER_REJECTION_EXTENSION, isOrderRejectionBinding } from '../order-rejection-path'
import { orderRejectionOf } from './order-rejection'
import { isRequesterFacilityBinding, isRequisitionNumberBinding, pickedFacilityOf, type PickedFacility } from './order-fields'
import { readTestDetails } from './test-results'
import { EXT_CORLIX_FHIR_PATH, EXT_CORLIX_FIELD_EXTRAS, EXT_QUESTIONNAIRE_UNIT, EXT_SDC_OBSERVATION_EXTRACT } from '../extensions'

/** Context the extractors need but the form can't supply (e.g. the encounter's subject). */
export interface ExtractionContext {
  subject?: Reference
  authored?: string
  /**
   * For an order's test answer coded `system|code`, a coding to write in front of the answer's own.
   * The forms route fills it from the test catalog's LOINC links (test catalog S4), so an order still
   * leads with LOINC and the warehouse, which keeps the first coding, keeps matching. Other callers
   * leave it out.
   */
  codingBefore?: ReadonlyMap<string, Coding>
  /**
   * For a result coded `testKey#paramSystem|paramCode`, the reference band that applied when it was
   * typed. A QuestionnaireResponse answer has nowhere to carry it, so the forms route supplies it
   * (bench result entry). A replayed response carries none, and the Observation then has no
   * referenceRange.
   */
  testBands?: ReadonlyMap<string, { name?: string | null; low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null }>
  /**
   * The fixed id of the order for one test (lab slices 1b and 2, ruling 1). The forms route builds it
   * from the facility and the requisition number (`order-ids.ts`). With it, each test's
   * ServiceRequest gets that id and each test's results point at it. Other callers leave it out:
   * their requests get minted ids, and their results point at every order (`linkToOrder`).
   */
  orderIdFor?: (test: { system: string; code: string }) => string
}

/** Pluggable extraction of discrete FHIR resources from a filled form (PRD §3.2). */
export interface ResourceExtractor {
  canExtract(model: FormSchema): boolean
  extract(
    response: QuestionnaireResponse,
    questionnaire: Questionnaire,
    ctx: ExtractionContext,
  ): FhirResource[]
}

// ─── Questionnaire indexing ──────────────────────────────────────────────────

interface ItemMeta {
  observationExtract: boolean
  code?: Coding[]
  unit?: string
  fhirPath?: string
  answerOptions?: Array<{ code?: string; display?: string }>
  /** The field's discriminator, carried in the field-extras extension. */
  discriminator?: FieldDiscriminator
}

function indexItems(questionnaire: Questionnaire): Map<string, ItemMeta> {
  const map = new Map<string, ItemMeta>()
  const walk = (items: QuestionnaireItem[] | undefined): void => {
    for (const item of items ?? []) {
      map.set(item.linkId, {
        observationExtract:
          item.extension?.some((e) => e.url === EXT_SDC_OBSERVATION_EXTRACT && e.valueBoolean === true) === true,
        code: item.code,
        unit: item.extension?.find((e) => e.url === EXT_QUESTIONNAIRE_UNIT)?.valueCoding?.code,
        fhirPath: item.extension?.find((e) => e.url === EXT_CORLIX_FHIR_PATH)?.valueString,
        answerOptions: item.answerOption?.map((o) => ({ code: o.valueCoding?.code, display: o.valueCoding?.display })),
        discriminator: extrasDiscriminator(item),
      })
      walk(item.item)
    }
  }
  walk(questionnaire.item)
  return map
}

function hasObservationCode(meta: { observationExtract?: boolean; code?: Coding[] }): boolean {
  return meta.observationExtract === true && Boolean(meta.code?.length)
}

function isEnabledField(field: FormField, fields: FormField[]): boolean {
  const visited = new Set<string>()
  let current: FormField | undefined = field
  while (current) {
    if (current.enabled === false || visited.has(current.id)) return false
    visited.add(current.id)
    if (!current.groupId) return true
    current = fields.find((candidate) => candidate.id === current!.groupId)
  }
  return false
}

const LOINC = 'http://loinc.org'

function walkResponse(items: QuestionnaireResponseItem[] | undefined, visit: (item: QuestionnaireResponseItem) => void): void {
  for (const item of items ?? []) {
    visit(item)
    walkResponse(item.item, visit)
  }
}

/**
 * Every answered referring-facility item of a response, in the order the order extractor reads
 * them, with the answer as it decodes it. The extractor keeps the last one as the order's facility.
 * It reads with the same index and walk as `ServiceRequestExtractor`, so the two cannot disagree on
 * which items count.
 */
export function requesterFacilityAnswers(
  response: QuestionnaireResponse,
  questionnaire: Questionnaire,
): { linkId: string; value: unknown }[] {
  const index = indexItems(questionnaire)
  const out: { linkId: string; value: unknown }[] = []
  walkResponse(response.item, (item) => {
    const meta = index.get(item.linkId)
    const path = meta?.fhirPath
    if (path !== 'ServiceRequest.requester' || !isRequesterFacilityBinding(path, meta?.discriminator)) return
    const value = item.answer?.[0] ? fromAnswer(item.answer[0]) : undefined
    if (value !== undefined) out.push({ linkId: item.linkId, value })
  })
  return out
}

/** One test an order names: the system an answer carries (LOINC when it names none) and its name. */
export interface OrderedTestAnswer { system: string; code: string; display?: string }

/**
 * The tests an order names, in answer order, once each. An answer carries its own system: a catalog
 * test since the Lab order moved to the lab's test list (test catalog S4), LOINC before that. An
 * answer naming no system predates both and was always LOINC. Display comes from the answer itself
 * (a picked test carries its name), else from the Questionnaire answerOption. A test picked twice is
 * one order, since its fixed id comes from the test and two requests for it would share an id.
 */
export function orderedTests(response: QuestionnaireResponse, questionnaire: Questionnaire): OrderedTestAnswer[] {
  const index = indexItems(questionnaire)
  const out: OrderedTestAnswer[] = []
  const seen = new Set<string>()
  walkResponse(response.item, (item) => {
    const meta = index.get(item.linkId)
    if (meta?.fhirPath !== 'ServiceRequest.code') return
    for (const answer of item.answer ?? []) {
      const code = answer.valueCoding?.code ?? answer.valueString
      if (!code) continue
      const system = answer.valueCoding?.system || LOINC
      if (seen.has(`${system}|${code}`)) continue
      seen.add(`${system}|${code}`)
      const display = answer.valueCoding?.display || meta?.answerOptions?.find((o) => o.code === code)?.display
      out.push({ system, code, ...(display ? { display } : {}) })
    }
  })
  return out
}

/**
 * Every answered requisition-number item of a response, in the order the order extractor reads
 * them, as the extractor writes them (`String(value)`). The extractor keeps the last one as the
 * order's identifier. Same index and walk as `ServiceRequestExtractor`.
 */
export function requisitionNumberAnswers(response: QuestionnaireResponse, questionnaire: Questionnaire): string[] {
  const index = indexItems(questionnaire)
  const out: string[] = []
  walkResponse(response.item, (item) => {
    const path = index.get(item.linkId)?.fhirPath
    if (!isRequisitionNumberBinding(path)) return
    const value = item.answer?.[0] ? fromAnswer(item.answer[0]) : undefined
    if (value !== undefined) out.push(String(value))
  })
  return out
}

// ─── Observation extraction ──────────────────────────────────────────────────

const UCUM = 'http://unitsofmeasure.org'

function observationValue(answer: QuestionnaireResponseItemAnswer, unit?: string): Partial<Observation> {
  const num = answer.valueDecimal ?? answer.valueInteger
  if (num !== undefined) {
    const quantity: Quantity = { value: num }
    if (unit) {
      quantity.unit = unit
      quantity.code = unit
      quantity.system = UCUM
    }
    return { valueQuantity: quantity }
  }
  if (answer.valueBoolean !== undefined) return { valueBoolean: answer.valueBoolean }
  if (answer.valueDate !== undefined) return { valueDateTime: answer.valueDate }
  if (answer.valueDateTime !== undefined) return { valueDateTime: answer.valueDateTime }
  if (answer.valueCoding !== undefined) return { valueCodeableConcept: { coding: [answer.valueCoding] } }
  if (answer.valueString !== undefined) return { valueString: answer.valueString }
  return {}
}

/**
 * Emit one Observation per answer for items flagged `observationExtract` that
 * carry a LOINC (or other) `item.code` (PRD §3.5). Repeating-group instances
 * each yield their own Observation.
 */
export const ObservationExtractor: ResourceExtractor = {
  canExtract(model) {
    return model.fields.some((field) => isEnabledField(field, model.fields) && field.fieldType !== 'group' && hasObservationCode(field))
  },
  extract(response, questionnaire, ctx) {
    // Rejection wins (2026-10-11 spec): a rejected order writes no Observation of any kind.
    if (orderRejectionOf(response, questionnaire)) return []
    const index = indexItems(questionnaire)
    const out: Observation[] = []
    walkResponse(response.item, (item) => {
      const meta = index.get(item.linkId)
      if (!meta || !hasObservationCode(meta)) return
      for (const answer of item.answer ?? []) {
        const observation: Observation = { resourceType: 'Observation', status: 'final', code: { coding: meta.code } }
        if (ctx.subject) observation.subject = ctx.subject
        if (ctx.authored) observation.effectiveDateTime = ctx.authored
        Object.assign(observation, observationValue(answer, meta.unit))
        out.push(observation)
      }
    })
    return out
  },
}

// ─── ServiceRequest extraction (requisition domain) ──────────────────────────

/** The specimen type every test on the order chose, or null when none chose one or they differ. */
function sharedSpecimenType(response: QuestionnaireResponse): Coding | null {
  const chosen = Object.values(parseTestDetails(readTestDetails(response))).map((d) => d.specimen)
  if (chosen.length === 0 || chosen.some((s) => !s)) return null
  const first = chosen[0]!
  if (!chosen.every((s) => s!.system === first.system && s!.code === first.code)) return null
  return { system: first.system, code: first.code, ...(first.display ? { display: first.display } : {}) }
}

/** The id of the contained PractitionerRole the requester points at. */
const REQUESTER_ID = 'requester'

/** A clinician's name from a text answer, or from a picked entity's display. */
function nameOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (value && typeof value === 'object') {
    const display = (value as { display?: unknown }).display
    if (typeof display === 'string' && display.trim()) return display.trim()
  }
  return undefined
}

/**
 * The referring facility as an Organization reference. A picked facility is a coding from the
 * facility registry, and its code becomes the identifier the warehouse keys on. A name typed before
 * the field could search (free text) keeps the name with no identifier, so it names no facility code.
 */
function facilityOf(value: unknown): Reference | undefined {
  const c = pickedFacilityOf(value)
  if (c) return facilityReference(c)
  const name = nameOf(value)
  return name ? { display: name } : undefined
}

/** A facility from the facility register as the Organization reference an order's requester holds.
 *  Its code becomes the identifier the warehouse keys on. */
export function facilityReference(c: PickedFacility): Reference {
  return { identifier: { ...(c.system ? { system: c.system } : {}), value: c.code }, ...(c.display ? { display: c.display } : {}) }
}

/**
 * The requester as one PractitionerRole: the clinician and the clinic travel together. This is the
 * shape `packages/db/src/relational/requester.ts` reads into lab_requests.requester_code, _system,
 * _display and requester_practitioner.
 */
function requesterRole(clinician: string | undefined, facility: Reference | undefined): PractitionerRole | undefined {
  if (!clinician && !facility) return undefined
  return {
    resourceType: 'PractitionerRole',
    id: REQUESTER_ID,
    ...(clinician ? { practitioner: { display: clinician } } : {}),
    ...(facility ? { organization: facility } : {}),
  }
}

/**
 * An order's requester: the contained PractitionerRole and the reference to it, or undefined when
 * there is neither a clinician nor a facility. The form extractor and the lab desk (reception, in
 * @openldr/bootstrap) both write it, so a desk order's facility and clinician read back the same way.
 */
export function orderRequester(
  clinician: string | undefined, facility: Reference | undefined,
): { contained: PractitionerRole; requester: Reference } | undefined {
  const role = requesterRole(clinician, facility)
  if (!role) return undefined
  const display = clinician ?? facility?.display
  return { contained: role, requester: { reference: `#${REQUESTER_ID}`, type: 'PractitionerRole', ...(display ? { display } : {}) } }
}

/**
 * Emit one ServiceRequest per test for a requisition form, mapping answers whose field is bound to
 * `ServiceRequest.*` (via the Corlix fhir-path) onto each. Every request carries the same requisition
 * number, subject, requester and priority; only `code` differs. With no test chosen it emits one
 * request with no code. The extractor sets no ids: the form route gives each request a fixed id from
 * the facility, the requisition number and the test (`order-ids.ts`).
 */
export const ServiceRequestExtractor: ResourceExtractor = {
  canExtract() { return true },
  extract(response, questionnaire, ctx) {
    const index = indexItems(questionnaire)
    const request: ServiceRequest = {
      resourceType: 'ServiceRequest',
      status: 'active',
      intent: 'order',
      subject: ctx.subject ?? { display: 'Unknown subject' }, // subject is required by FHIR
    }
    if (ctx.authored) request.authoredOn = ctx.authored

    let clinician: string | undefined
    let facility: Reference | undefined
    walkResponse(response.item, (item) => {
      const meta = index.get(item.linkId)
      const path = meta?.fhirPath
      if (path === undefined) return
      // The order-rejection field is read by orderRejectionOf below. Path AND discriminator, so a
      // field bound to some other ServiceRequest.extension is not swallowed.
      if (isOrderRejectionBinding(path, meta?.discriminator)) return

      // The ordered tests are read by orderedTests below.
      if (path === 'ServiceRequest.code') return

      const value = item.answer?.[0] ? fromAnswer(item.answer[0]) : undefined
      if (value === undefined) return
      // The requisition number (see isRequisitionNumberBinding for which paths count). The
      // identifier carries the system the field's discriminator names, when it names one. Every CE
      // reader of an order identifier reads its value only, so the system adds, not moves.
      if (isRequisitionNumberBinding(path)) {
        const system = discriminatorEquals(meta?.discriminator, 'system')
        const requisition = { ...(system ? { system } : {}), value: String(value) }
        request.identifier = [requisition]
        request.requisition = { ...requisition }
      }
      if (path === 'ServiceRequest.priority') request.priority = String(value) as ServiceRequest['priority']
      // The clinician and the referring facility both fill the requester (migration 115). See
      // isRequesterFacilityBinding for how they are told apart.
      if (path === 'ServiceRequest.requester') {
        if (isRequesterFacilityBinding(path, meta?.discriminator)) facility = facilityOf(value)
        else clinician = nameOf(value)
      }
    })
    const requester = orderRequester(clinician, facility)
    if (requester) {
      request.contained = [requester.contained]
      request.requester = requester.requester
    }
    // One request per test, with the test's fixed id when the caller gives one. code.text names each
    // after its own test: the warehouse reads text before the first coding's display, and that first
    // coding is often a LOINC link with no name of its own.
    const tests = orderedTests(response, questionnaire)
    const requests: ServiceRequest[] = tests.length === 0
      ? [request]
      : tests.map(({ system, code, display }) => {
          const before = ctx.codingBefore?.get(`${system}|${code}`)
          return {
            ...structuredClone(request),
            ...(ctx.orderIdFor ? { id: ctx.orderIdFor({ system, code }) } : {}),
            code: {
              coding: [...(before ? [{ ...before }] : []), { system, code, ...(display ? { display } : {}) }],
              ...(display ? { text: display } : {}),
            },
          }
        })

    const rejection = orderRejectionOf(response, questionnaire)
    if (!rejection) return requests

    // Order-level rejection (2026-10-11 spec, part 2). The extension is the shape the warehouse reads
    // into lab_requests.rejection_code and rejection_reason; the Specimen is for FHIR readers. Every
    // test's request is revoked. The one Specimen's `request` is filled by linkToOrder once ids exist.
    for (const r of requests) {
      r.status = 'revoked'
      r.extension = [...(r.extension ?? []), {
        url: ORDER_REJECTION_EXTENSION,
        extension: [
          { url: 'code', valueCode: rejection.code },
          { url: 'reason', valueString: rejection.display || rejection.code },
        ],
      }]
    }
    const specimen: Specimen = {
      resourceType: 'Specimen',
      status: 'unsatisfactory',
      subject: request.subject,
      condition: [{ coding: [rejection] }],
    }
    const type = sharedSpecimenType(response)
    if (type) specimen.type = { coding: [type] }
    return [...requests, specimen]
  },
}
