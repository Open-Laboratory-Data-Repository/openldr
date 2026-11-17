import { lookupBinding, lookupFhirPath } from '@openldr/fhir/paths';
import { parseTargetPath } from '@openldr/forms/pure';
import { hasSource, type RowDraft, type RuleDraft, type SampleRow } from './rows';

/**
 * A rule to suggest for a row, worked out from the form of the sample's values only: digits and
 * marks, never their content. Nothing here is saved. The person accepts the rule or not, and only
 * an accepted rule enters the mapping.
 */
export type RuleSuggestion =
  | { kind: 'numberComma'; rule: RuleDraft }
  | { kind: 'date'; format: string; dayFirstGuess: boolean; rule: RuleDraft }
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
    const d = dateFormatOf(examples);
    return d ? { kind: 'date', format: d.format, dayFirstGuess: d.dayFirstGuess, rule: { kind: 'date', format: d.format } } : null;
  }
  if (codes && codes.size > 0 && examples.some((e) => !codes.has(e))) {
    // No lines: a line per sample value would put sample values into the mapping.
    return { kind: 'values', rule: { kind: 'values', pairs: [] } };
  }
  return null;
}
