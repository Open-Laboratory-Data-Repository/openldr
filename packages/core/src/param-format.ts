/**
 * Declared formats for a value an operator types into a report's run parameter, and the one
 * function that judges them.
 *
 * ⛔ Why this lives in `@openldr/core/pure` rather than beside either caller.
 *
 * The IANA rule already existed, guarding the `lab.timezone` SETTING
 * (`packages/config/src/lab-identity.ts`). The transmission grid's `tz` RUN PARAMETER is the same
 * question asked at a different moment, and the report's own help text says a scheduled run does
 * not read the setting — so the run parameter is the path that can get it wrong unattended. Two
 * copies of the rule would drift, and the drift would be invisible: both copies would keep
 * accepting `Africa/Nairobi`, and only disagree on the values that actually bite.
 *
 * `@openldr/config` already depends on `@openldr/core`, and so do `@openldr/report-designer` and
 * `@openldr/bootstrap`. It is the only package all of them already share, so nothing here needs a
 * new dependency edge. `pure` (not `index`) because that entry is guaranteed free of Node
 * built-ins, which keeps this importable from studio code later without breaking the bundle.
 *
 * ⛔ Deliberately NOT a zod refinement on `TemplateParamSchema`. `fromRow`
 * (`packages/report-designer/src/store.ts`) parses every STORED design on READ, so a refinement
 * would make an already-saved design permanently unopenable — the rule `image-src.ts` records.
 * This is checked at RUN time, on the value, never on the design.
 */

/** The formats a report parameter may declare. Additive: a parameter that declares none is not
 *  checked at all, which is every parameter stored before this existed. */
export type ReportParamFormat = 'iana-timezone' | 'year-month';

export const REPORT_PARAM_FORMATS: readonly ReportParamFormat[] = ['iana-timezone', 'year-month'];

/**
 * True for a zone name the runtime's own IANA database resolves. Deliberately NOT a hand-written
 * list, so it stays correct as zones are added or renamed.
 *
 * ⛔ A fixed offset is rejected. Two reasons, and the second is the one that was measured:
 *
 * 1. An offset cannot express daylight saving, so a report spanning a DST boundary buckets half
 *    its days an hour out.
 * 2. Postgres reads a bare `+3` with the POSIX sign convention, so `AT TIME ZONE '+3'` means
 *    UTC−3. Measured on live Postgres: an arrival at 2026-08-06 03:48Z bucketed to
 *    2026-08-06 00:48 — six hours out, in the WRONG direction, and silent. `Africa/Dar_es_Salaam`
 *    gave 06:48 and `UTC` gave 03:48, both correct.
 *
 * The explicit sign test is not redundant with the `Intl` call. Measured on this runtime: bare
 * `+3` makes `Intl.DateTimeFormat` throw, but `+03:00` does NOT — ICU resolves it as a legal
 * `timeZone`. No real IANA zone id starts with a sign, so the test costs nothing correct.
 */
export function isValidIanaZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A calendar month, `YYYY-MM`. The month part is range-checked here because the engine's own
 *  complaint about `2026-13` arrives as a Postgres date-parse error in a 500. */
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What each format accepts, in the words the operator gets back. */
const EXPECTATION: Record<ReportParamFormat, string> = {
  'iana-timezone':
    'expected an IANA time zone name, for example Africa/Nairobi or UTC. '
    + 'A fixed offset such as +3 is not accepted: it cannot express daylight saving, '
    + 'and the database reads its sign the other way round',
  'year-month': 'expected a calendar month as YYYY-MM, for example 2026-08',
};

function accepts(format: ReportParamFormat, value: string): boolean {
  switch (format) {
    case 'iana-timezone': return isValidIanaZone(value);
    case 'year-month': return YEAR_MONTH.test(value);
  }
}

/** Longest slice of the operator's own value echoed back. Bounded so a pasted blob cannot become
 *  the error message (which is logged, and rendered in a toast). */
const ECHO_MAX = 40;

/**
 * `null` when `value` satisfies `format`; otherwise the operator-facing message to throw.
 *
 * ⛔ The `invalid parameter: ` prefix is load-bearing. `apps/server/src/reports-routes.ts` matches
 * it ANCHORED to map the throw onto catalog code RP0004 — a 400 naming the field — instead of the
 * SY0500 catch-all, which renders in the studio as nothing but "failed: 500". Change the prefix
 * here and that mapping silently stops working; `reports-routes.test.ts` pins it from the other
 * side.
 *
 * An EMPTY value returns `null` on purpose. `substituteParams`
 * (`packages/dashboards/src/custom-query-run.ts:33`) already throws `required parameter: <id>` for
 * an untouched required box, and that message is both more precise and already mapped. Reporting a
 * format complaint instead would replace a good error with a worse one.
 */
export function paramFormatMessage(id: string, format: ReportParamFormat, value: string): string | null {
  if (value === '') return null;
  if (accepts(format, value)) return null;
  const echoed = value.length > ECHO_MAX ? `${value.slice(0, ECHO_MAX)}…` : value;
  return `invalid parameter: ${id} (${EXPECTATION[format]}; got "${echoed}")`;
}
