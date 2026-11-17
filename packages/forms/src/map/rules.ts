import type { Coding } from 'fhir/r4';
import { z } from 'zod';

/**
 * The rules a mapping row can run on a source value before it is written. A rule failure names the
 * source field and what was expected. It never carries the value: reasons reach logs and audit rows.
 */

/** The date rule's format for an Excel date cell: a day number in Excel's 1900 date system. */
export const EXCEL_DATE_FORMAT = 'excel';

export const MapRuleSchema = z.discriminatedUnion('kind', [
  /** `format` is a pattern of `d dd M MM yy yyyy`, or `excel` for an Excel date cell. */
  z.object({ kind: z.literal('date'), format: z.string().min(1) }),
  z.object({
    kind: z.literal('values'),
    /** Each source value to a text, or to a code picked from a value set, with its system. */
    map: z.record(z.union([z.string(), z.object({ system: z.string().min(1), code: z.string().min(1) }).strict()])),
  }),
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
  /**
   * A number when the Number rule reads it, else the value as sent, as text. Only on a result
   * field that also has a text form; the mapping writes the text there (`textKeyOf` in apply.ts).
   */
  z.object({ kind: z.literal('numberOrText'), decimal: z.enum([',', '.']) }),
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

const DAY_MS = 86_400_000;
/** 9999-12-31 in Excel's 1900 system, the last day it holds. */
const EXCEL_LAST_SERIAL = 2_958_465;

/**
 * An Excel date cell: a day number in the 1900 date system, as a number or a plain-number text.
 * Excel counts a 29 February 1900 that never was as serial 60, so serial 61 is 1 March 1900 and
 * every serial from 61 on is one more than the true day count. A time part is dropped, never
 * rounded. Whole days in UTC, so no time zone moves a day. The 1904 system is not read.
 */
function applyExcelDate(value: string | number | boolean, field: string): RuleResult {
  const text = typeof value === 'string' ? value.trim() : '';
  const n = typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
  if (!Number.isFinite(n) || n < 1 || n >= EXCEL_LAST_SERIAL + 1) return fail(field, 'expected an Excel date cell, a day number');
  const serial = Math.floor(n);
  if (serial === 60) return fail(field, 'expected a real calendar date');
  const days = serial < 60 ? serial - 1 : serial - 2; // days after 1900-01-01
  const date = new Date(Date.UTC(1900, 0, 1) + days * DAY_MS);
  const pad = (x: number, w: number) => String(x).padStart(w, '0');
  return { ok: true, value: `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` };
}

const MAX_WHOLE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * True for a whole number, as text, that a number cannot hold exactly: past 9007199254740991 a
 * 64-bit float changes its last digits. Such a value is refused as a number, never rounded. A text
 * field keeps every digit.
 */
export function wholeNumberTooLong(text: string): boolean {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) return false;
  const n = BigInt(t.replace(/^\+/, ''));
  return n > MAX_WHOLE || n < -MAX_WHOLE;
}

export const TOO_LONG_FOR_NUMBER = 'has more digits than a number can hold exactly';

function applyNumber(decimal: ',' | '.', value: string | number | boolean, field: string): RuleResult {
  if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : fail(field, 'expected a number');
  const text = String(value).trim();
  if (wholeNumberTooLong(text)) return fail(field, TOO_LONG_FOR_NUMBER);
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
      if (rule.format === EXCEL_DATE_FORMAT) return applyExcelDate(value, field);
      return applyDate(rule.format, text, field, deps.now ?? new Date());
    case 'values': {
      const key = text.trim();
      if (!Object.hasOwn(rule.map, key)) return fail(field, 'value is not in the translation list');
      const to = rule.map[key];
      // A coded value gives a Coding: a CodeableConcept keeps its system, a code field takes its code.
      return { ok: true, value: typeof to === 'string' ? to : { system: to.system, code: to.code } };
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
    case 'numberOrText':
      return applyNumber(rule.decimal, value, field);
  }
}
