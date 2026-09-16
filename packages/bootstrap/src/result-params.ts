// Bench result entry (docs/superpowers/specs/2026-09-16-bench-result-entry-design.md, 4).
//
// A catalog test names the result parameters it yields. Those are existing concepts in the site
// result-parameter dictionary (urn:openldr:default_result), which already carries each one's units
// and its result_role. Migration 069 seeds the ValueSet of the ones whose role is 'result', which is
// what the authoring picker offers. This module is the shape of that link plus the band rules, kept
// free of the database so both the service and its tests can use it directly.

import { Patient } from '@openldr/fhir';

/** Parameters whose result_role is 'result', seeded by migration 069. The picker offers these. */
export const RESULT_PARAM_VALUE_SET = 'urn:openldr:valueset:reportable-result';

export type ResultType = 'numeric' | 'coded' | 'text';

/** One reference band. A band naming neither sex nor an age window is the catch-all. */
export interface ResultBand {
  /** Typed by whoever edits the test, such as "Highland women". Null when the range has no name. */
  name: string | null;
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
    name: str(b.name), low: num(b.low), high: num(b.high), unit: str(b.unit),
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

/** Whether a range fits one patient. Unknown means the range names a sex or an age the record lacks. */
export type BandFit = 'yes' | 'no' | 'unknown';

export function bandFit(band: ResultBand, patient: { sex?: string | null; ageYears?: number | null }): BandFit {
  const sex = patient.sex ?? null;
  const age = patient.ageYears ?? null;
  let unknown = false;
  if (band.sex !== null) {
    if (sex === null) unknown = true;
    else if (band.sex !== sex) return 'no';
  }
  if (band.ageLow !== null || band.ageHigh !== null) {
    if (age === null) unknown = true;
    else if ((band.ageLow !== null && age < band.ageLow) || (band.ageHigh !== null && age > band.ageHigh)) return 'no';
  }
  return unknown ? 'unknown' : 'yes';
}

/** A sex a range can name, with its label in each language the studio ships. */
export interface SexOption {
  code: string;
  labels: Record<string, string>;
}

// The codes come from the FHIR Patient schema. Only the words for them live here: the operator chose
// to have the server send labels (named reference ranges spec, 11), and no stored data holds them in
// French or Portuguese.
const SEX_LABELS: Record<string, Record<string, string>> = {
  male: { en: 'Male', fr: 'Homme', pt: 'Masculino' },
  female: { en: 'Female', fr: 'Femme', pt: 'Feminino' },
  other: { en: 'Other', fr: 'Autre', pt: 'Outro' },
  unknown: { en: 'Unknown', fr: 'Inconnu', pt: 'Desconhecido' },
};

export const SEX_OPTIONS: SexOption[] = Patient.shape.gender.unwrap().options
  .map((code) => ({ code, labels: SEX_LABELS[code] ?? { en: code } }));

const NUMBER_FIELDS = ['low', 'high', 'ageLow', 'ageHigh'] as const;
const STRING_FIELDS = ['name', 'unit', 'sex'] as const;

/**
 * False when a raw submitted field is neither the field's proper type nor null/absent. `toBand`
 * coerces a wrong-typed value (a string where a number belongs, say) to null, which would let a
 * malformed band match a catalog band that has null there. Checking the raw types first stops that.
 */
function bandFieldTypesOk(raw: Record<string, unknown>): boolean {
  for (const f of NUMBER_FIELDS) {
    const v = raw[f];
    if (v !== null && v !== undefined && typeof v !== 'number') return false;
  }
  for (const f of STRING_FIELDS) {
    const v = raw[f];
    if (v !== null && v !== undefined && typeof v !== 'string') return false;
  }
  return true;
}

/**
 * The catalog range a submitted band matches, field for field, name included. A missing name reads
 * as none, so a range saved before names existed still matches an unnamed one. Null when the value
 * is not band-shaped, a field carries the wrong type, or no catalog range matches.
 */
export function findCatalogBand(band: unknown, bands: ResultBand[]): ResultBand | null {
  if (!band || typeof band !== 'object') return null;
  const raw = band as Record<string, unknown>;
  if (!bandFieldTypesOk(raw)) return null;
  const b = toBand(raw);
  if (!b) return null;
  return bands.find((c) => c.name === b.name && c.low === b.low && c.high === b.high && c.unit === b.unit
    && c.sex === b.sex && c.ageLow === b.ageLow && c.ageHigh === b.ageHigh) ?? null;
}

/**
 * True when a range an answer carried is one of the catalog's ranges, field for field. A missing name
 * reads as none, so a range saved before names existed still matches an unnamed one.
 */
export function bandInCatalog(band: unknown, bands: ResultBand[]): boolean {
  return findCatalogBand(band, bands) !== null;
}
