import type {
  Coding,
  FhirResource,
  Observation,
  Quantity,
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireResponse,
  QuestionnaireResponseItem,
  QuestionnaireResponseItemAnswer,
  Reference,
  ServiceRequest,
} from 'fhir/r4'
import type { FieldDiscriminator, FormField, FormSchema } from '../schema/form-schema'
import { fromAnswer } from '../answer-value'
import { discriminatorEquals } from '../discriminator'
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
  testBands?: ReadonlyMap<string, { low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null }>
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

function extrasDiscriminator(item: QuestionnaireItem): FieldDiscriminator | undefined {
  const json = item.extension?.find((e) => e.url === EXT_CORLIX_FIELD_EXTRAS)?.valueString
  if (!json) return undefined
  try {
    return (JSON.parse(json) as { fhirDiscriminator?: FieldDiscriminator }).fhirDiscriminator
  } catch {
    return undefined // a malformed extras blob names no discriminator; the rest still extracts
  }
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

/**
 * Emit a single ServiceRequest for a requisition form, mapping answers whose
 * field is bound to `ServiceRequest.*` (via the Corlix fhir-path) onto it.
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

    const codings: Coding[] = []
    walkResponse(response.item, (item) => {
      const meta = index.get(item.linkId)
      const path = meta?.fhirPath
      if (path === undefined) return

      // The ordered test(s) → ServiceRequest.code. An answer carries its own system: a catalog test
      // since the Lab order moved to the lab's test list (test catalog S4), LOINC before that. An answer
      // naming no system predates both and was always LOINC. Display comes from the Questionnaire
      // answerOption.
      if (path === 'ServiceRequest.code') {
        for (const answer of item.answer ?? []) {
          const code = answer.valueCoding?.code ?? answer.valueString
          if (!code) continue
          const system = answer.valueCoding?.system || LOINC
          const display = meta?.answerOptions?.find((o) => o.code === code)?.display
          const before = ctx.codingBefore?.get(`${system}|${code}`)
          if (before) codings.push(before)
          codings.push({ system, code, ...(display ? { display } : {}) })
        }
        return
      }

      const value = item.answer?.[0] ? fromAnswer(item.answer[0]) : undefined
      if (value === undefined) return
      // The shipped Lab order binds its requisition number to ServiceRequest.identifier.value since
      // migration 103. A form an operator edited before then keeps the whole-list path, so both
      // count. The identifier carries the system the field's discriminator names, when it names one.
      // Every CE reader of an order identifier reads its value only, so the system adds, not moves.
      if (path === 'ServiceRequest.identifier' || path === 'ServiceRequest.identifier.value') {
        const system = discriminatorEquals(meta?.discriminator, 'system')
        request.identifier = [{ ...(system ? { system } : {}), value: String(value) }]
      }
      if (path === 'ServiceRequest.priority') request.priority = String(value) as ServiceRequest['priority']
    })
    if (codings.length) request.code = { coding: codings }

    return [request]
  },
}
