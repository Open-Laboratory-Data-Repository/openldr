import type { FormField } from './schema/form-schema';
import { resolveFhirPath } from './fhir-path';

/**
 * Suggested codes for a field in the form builder (spec S7, row A7). Pure. Ported from corlix
 * `apps/desktop/src/renderer/lib/codeSuggestions.ts` and the counting half of
 * `main/code-suggestions.ts`, with two sources instead of three: a bound ValueSet's stored codes,
 * and the codes other forms put on the same FHIR path.
 */

export type CodeSuggestionSource = 'binding' | 'your-forms';

export interface CodeSuggestion {
  system: string;
  code: string;
  display: string | null;
  source: CodeSuggestionSource;
  /** How many other forms put this code on the path. Absent when none do. */
  count?: number;
  /** Whether CE holds the code as a term. Adding one it lacks writes a term. */
  inTerminology: boolean;
}

export interface TalliedCode {
  system: string;
  code: string;
  display: string | null;
  count: number;
}

export interface SuggestionForm {
  id: string;
  fhirResourceType: string | null | undefined;
  schema: { fields?: readonly Pick<FormField, 'fhirPath' | 'code'>[] };
}

export function codingKey(system: string, code: string): string {
  return `${system}|${code}`;
}

/**
 * Every code other forms put on `path`, with the number of forms that use it. A form counts once
 * per code, however many of its fields carry it, so the number means "used in N forms". Each
 * field's path is resolved with its form's resource type, because CE has bare and prefixed paths
 * (`fhir-path.ts`). `path` must already be resolved.
 */
export function tallyFormCodes(forms: readonly SuggestionForm[], path: string, excludeFormId?: string | null): TalliedCode[] {
  const rows = new Map<string, TalliedCode>();
  for (const form of forms) {
    if (excludeFormId && form.id === excludeFormId) continue;
    const fields = Array.isArray(form.schema?.fields) ? form.schema.fields : [];
    const seen = new Set<string>();
    for (const field of fields) {
      if (resolveFhirPath(field.fhirPath, form.fhirResourceType) !== path) continue;
      for (const c of field.code ?? []) {
        if (!c.system || !c.code) continue;
        const key = codingKey(c.system, c.code);
        let row = rows.get(key);
        if (!row) {
          row = { system: c.system, code: c.code, display: null, count: 0 };
          rows.set(key, row);
        }
        if (!row.display && c.display) row.display = c.display;
        if (!seen.has(key)) {
          seen.add(key);
          row.count += 1;
        }
      }
    }
  }
  return [...rows.values()];
}

/** Code-point order, so the ranking does not change with the server's locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One list, by count, highest first, then by code, then by system. So every code other forms use
 * comes before every binding code no form uses (operator ruling, 2026-09-14). A code in both
 * sources is listed once, as Binding, with its count, and ranks by that count. `known` holds
 * `codingKey`s of the codes CE holds as terms.
 */
export function rankCodeSuggestions(input: {
  binding: readonly { system: string; code: string; display: string | null }[];
  yourForms: readonly TalliedCode[];
  known: ReadonlySet<string>;
}): CodeSuggestion[] {
  const tallies = new Map(input.yourForms.map((t) => [codingKey(t.system, t.code), t]));
  const out = new Map<string, CodeSuggestion>();
  for (const b of input.binding) {
    const key = codingKey(b.system, b.code);
    if (out.has(key)) continue;
    const tally = tallies.get(key);
    out.set(key, {
      system: b.system,
      code: b.code,
      display: b.display ?? tally?.display ?? null,
      source: 'binding',
      ...(tally ? { count: tally.count } : {}),
      inTerminology: input.known.has(key),
    });
  }
  for (const t of input.yourForms) {
    const key = codingKey(t.system, t.code);
    if (out.has(key)) continue;
    out.set(key, { system: t.system, code: t.code, display: t.display, source: 'your-forms', count: t.count, inTerminology: input.known.has(key) });
  }
  return [...out.values()].sort((a, b) =>
    (b.count ?? 0) - (a.count ?? 0)
    || compare(a.code, b.code)
    || compare(a.system, b.system));
}

/**
 * What the panel draws: the ranked rows minus the codes already on the field, with binding codes
 * no form uses capped at `limit`. A bound set can hold thousands of codes, and without the cap
 * the panel would draw them all. A row with a count is never hidden. `hidden` is how many were
 * left out.
 */
export function offerSuggestions(
  rows: readonly CodeSuggestion[],
  held: readonly { system: string; code: string }[],
  limit: number,
): { shown: CodeSuggestion[]; hidden: number } {
  const heldKeys = new Set(held.map((c) => codingKey(c.system, c.code)));
  const shown: CodeSuggestion[] = [];
  let uncounted = 0;
  let hidden = 0;
  for (const row of rows) {
    if (heldKeys.has(codingKey(row.system, row.code))) continue;
    if (row.count === undefined) {
      if (uncounted >= limit) {
        hidden += 1;
        continue;
      }
      uncounted += 1;
    }
    shown.push(row);
  }
  return { shown, hidden };
}
