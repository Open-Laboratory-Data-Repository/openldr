import type { Coding } from 'fhir/r4';
import { z } from 'zod';

/**
 * The rules a mapping row can run on a source value before it is written. A rule failure names the
 * source field and what was expected. It never carries the value: reasons reach logs and audit rows.
 */

export const MapRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), format: z.string().min(1) }),
  z.object({ kind: z.literal('values'), map: z.record(z.string()) }),
  z.object({
    kind: z.literal('codeList'),
    conceptMapUrl: z.string().min(1),
    /** Only to break a tie when the map holds the same code from two source systems. */
    sourceSystem: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('split'),
    by: z.string().min(1),
    take: z.union([z.literal('first'), z.literal('last'), z.number().int().nonnegative()]),
  }),
  z.object({ kind: z.literal('trim') }),
  z.object({ kind: z.literal('number'), decimal: z.enum([',', '.']) }),
]);
export type MapRule = z.infer<typeof MapRuleSchema>;

/** A value a rule gives: text, a number, or a coding from a code list. */
export type MapValue = string | number | boolean | Coding;

export type RuleResult = { ok: true; value: MapValue } | { ok: false; reason: string; field: string };

export interface RuleDeps {
  /** The coding a code list gives for a value; null for no match, `'several'` for more than one. */
  translateCode(conceptMapUrl: string, value: string, sourceSystem?: string): Promise<Coding | null | 'several'>;
  /** Today, for two-digit years. Defaults to the current date. */
  now?: Date;
}

function fail(field: string, expected: string): RuleResult {
  return { ok: false, reason: `${field}: ${expected}`, field };
}

const DATE_TOKENS: Record<string, { part: 'd' | 'M' | 'y'; re: string }> = {
  d: { part: 'd', re: '(\\d{1,2})' },
  dd: { part: 'd', re: '(\\d{2})' },
  M: { part: 'M', re: '(\\d{1,2})' },
  MM: { part: 'M', re: '(\\d{2})' },
  yy: { part: 'y', re: '(\\d{2})' },
  yyyy: { part: 'y', re: '(\\d{4})' },
};

/** The format as a regex and the part each group holds, or null when it is not supported. */
function compileDateFormat(format: string): { re: RegExp; parts: ('d' | 'M' | 'y')[]; twoDigitYear: boolean } | null {
  let source = '';
  const parts: ('d' | 'M' | 'y')[] = [];
  let twoDigitYear = false;
  for (const piece of format.match(/[a-zA-Z]+|[^a-zA-Z]+/g) ?? []) {
    if (/^[a-zA-Z]/.test(piece)) {
      const token = DATE_TOKENS[piece];
      if (!token || parts.includes(token.part)) return null;
      parts.push(token.part);
      if (piece === 'yy') twoDigitYear = true;
      source += token.re;
    } else {
      source += piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (parts.length !== 3) return null;
  return { re: new RegExp(`^${source}$`), parts, twoDigitYear };
}

/** The latest year ending in `yy` that is not after the current year. */
function fullYear(yy: number, now: Date): number {
  const max = now.getUTCFullYear();
  return max - ((((max - yy) % 100) + 100) % 100);
}

function applyDate(format: string, value: string, field: string, now: Date): RuleResult {
  const compiled = compileDateFormat(format);
  if (!compiled) return fail(field, 'unsupported date format');
  const m = compiled.re.exec(value.trim());
  if (!m) return fail(field, `expected a date in the format ${format}`);
  const got: Record<'d' | 'M' | 'y', number> = { d: 0, M: 0, y: 0 };
  compiled.parts.forEach((p, i) => (got[p] = Number(m[i + 1])));
  const year = compiled.twoDigitYear ? fullYear(got.y, now) : got.y;
  const date = new Date(Date.UTC(year, got.M - 1, got.d));
  // Date.UTC rolls 31/02 into March; a date that does not read back the same is impossible.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== got.M - 1 || date.getUTCDate() !== got.d) {
    return fail(field, 'expected a real calendar date');
  }
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return { ok: true, value: `${pad(year, 4)}-${pad(got.M, 2)}-${pad(got.d, 2)}` };
}

function applyNumber(decimal: ',' | '.', value: string | number | boolean, field: string): RuleResult {
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : fail(field, 'expected a number');
  const text = String(value).trim();
  const re = decimal === ',' ? /^[+-]?\d+(?:,\d+)?$/ : /^[+-]?\d+(?:\.\d+)?$/;
  if (!re.test(text)) return fail(field, `expected a number with ${decimal === ',' ? 'a comma' : 'a point'} as the decimal mark`);
  return { ok: true, value: Number(text.replace(',', '.')) };
}

export async function applyRule(
  rule: MapRule,
  value: string | number | boolean,
  field: string,
  deps: RuleDeps,
): Promise<RuleResult> {
  const text = String(value);
  switch (rule.kind) {
    case 'date':
      return applyDate(rule.format, text, field, deps.now ?? new Date());
    case 'values': {
      const key = text.trim();
      return Object.hasOwn(rule.map, key) ? { ok: true, value: rule.map[key] } : fail(field, 'value is not in the translation list');
    }
    case 'codeList': {
      const coding = await deps.translateCode(rule.conceptMapUrl, text.trim(), rule.sourceSystem);
      if (coding === 'several') return fail(field, 'more than one match in the code list');
      return coding ? { ok: true, value: coding } : fail(field, 'value has no match in the code list');
    }
    case 'split': {
      const parts = text.split(rule.by);
      const i = rule.take === 'first' ? 0 : rule.take === 'last' ? parts.length - 1 : rule.take;
      return i < parts.length ? { ok: true, value: parts[i] } : fail(field, `expected at least ${i + 1} parts`);
    }
    case 'trim':
      return { ok: true, value: text.trim() };
    case 'number':
      return applyNumber(rule.decimal, value, field);
  }
}
