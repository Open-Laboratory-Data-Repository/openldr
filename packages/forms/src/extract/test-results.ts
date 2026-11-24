import type { FhirResource, Observation, Questionnaire, QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'
import type { FormSchema } from '../schema/form-schema'
import { parseTestDetails, type BandAgeUnit, type ResultBandRef, type ResultCoding, type TestDetail, type TypedResult } from '../test-details'
import { orderedTests, type ExtractionContext, type ResourceExtractor } from './extract'
import { orderRejectionOf } from './order-rejection'

// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 5).
//
// One Observation per typed result, and one cancelled Observation carrying the reason for a rejected
// test. Values are read back out of the response, so a response replayed through ingest still
// produces Observations. The reference band cannot ride in a FHIR answer, so it comes from the
// extraction context, which the forms route fills. A replay carries no context and so no range.

function valueOf(result: TypedResult): Partial<Observation> {
  if (result.resultType === 'numeric' && typeof result.value === 'number') {
    return { valueQuantity: { value: result.value, ...(result.unit ? { unit: result.unit } : {}) } }
  }
  if (result.resultType === 'coded' && result.value && typeof result.value === 'object') {
    const coding = result.value as ResultCoding
    return { valueCodeableConcept: { coding: [{ system: coding.system, code: coding.code, ...(coding.display ? { display: coding.display } : {}) }] } }
  }
  if (typeof result.value === 'string') return { valueString: result.value }
  return {}
}

const UCUM = 'http://unitsofmeasure.org'
// UCUM writes a year as "a" (annum). Days and months keep their own codes.
const UCUM_AGE: Record<BandAgeUnit, string> = { d: 'd', mo: 'mo', y: 'a' }

/** The band's age window as a FHIR Range in UCUM, or nothing when the band has no age window. */
function ageOf(band: ResultBandRef): { age?: { low?: object; high?: object } } {
  if (band.ageLow === null && band.ageHigh === null) return {}
  const code = UCUM_AGE[band.ageUnit ?? 'y'] ?? 'a'
  const q = (value: number) => ({ value, unit: code, system: UCUM, code })
  return {
    age: {
      ...(band.ageLow !== null ? { low: q(band.ageLow) } : {}),
      ...(band.ageHigh !== null ? { high: q(band.ageHigh) } : {}),
    },
  }
}

function rangeOf(result: TypedResult, key: string, ctx: ExtractionContext): Partial<Observation> {
  // The band never survives a QuestionnaireResponse answer, so the forms route puts it in the
  // context. A response replayed through ingest carries none and so gets no referenceRange, which is
  // correct: the band is reference data the catalog owns, not something the bench typed.
  const band = ctx.testBands?.get(`${key}#${result.param.system}|${result.param.code}`) ?? result.band
  if (!band || (band.low === null && band.high === null)) return {}
  const unit = band.unit ?? result.unit ?? undefined
  return {
    referenceRange: [{
      ...(band.low !== null ? { low: { value: band.low, ...(unit ? { unit } : {}) } } : {}),
      ...(band.high !== null ? { high: { value: band.high, ...(unit ? { unit } : {}) } } : {}),
      // Who the range is for, so the record says which age it was read against.
      ...ageOf(band),
      // The name the bench picked by, so the record says which range was used.
      ...(band.name ? { text: band.name } : {}),
    }],
  }
}

function observationsFor(key: string, detail: TestDetail, ctx: ExtractionContext, orderId: string | null): Observation[] {
  const base = {
    resourceType: 'Observation' as const,
    subject: ctx.subject ?? { display: 'Unknown subject' },
    ...(ctx.authored ? { effectiveDateTime: ctx.authored } : {}),
    // The result belongs to its own test's order. The warehouse reads basedOn[0] into
    // lab_results.request_id, so naming every order would join each result to the first test.
    ...(orderId ? { basedOn: [{ reference: `ServiceRequest/${orderId}` }] } : {}),
  }
  if (detail.rejection) {
    const [system, code] = key.split('|')
    // Coded as its order is: the codings the context puts in front (LOINC, then the Test code), then
    // the catalog id. The warehouse keeps the first, so observation_code is never the id.
    const before = ctx.codingsBefore?.get(key) ?? []
    return [{
      ...base,
      status: 'cancelled',
      code: { coding: [...before.map((c) => ({ ...c })), { system, code }] },
      dataAbsentReason: {
        coding: [{
          system: detail.rejection.system, code: detail.rejection.code,
          ...(detail.rejection.display ? { display: detail.rejection.display } : {}),
        }],
      },
    } as Observation]
  }
  return detail.results
    .filter((result) => result.value !== null)
    .map((result) => ({
      ...base,
      status: 'final',
      code: { coding: [{ system: result.param.system, code: result.param.code }] },
      ...valueOf(result),
      ...rangeOf(result, key, ctx),
    }) as Observation)
}

/** Rebuild the answer from the nested items the response carries (test-details.ts writes them). */
export function readTestDetails(response: QuestionnaireResponse): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const walk = (items: QuestionnaireResponseItem[] | undefined): void => {
    for (const item of items ?? []) {
      if (item.linkId.includes('|') && item.item) {
        const detail: { specimen: unknown; rejection: unknown; results: unknown[] } = { specimen: null, rejection: null, results: [] }
        for (const child of item.item) {
          const suffix = child.linkId.slice(item.linkId.length + 1)
          const answer = child.answer?.[0]
          if (suffix === 'specimen') detail.specimen = answer?.valueCoding
          else if (suffix === 'rejection') detail.rejection = answer?.valueCoding
          else if (answer) {
            const cut = suffix.lastIndexOf('|')
            const param = { system: suffix.slice(0, cut), code: suffix.slice(cut + 1) }
            if (answer.valueQuantity !== undefined) {
              detail.results.push({ param, resultType: 'numeric', value: answer.valueQuantity.value, unit: answer.valueQuantity.unit })
            } else if (answer.valueCoding !== undefined) {
              detail.results.push({ param, resultType: 'coded', value: answer.valueCoding })
            } else if (answer.valueString !== undefined) {
              detail.results.push({ param, resultType: 'text', value: answer.valueString })
            }
          }
        }
        out[item.linkId] = detail
      }
      if (item.item) walk(item.item)
    }
  }
  walk(response.item)
  return out
}

export const TestResultsExtractor: ResourceExtractor = {
  canExtract(model: FormSchema): boolean {
    return model.fields.some((field) => field.fieldType === 'testDetails')
  },
  extract(response: QuestionnaireResponse, questionnaire: Questionnaire, ctx: ExtractionContext): FhirResource[] {
    // Rejection wins (2026-10-11 spec, decision 2): a rejected order writes no result and no
    // per-test cancelled Observation. The typed values stay in the response only.
    if (orderRejectionOf(response, questionnaire)) return []
    const answer = parseTestDetails(readTestDetails(response))
    // A detail is keyed `system|code` by its test. Only a test the order names has an order to point
    // at; any other detail is left to linkToOrder, which points it at every order.
    const ordered = new Set(orderedTests(response, questionnaire).map((t) => `${t.system}|${t.code}`))
    const orderIdOf = (key: string): string | null => {
      if (!ctx.orderIdFor || !ordered.has(key)) return null
      const cut = key.lastIndexOf('|')
      return ctx.orderIdFor({ system: key.slice(0, cut), code: key.slice(cut + 1) })
    }
    return Object.entries(answer).flatMap(([key, detail]) => observationsFor(key, detail, ctx, orderIdOf(key)))
  },
}
