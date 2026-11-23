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

/** The unit a band's age window is written in: days, months or years. A band without one is in years. */
export type AgeUnit = 'd' | 'mo' | 'y';
export const AGE_UNITS: readonly AgeUnit[] = ['d', 'mo', 'y'];

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
  /** The unit of ageLow and ageHigh. Absent means years, so a band saved before units existed reads
   *  back unchanged and fits the same patients. */
  ageUnit?: AgeUnit;
  /** The critical low limit. Absent when the band sets none. Slice 5 decides how results are flagged against it. */
  criticalLow?: number;
  /** The critical high limit. Absent when the band sets none. Slice 5 decides how results are flagged against it. */
  criticalHigh?: number;
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
  const criticalLow = num(b.criticalLow);
  const criticalHigh = num(b.criticalHigh);
  const ageUnit = AGE_UNITS.find((u) => u === b.ageUnit);
  // The age unit and critical limits are left out when not set, so a band stored without them reads
  // back unchanged.
  return {
    name: str(b.name), low: num(b.low), high: num(b.high), unit: str(b.unit),
    sex: str(b.sex), ageLow: num(b.ageLow), ageHigh: num(b.ageHigh),
    ...(ageUnit ? { ageUnit } : {}),
    ...(criticalLow !== null ? { criticalLow } : {}),
    ...(criticalHigh !== null ? { criticalHigh } : {}),
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
 * Who a band is matched against: the patient's sex and birth date, the moment the age is taken at,
 * and the lab's time zone. The age is worked out per band, in the band's own unit, so the birth date
 * travels and not an age.
 */
export interface BandPatient {
  sex?: string | null;
  /** A FHIR date or dateTime, such as "1990-01-05". Null or unreadable means the age is unknown. */
  birthDate?: string | null;
  /** Epoch milliseconds. Defaults to now. */
  at?: number;
  /** The lab's IANA time zone (lab.timezone), which decides what date "today" is. Unset or unreadable
   *  means UTC, as elsewhere in CE. */
  timeZone?: string | null;
}

/** A civil date as a day count, so two of them subtract to whole days. */
type CivilDate = { y: number; m: number; d: number };
const dayNumber = (c: CivilDate) => Math.round(Date.UTC(c.y, c.m - 1, c.d) / 86_400_000);

/** The civil date one moment falls on in a zone. An unset or unreadable zone is UTC. */
function civilDateIn(at: number, timeZone: string | null | undefined): CivilDate {
  const partsIn = (zone: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(at));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = partsIn(timeZone?.trim() || 'UTC');
  } catch {
    parts = partsIn('UTC');
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { y: part('year'), m: part('month'), d: part('day') };
}

// A FHIR date: a year, a year and month, or a full date. A missing month or day is the first.
const FHIR_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * The civil date of birth. A FHIR date is already a civil date and is read as written, never as UTC
 * midnight. A dateTime is a moment, so it is moved to the lab's zone first. Null when unreadable.
 */
function birthCivil(birthDate: string | null | undefined, timeZone: string | null | undefined): CivilDate | null {
  if (typeof birthDate !== 'string' || birthDate.trim() === '') return null;
  const text = birthDate.trim();
  const date = FHIR_DATE.exec(text);
  if (date) {
    const c = { y: Number(date[1]), m: Number(date[2] ?? 1), d: Number(date[3] ?? 1) };
    const check = new Date(Date.UTC(c.y, c.m - 1, c.d));
    // 2026-02-30 is not a date. Date.UTC would roll it into March.
    if (check.getUTCMonth() !== c.m - 1 || check.getUTCDate() !== c.d) return null;
    return c;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : civilDateIn(ms, timeZone);
}

/**
 * The patient's age in one unit, or null when the birth date is missing or unreadable. Both ends are
 * civil dates: the birth date as written, and today's date in the lab's zone.
 * - d: whole days since the birth date. Born today is 0 days.
 * - mo: whole calendar months completed. A birth on the 31st completes a month on the last day of a
 *   shorter month (born 31 January: 1 month on 28 February, or the 29th in a leap year).
 * - y: whole calendar years completed, counted the same way as months: a year completes on the
 *   birthday itself. A baby born 29 February turns a year older on 28 February in a year with no
 *   29 February, by the same last-day-of-the-month rule the months use.
 */
export function ageIn(
  unit: AgeUnit, birthDate: string | null | undefined, at: number = Date.now(), timeZone?: string | null,
): number | null {
  const born = birthCivil(birthDate, timeZone);
  if (!born) return null;
  const today = civilDateIn(at, timeZone);
  if (unit === 'd') return dayNumber(today) - dayNumber(born);
  let months = (today.y - born.y) * 12 + (today.m - born.m);
  const lastDay = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate();
  if (today.d < Math.min(born.d, lastDay)) months -= 1;
  return unit === 'y' ? Math.floor(months / 12) : months;
}

/** Whether a range fits one patient. Unknown means the range names a sex or an age the record lacks. */
export type BandFit = 'yes' | 'no' | 'unknown';

/**
 * Whether one band fits one patient. The sex must match when the band names one. The age, in the
 * band's unit, must fall inside its window, both edges counted as inside: a band "0 to 28 days" fits
 * through day 28, and "18+ years" from the 18th birthday. A band naming a sex or an age the record
 * lacks is unknown, unless the other half already rules it out.
 */
export function bandFit(band: ResultBand, patient: BandPatient): BandFit {
  const sex = patient.sex ?? null;
  let unknown = false;
  if (band.sex !== null) {
    if (sex === null) unknown = true;
    else if (band.sex !== sex) return 'no';
  }
  if (band.ageLow !== null || band.ageHigh !== null) {
    const age = ageIn(band.ageUnit ?? 'y', patient.birthDate, patient.at ?? Date.now(), patient.timeZone);
    if (age === null) unknown = true;
    else if ((band.ageLow !== null && age < band.ageLow) || (band.ageHigh !== null && age > band.ageHigh)) return 'no';
  }
  return unknown ? 'unknown' : 'yes';
}

/**
 * The band that applies to one patient: the first, in the stored order, that fits for certain. A lab
 * that writes overlapping bands gets the one it wrote first. Null means nothing matched, and the
 * sheet then shows no range rather than a wrong one.
 */
export function matchBand(bands: ResultBand[], patient: BandPatient): ResultBand | null {
  const at = patient.at ?? Date.now();
  return bands.find((band) => bandFit(band, { ...patient, at }) === 'yes') ?? null;
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

/**
 * A patient's sex and birth date, as the band rules read them, from a stored FHIR Patient, with the
 * moment the age is taken at and the lab's time zone. Bench result entry and a plugin's testCatalog.resultParams both call
 * this, so both pick the same band. A missing Patient or an unreadable birth date gives null, and the
 * catalog then answers the catch-all band.
 */
export function patientBandKey(
  patient: { gender?: unknown; birthDate?: unknown } | null,
  now: number = Date.now(),
  timeZone?: string | null,
): { sex: string | null; birthDate: string | null; at: number; timeZone: string | null } {
  const zone = timeZone?.trim() || null;
  if (!patient) return { sex: null, birthDate: null, at: now, timeZone: zone };
  const birthDate = typeof patient.birthDate === 'string' && birthCivil(patient.birthDate, zone) ? patient.birthDate : null;
  return { sex: typeof patient.gender === 'string' ? patient.gender : null, birthDate, at: now, timeZone: zone };
}

const NUMBER_FIELDS = ['low', 'high', 'ageLow', 'ageHigh', 'criticalLow', 'criticalHigh'] as const;
const STRING_FIELDS = ['name', 'unit', 'sex', 'ageUnit'] as const;

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
  // An age unit CE does not know would read as years, and so match a years band it is not.
  if (raw.ageUnit !== null && raw.ageUnit !== undefined && !AGE_UNITS.includes(raw.ageUnit as AgeUnit)) return false;
  return true;
}

/**
 * The catalog range a submitted band matches, field for field, name, age unit and critical limits
 * included. A missing name reads as none, so a range saved before names existed still matches an
 * unnamed one. A missing critical limit reads as none too, and a missing age unit as years. Null when the value
 * is not band-shaped, a field carries the wrong type, or no catalog range matches.
 */
export function findCatalogBand(band: unknown, bands: ResultBand[]): ResultBand | null {
  if (!band || typeof band !== 'object') return null;
  const raw = band as Record<string, unknown>;
  if (!bandFieldTypesOk(raw)) return null;
  const b = toBand(raw);
  if (!b) return null;
  return bands.find((c) => c.name === b.name && c.low === b.low && c.high === b.high && c.unit === b.unit
    && c.sex === b.sex && c.ageLow === b.ageLow && c.ageHigh === b.ageHigh
    && (c.ageUnit ?? 'y') === (b.ageUnit ?? 'y')
    && (c.criticalLow ?? null) === (b.criticalLow ?? null) && (c.criticalHigh ?? null) === (b.criticalHigh ?? null)) ?? null;
}

/**
 * True when a range an answer carried is one of the catalog's ranges, field for field. A missing name
 * reads as none, so a range saved before names existed still matches an unnamed one.
 */
export function bandInCatalog(band: unknown, bands: ResultBand[]): boolean {
  return findCatalogBand(band, bands) !== null;
}
