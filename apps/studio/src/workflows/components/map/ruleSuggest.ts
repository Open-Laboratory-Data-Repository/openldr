import { lookupBinding, lookupFhirPath } from '@openldr/fhir/paths';
import { EXCEL_DATE_FORMAT, parseTargetPath } from '@openldr/forms/pure';
import type { ExpandedCode } from '@/api';
import { codeOptionsFromLabel } from '@/forms-builder/fhirTypeMap';
import { hasSource, type RowDraft, type RuleDraft, type SampleRow, type ValuePair } from './rows';

/**
 * A rule to suggest for a row, worked out from the form of the sample's values only: digits and
 * marks, never their content. Nothing here is saved. The person accepts the rule or not, and only
 * an accepted rule enters the mapping.
 */
export type RuleSuggestion =
  | { kind: 'numberComma'; rule: RuleDraft }
  | { kind: 'date'; format: string; dayFirstGuess: boolean; rule: RuleDraft }
  | { kind: 'dateExcel'; rule: RuleDraft }
  | { kind: 'values'; rule: RuleDraft };

/** The FHIR table path of a target key: pinned values and list indexes dropped. */
function tablePath(key: string): string | null {
  const parsed = parseTargetPath(key);
  return parsed ? parsed.path.split('.').filter((s) => !/^\d+$/.test(s)).join('.') : null;
}

export function leafTypeOf(key: string): string | null {
  const p = tablePath(key);
  return p ? (lookupFhirPath(p)?.leafType ?? null) : null;
}

/** A date field: a `string` leaf whose last path segment ends in Date, DateTime, date or Time. */
export function isDateKey(key: string): boolean {
  const p = tablePath(key);
  if (!p || leafTypeOf(key) !== 'string') return false;
  const last = p.split('.').pop() ?? '';
  return /(Date|DateTime|date|Time)$/.test(last);
}

/** The value set whose codes a value must be one of: the field's own, else a required or extensible binding. */
export function codeListUrlOf(draft: RowDraft): string | null {
  if (draft.valueSet) return draft.valueSet;
  const p = tablePath(draft.targetPath);
  const b = p ? lookupBinding(p) : null;
  return b && (b.strength === 'required' || b.strength === 'extensible') ? b.valueSet : null;
}

/**
 * FHIR's own list for a `code` field with no value set, read from the path table's label (for
 * `Patient.gender`, "male | female | other | unknown"), as the forms builder reads it. Plain codes,
 * with no system, which is what a `code` field takes. Null when the label is not such a list.
 */
export function fhirListCodes(draft: RowDraft): ExpandedCode[] | null {
  if (draft.valueSet || leafTypeOf(draft.targetPath) !== 'code') return null;
  const p = tablePath(draft.targetPath);
  const info = p ? lookupFhirPath(p) : null;
  const options = info ? codeOptionsFromLabel(info.label) : null;
  return options ? options.map((o) => ({ system: '', code: o.code, display: null })) : null;
}

/** The sample's values for a row's source columns, as text, blanks left out. */
export function examplesOf(draft: RowDraft, rows: SampleRow[]): string[] {
  if (draft.source.kind !== 'field') return [];
  const out: string[] = [];
  for (const row of rows) {
    for (const f of draft.source.fields) {
      const v = row[f];
      for (const x of Array.isArray(v) ? v : [v]) {
        if (typeof x === 'string' && x.trim() !== '') out.push(x.trim());
        else if (typeof x === 'number' || typeof x === 'boolean') out.push(String(x));
      }
    }
  }
  return out;
}

/** The most lines an accepted values suggestion opens with. */
export const MAX_VALUE_LINES = 20;

/**
 * The code a sample value names: the one code whose code or display equals it, ignoring case and
 * the spaces around it. Never a match on part of a display. Null for none, or for more than one.
 */
export function codeNamedBy(value: string, codes: ExpandedCode[]): ExpandedCode | null {
  const v = value.trim().toLowerCase();
  const hits = codes.filter((c) => c.code.trim().toLowerCase() === v || (c.display ?? '').trim().toLowerCase() === v);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The lines an accepted values suggestion opens with: one per distinct sample value on the From
 * side, at most `MAX_VALUE_LINES`. The To side holds the code the value names, when one does, and
 * is empty otherwise. A picked To is marked as suggested until the person accepts it. They live on screen only: a line is saved once its To side is filled, so an
 * untouched sample value never reaches the config.
 */
export function valueLinesFor(draft: RowDraft, rows: SampleRow[], codes: ExpandedCode[] | null = null): ValuePair[] {
  return [...new Set(examplesOf(draft, rows))].slice(0, MAX_VALUE_LINES).map((from) => {
    const hit = codes ? codeNamedBy(from, codes) : null;
    return hit ? { from, to: hit.code, ...(hit.system ? { system: hit.system } : {}), suggested: true } : { from, to: '' };
  });
}

const DAY_MS = 86_400_000;
/** The Excel 1900-system day number of a date from 1 March 1900 on. */
const excelSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / DAY_MS;
const EXCEL_FROM = excelSerial(1950, 1, 1);
const EXCEL_TO = excelSerial(2100, 1, 1);

/** Whether every example is a plain number between the Excel day numbers of 1950-01-01 and 2100-01-01. */
export function looksLikeExcelDates(examples: string[]): boolean {
  return examples.length > 0 && examples.every((e) => /^\d+(?:\.\d+)?$/.test(e) && Number(e) >= EXCEL_FROM && Number(e) <= EXCEL_TO);
}

const DATE_RE = /^(\d{1,4})([/.-])(\d{1,2})([/.-])(\d{1,4})$/;

/**
 * A date format that reads every example, from the tokens `d dd M MM yy yyyy` and one of `/ - .`.
 * Null when one does not fit, or when the values are already `yyyy-MM-dd`. When day and month cannot
 * be told apart, the format puts the day first and `dayFirstGuess` is true.
 */
export function dateFormatOf(examples: string[]): { format: string; dayFirstGuess: boolean } | null {
  if (examples.length === 0) return null;
  const parts: [string, string, string][] = [];
  let sep: string | null = null;
  for (const e of examples) {
    const m = DATE_RE.exec(e);
    if (!m || m[2] !== m[4]) return null;
    if (sep !== null && sep !== m[2]) return null;
    sep = m[2];
    parts.push([m[1], m[3], m[5]]);
  }
  const widths = (i: number) => new Set(parts.map((p) => p[i].length));
  const yearFirst = parts.every((p) => p[0].length === 4);
  if (yearFirst) {
    if (sep === '-' && parts.every((p) => p[1].length === 2 && p[2].length === 2)) return null; // already ISO
    const mm = widths(1).size === 1 && widths(1).has(2) ? 'MM' : 'M';
    const dd = widths(2).size === 1 && widths(2).has(2) ? 'dd' : 'd';
    if (parts.some((p) => Number(p[1]) > 12)) return null;
    return { format: `yyyy${sep}${mm}${sep}${dd}`, dayFirstGuess: false };
  }
  const yw = widths(2);
  if (yw.size !== 1 || !(yw.has(2) || yw.has(4))) return null;
  if (parts.some((p) => p[0].length > 2)) return null;
  const year = yw.has(4) ? 'yyyy' : 'yy';
  const firstOver = parts.some((p) => Number(p[0]) > 12);
  const secondOver = parts.some((p) => Number(p[1]) > 12);
  if (firstOver && secondOver) return null;
  const monthFirst = secondOver && !firstOver;
  const tok = (i: number, t: 'd' | 'M') => (widths(i).size === 1 && widths(i).has(2) ? `${t}${t}` : t);
  const first = tok(0, monthFirst ? 'M' : 'd');
  const second = tok(1, monthFirst ? 'd' : 'M');
  return { format: `${first}${sep}${second}${sep}${year}`, dayFirstGuess: !firstOver && !secondOver };
}

/**
 * The rule to suggest for a row that has a source and no rule, or null.
 * `codes` is the row's code list when one applies: a Set once loaded, null while unknown.
 */
export function suggestRuleFor(draft: RowDraft, rows: SampleRow[], codes: Set<string> | null): RuleSuggestion | null {
  if (!hasSource(draft) || draft.source.kind !== 'field' || draft.rule.kind !== 'none') return null;
  const examples = examplesOf(draft, rows);
  if (examples.length === 0) return null;

  if (leafTypeOf(draft.targetPath) === 'number') {
    const ok = examples.every((e) => /^[+-]?\d+(,\d+)?$/.test(e)) && examples.some((e) => e.includes(','));
    return ok ? { kind: 'numberComma', rule: { kind: 'number', decimal: ',' } } : null;
  }
  if (isDateKey(draft.targetPath)) {
    if (looksLikeExcelDates(examples)) return { kind: 'dateExcel', rule: { kind: 'date', format: EXCEL_DATE_FORMAT } };
    const d = dateFormatOf(examples);
    return d ? { kind: 'date', format: d.format, dayFirstGuess: d.dayFirstGuess, rule: { kind: 'date', format: d.format } } : null;
  }
  if (codes && codes.size > 0 && examples.some((e) => !codes.has(e))) {
    // No lines here. The sheet fills them on Accept, on screen only (`valueLinesFor`).
    return { kind: 'values', rule: { kind: 'values', pairs: [] } };
  }
  return null;
}
