import type { QuestionnaireResponseItem } from 'fhir/r4'

// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 5).
//
// A `testDetails` field holds, for each test chosen on the order, the specimen, an optional coded
// rejection and one value per result parameter. It is keyed by `system|code` of the test so it stays
// aligned with the Tests answer it depends on, the way S4's specimen picker depends on that field.
//
// The band inside each result is the one the SERVER chose when the sheet asked for parameters. It is
// kept here so the studio can show it, and the forms route reads it back out to hand the extractor,
// which has no catalog of its own.

export interface ResultCoding { system: string; code: string; display?: string | null }

export interface TypedResult {
  param: { system: string; code: string }
  resultType: 'numeric' | 'coded' | 'text'
  value: number | string | ResultCoding | null
  unit?: string | null
  band?: { low: number | null; high: number | null; unit: string | null; sex: string | null; ageLow: number | null; ageHigh: number | null } | null
}

export interface TestDetail {
  specimen: ResultCoding | null
  rejection: ResultCoding | null
  results: TypedResult[]
}

/** Keyed `system|code` of the test. */
export type TestDetailsAnswer = Record<string, TestDetail>

function coding(value: unknown): ResultCoding | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (typeof c.system !== 'string' || typeof c.code !== 'string') return null
  return { system: c.system, code: c.code, ...(typeof c.display === 'string' ? { display: c.display } : {}) }
}

export function parseTestDetails(value: unknown): TestDetailsAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: TestDetailsAnswer = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    const results = Array.isArray(d.results) ? d.results : []
    out[key] = {
      specimen: coding(d.specimen),
      rejection: coding(d.rejection),
      results: results.flatMap((r) => {
        if (!r || typeof r !== 'object') return []
        const entry = r as Record<string, unknown>
        const param = coding(entry.param)
        if (!param) return []
        const resultType = entry.resultType === 'numeric' || entry.resultType === 'coded' ? entry.resultType : 'text'
        const value = resultType === 'coded'
          ? coding(entry.value)
          : resultType === 'numeric'
            ? (typeof entry.value === 'number' ? entry.value : null)
            : (typeof entry.value === 'string' ? entry.value : null)
        const typed: TypedResult = { param: { system: param.system, code: param.code }, resultType, value }
        if (typeof entry.unit === 'string') typed.unit = entry.unit
        if (entry.band && typeof entry.band === 'object') typed.band = entry.band as TypedResult['band']
        return [typed]
      }),
    }
  }
  return out
}

/** FHIR's Coding has no null display, and a picker answer may carry one. Drop it rather than write null. */
function fhirCoding(c: ResultCoding): { system: string; code: string; display?: string } {
  return { system: c.system, code: c.code, ...(c.display ? { display: c.display } : {}) }
}

/**
 * The nested QuestionnaireResponse items for this answer: one item per test, holding one child per
 * specimen, rejection or result. A rejected test writes its reason and no results, because a value
 * typed before the rejection is kept in the answer but is not part of the record of what was
 * measured.
 */
export function testDetailItems(answer: TestDetailsAnswer): QuestionnaireResponseItem[] {
  return Object.entries(answer).map(([key, detail]) => {
    const item: QuestionnaireResponseItem[] = []
    if (detail.rejection) {
      item.push({ linkId: `${key}#rejection`, answer: [{ valueCoding: fhirCoding(detail.rejection) }] })
      return { linkId: key, item }
    }
    if (detail.specimen) item.push({ linkId: `${key}#specimen`, answer: [{ valueCoding: fhirCoding(detail.specimen) }] })
    for (const result of detail.results) {
      if (result.value === null) continue
      const link = `${key}#${result.param.system}|${result.param.code}`
      if (result.resultType === 'numeric' && typeof result.value === 'number') {
        item.push({ linkId: link, answer: [{ valueQuantity: { value: result.value, ...(result.unit ? { unit: result.unit } : {}) } }] })
      } else if (result.resultType === 'coded' && typeof result.value === 'object') {
        item.push({ linkId: link, answer: [{ valueCoding: fhirCoding(result.value as ResultCoding) }] })
      } else if (typeof result.value === 'string') {
        item.push({ linkId: link, answer: [{ valueString: result.value }] })
      }
    }
    return { linkId: key, item }
  })
}
