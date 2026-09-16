import type { FhirResource, Observation, Questionnaire, QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'
import type { FormSchema } from '../schema/form-schema'
import { parseTestDetails, type ResultCoding, type TestDetail, type TypedResult } from '../test-details'
import type { ExtractionContext, ResourceExtractor } from './extract'

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
    }],
  }
}

function observationsFor(key: string, detail: TestDetail, ctx: ExtractionContext): Observation[] {
  const base = {
    resourceType: 'Observation' as const,
    subject: ctx.subject ?? { display: 'Unknown subject' },
    ...(ctx.authored ? { effectiveDateTime: ctx.authored } : {}),
  }
  if (detail.rejection) {
    const [system, code] = key.split('|')
    return [{
      ...base,
      status: 'cancelled',
      code: { coding: [{ system, code }] },
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
function readTestDetails(response: QuestionnaireResponse): Record<string, unknown> {
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
  extract(response: QuestionnaireResponse, _questionnaire: Questionnaire, ctx: ExtractionContext): FhirResource[] {
    const answer = parseTestDetails(readTestDetails(response))
    return Object.entries(answer).flatMap(([key, detail]) => observationsFor(key, detail, ctx))
  },
}
