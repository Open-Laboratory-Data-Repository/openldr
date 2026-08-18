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
export type ReportParamFormat = 'timezone-no-signed-offset' | 'year-month';

export const REPORT_PARAM_FORMATS: readonly ReportParamFormat[] = ['timezone-no-signed-offset', 'year-month'];

/**
 * ⚠ TWO rules live in this file, and the difference between them is deliberate. Do not "unify"
 * them.
 *
 *   `isValidIanaZone`     — strict. Guards the `lab.timezone` SETTING.
 *   `isSignedOffsetZone`  — narrow. Guards a report's `tz` RUN PARAMETER.
 *
 * A stored SETTING is reused silently on every future run, across every engine, by people who did
 * not type it. Strictness there is cheap and right, and `lab-identity.ts` explains it further.
 *
 * A RUN PARAMETER is typed for one run by someone watching the result. The only failure worth
 * blocking there is the one that is WRONG WITHOUT SAYING SO — see `isSignedOffsetZone`.
 */

/**
 * True for a zone name the runtime's own IANA database resolves. Deliberately NOT a hand-written
 * list, so it stays correct as zones are added or renamed.
 *
 * ⛔ A fixed offset is rejected. An offset cannot express daylight saving, so a report spanning a
 * DST boundary buckets half its days an hour out — and see `isSignedOffsetZone` for the sharper
 * problem with its sign.
 *
 * The explicit sign test is not redundant with the `Intl` call. Measured on this runtime: bare
 * `+3` makes `Intl.DateTimeFormat` throw, but `+03:00` does NOT — ICU resolves it as a legal
 * `timeZone`. No real IANA zone id starts with a sign, so the test costs nothing correct.
 *
 * ⚠ Used ONLY by the `lab.timezone` setting. It is NOT the run-parameter rule: it refuses a
 * Windows zone name, which SQL Server installs are documented to need
 * (`apps/studio/src/docs/0.1.0/en/reports.md:51`), and it ACCEPTS `Etc/GMT+3`, which is inverted.
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

/**
 * True for a time zone written as a SIGNED OFFSET, in any spelling. This is the one class of `tz`
 * value worth refusing at run time, because it is wrong without saying so.
 *
 * Measured on live Postgres, `2026-08-06 03:48:00+00 AT TIME ZONE <value>`:
 *
 *   +3                      → 2026-08-06 00:48   silent, inverted
 *   +03:00                  → 2026-08-06 00:48   silent, inverted (and `Intl` ACCEPTS this)
 *   Etc/GMT+3               → 2026-08-06 00:48   silent, inverted (and `Intl` ACCEPTS this)
 *   Etc/GMT-3               → 2026-08-06 06:48   silent, inverted
 *   Africa/Dar_es_Salaam    → 2026-08-06 06:48   correct
 *   UTC                     → 2026-08-06 03:48   correct
 *   E. Africa Standard Time → ERROR: time zone "E. Africa Standard Time" not recognized
 *
 * Postgres reads the sign with the POSIX convention, so `+3` means UTC−3. The report still comes
 * out complete and plausible, six hours off, with an arrival near midnight marked on the wrong
 * day and nothing on the page to show it. `Etc/GMT+3` is that same defect wearing an IANA-shaped
 * name — which is exactly why an IANA-validity check is the WRONG guard here: it waves `Etc/GMT+3`
 * through and blocks the Windows names a SQL Server install needs.
 *
 * ⛔ Do NOT widen this to "everything the runtime cannot resolve". An unrecognised zone is the
 * LOUD case: the engine refuses it immediately with a clear message, so the operator finds out at
 * once and no wrong number is ever produced. Widening buys nothing and costs the documented SQL
 * Server workflow at `apps/studio/src/docs/0.1.0/en/reports.md:51`, where the operator is told to
 * type a WINDOWS zone name into this filter.
 *
 * `Etc/GMT+0` and `Etc/GMT-0` are refused too. Zero does not invert, so they are pointless rather
 * than dangerous — but keeping this to a single regex with no exception is worth more than
 * accepting a spelling of `UTC` that carries a sign a reader must know not to trust.
 */
export function isSignedOffsetZone(value: string): boolean {
  return /^[+-]/.test(value) || /^Etc\/GMT[+-]/i.test(value);
}

/** A calendar month, `YYYY-MM`. The month part is range-checked here because the engine's own
 *  complaint about `2026-13` arrives as a Postgres date-parse error in a 500. */
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What each format accepts, in the words the operator gets back. */
const EXPECTATION: Record<ReportParamFormat, string> = {
  'timezone-no-signed-offset':
    'expected a named time zone, for example Africa/Nairobi or UTC. '
    + 'A signed offset such as +3, +03:00 or Etc/GMT+3 is not accepted: the database reads its '
    + 'sign the other way round, so the report comes out shifted with no error to show it',
  'year-month': 'expected a calendar month as YYYY-MM, for example 2026-08',
};

function accepts(format: ReportParamFormat, value: string): boolean {
  switch (format) {
    // Refuse ONLY the silent-inversion spellings. An unrecognised name is left for the engine to
    // refuse loudly — see `isSignedOffsetZone` for why that asymmetry is the point.
    case 'timezone-no-signed-offset': return !isSignedOffsetZone(value);
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
