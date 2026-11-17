/**
 * Age at request: read an age as a lab sends it and turn it into the `age-at-request` extension the
 * warehouse reads (`packages/db/src/relational/request-facts.ts`). Agreed in
 * docs/superpowers/specs/2026-11-17-mapping-review.md (age amendment and storage agreement).
 *
 * - The age as sent is always kept: `text` for a written age, `source` for one value and unit.
 * - `days` is total days. Hours (completed days), days and weeks are exact. Months (x 30.4375) and
 *   years (x 365.25) are averages, so `daysEstimated` marks them.
 * - `years` is completed years from years and months only, and only when 1 or more, so a baby
 *   never gets 0 years.
 * - Never a birth date. Units are time units, not clinical vocabulary.
 */

export const AGE_EXTENSION_URL = 'urn:openldr:ext:age-at-request';
const UCUM = 'http://unitsofmeasure.org';

type UnitCode = 'h' | 'd' | 'wk' | 'mo' | 'a';

/** Unit words in en, fr and pt, with their UCUM code. Lower case, without accents. */
const UNIT_WORDS: Record<UnitCode, string[]> = {
  h: ['h', 'hr', 'hrs', 'hour', 'hours', 'heure', 'heures', 'hora', 'horas'],
  d: ['d', 'day', 'days', 'j', 'jour', 'jours', 'dia', 'dias'],
  wk: ['w', 'wk', 'wks', 'week', 'weeks', 'sem', 'semaine', 'semaines', 'semana', 'semanas'],
  mo: ['m', 'mo', 'mos', 'month', 'months', 'mois', 'mes', 'meses'],
  a: ['y', 'yr', 'yrs', 'year', 'years', 'a', 'an', 'ans', 'annee', 'annees', 'ano', 'anos'],
};
const CODE_OF = new Map<string, UnitCode>(
  (Object.entries(UNIT_WORDS) as [UnitCode, string[]][]).flatMap(([code, words]) => words.map((w) => [w, code] as [string, UnitCode])),
);

/** Days in each unit: exact for hours, days and weeks; an average for months and years. */
const DAYS: Record<UnitCode, number> = { h: 1 / 24, d: 1, wk: 7, mo: 30.4375, a: 365.25 };
const ESTIMATED = new Set<UnitCode>(['mo', 'a']);

export interface SourceAge {
  value: number;
  unit: string;
  system: string;
  code: UnitCode;
}

/** An age as read. `unread` when nothing could be read: only `text` is kept. */
export interface ReadAge {
  years?: number;
  days?: number;
  daysEstimated?: true;
  source?: SourceAge;
  text?: string;
  unread?: true;
}

type Part = { value: number; unit: string; code: UnitCode };

function codeOf(unit: string): UnitCode | null {
  const key = unit.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '');
  return CODE_OF.get(key) ?? null;
}

function numberOf(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

/** One value and unit per part: `2y 3m`, `2 years, 3 months`, `2 ans et 3 mois`. Null when any part fails. */
function partsOf(text: string): Part[] | null {
  const parts: Part[] = [];
  const re = /^(\d+(?:[.,]\d+)?)\s*([^\d\s,;]+)/;
  let rest = text.trim();
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    const code = codeOf(m[2]);
    const value = numberOf(m[1]);
    if (!code || value === null) return null;
    parts.push({ value, unit: m[2], code });
    rest = rest.slice(m[0].length).replace(/^[\s,;]+(?:(?:and|et|e)\s+)?/i, '');
  }
  return parts.length > 0 ? parts : null;
}

function fromParts(parts: Part[]): ReadAge {
  const out: ReadAge = {};
  const months = parts.reduce((sum, p) => sum + (p.code === 'a' ? p.value * 12 : p.code === 'mo' ? p.value : 0), 0);
  const years = Math.floor(months / 12);
  if (years >= 1) out.years = years;
  out.days = Math.floor(parts.reduce((sum, p) => sum + p.value * DAYS[p.code], 0));
  if (parts.some((p) => ESTIMATED.has(p.code))) out.daysEstimated = true;
  if (parts.length === 1) out.source = { value: parts[0].value, unit: parts[0].unit, system: UCUM, code: parts[0].code };
  return out;
}

/**
 * Read an age. `value` is the age as sent: written text (`3 days`, `2y 3m`), or a number. `unit`
 * is the value of an Age unit field, when one is mapped. A bare number with no unit is years.
 */
export function readAge(value: string | number, unit?: string): ReadAge {
  const sent = typeof value === 'number' ? String(value) : value;
  const unitText = unit?.trim() ?? '';
  const n = numberOf(sent);
  if (n !== null) {
    // A number: its unit comes from the Age unit field, or is years.
    const code = unitText ? codeOf(unitText) : 'a';
    if (!code) return { text: `${sent.trim()} ${unitText}`, unread: true };
    return fromParts([{ value: n, unit: unitText || 'a', code }]);
  }
  const parts = partsOf(sent);
  if (!parts) return { text: sent, unread: true };
  return { ...fromParts(parts), text: sent };
}

/** The `age-at-request` extension for a read age. Sub-extensions in a fixed order. */
export function ageExtension(age: ReadAge): { url: string; extension: Record<string, unknown>[] } {
  const extension: Record<string, unknown>[] = [];
  if (age.years !== undefined) extension.push({ url: 'years', valueInteger: age.years });
  if (age.days !== undefined) extension.push({ url: 'days', valueInteger: age.days });
  if (age.daysEstimated) extension.push({ url: 'daysEstimated', valueBoolean: true });
  if (age.source) extension.push({ url: 'source', valueAge: { ...age.source } });
  if (age.text !== undefined) extension.push({ url: 'text', valueString: age.text });
  return { url: AGE_EXTENSION_URL, extension };
}
