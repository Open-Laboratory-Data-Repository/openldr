// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 4).
//
// A catalog test names the result parameters it yields. Those are existing concepts in the site
// result-parameter dictionary (urn:openldr:default_result), which already carries each one's units
// and its result_role. Migration 069 seeds the ValueSet of the ones whose role is 'result', which is
// what the authoring picker offers. This module is the shape of that link plus the band rules, kept
// free of the database so both the service and its tests can use it directly.

/** Parameters whose result_role is 'result', seeded by migration 069. The picker offers these. */
export const RESULT_PARAM_VALUE_SET = 'urn:openldr:valueset:reportable-result';

export type ResultType = 'numeric' | 'coded' | 'text';

/** One reference band. A band naming neither sex nor an age window is the catch-all. */
export interface ResultBand {
  low: number | null;
  high: number | null;
  unit: string | null;
  sex: string | null;
  ageLow: number | null;
  ageHigh: number | null;
}

export interface TestResultParam {
  system: string;
  code: string;
  resultType: ResultType;
  /** For a coded parameter, the ValueSet its answers come from. Null for the other types. */
  valueSetUrl: string | null;
  /** Bands, in the order the operator wrote them. Empty for a coded or text parameter. */
  bands: ResultBand[];
}

const RESULT_TYPES: ResultType[] = ['numeric', 'coded', 'text'];

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toBand(value: unknown): ResultBand | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  return {
    low: num(b.low), high: num(b.high), unit: str(b.unit),
    sex: str(b.sex), ageLow: num(b.ageLow), ageHigh: num(b.ageHigh),
  };
}

/** Read what a test stored. Anything unreadable is dropped rather than failing the whole test. */
export function parseResultParams(value: unknown): TestResultParam[] {
  if (!Array.isArray(value)) return [];
  const out: TestResultParam[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const code = str(e.code);
    const system = str(e.system);
    if (!code || !system) continue;
    const declared = str(e.resultType) as ResultType | null;
    const resultType = declared && RESULT_TYPES.includes(declared) ? declared : 'text';
    const bands = resultType === 'numeric' && Array.isArray(e.bands)
      ? e.bands.map(toBand).filter((b): b is ResultBand => b !== null)
      : [];
    out.push({ system, code, resultType, valueSetUrl: resultType === 'coded' ? str(e.valueSetUrl) : null, bands });
  }
  return out;
}

/**
 * The band that applies to one patient. A band matches when its sex matches, or it names none, and
 * the age falls inside its window, both edges counted as inside. The first match in the stored order
 * wins, so a lab that writes overlapping bands gets the one it wrote first. Null means nothing
 * matched, and the sheet then shows no range rather than a wrong one.
 */
export function matchBand(bands: ResultBand[], patient: { sex?: string | null; ageYears?: number | null }): ResultBand | null {
  const sex = patient.sex ?? null;
  const age = patient.ageYears ?? null;
  for (const band of bands) {
    if (band.sex !== null && band.sex !== sex) continue;
    if (band.ageLow !== null && (age === null || age < band.ageLow)) continue;
    if (band.ageHigh !== null && (age === null || age > band.ageHigh)) continue;
    return band;
  }
  return null;
}
