import { describe, it, expect } from 'vitest';
import { isValidIanaZone, isSignedOffsetZone, paramFormatMessage } from './param-format';

/**
 * The measured defect this module exists for.
 *
 * The monthly LIS transmission grid takes `month` (YYYY-MM) and `tz` (an IANA zone) as RUN
 * parameters. Neither was checked. An operator typed `1` and `+3`. Measured on live Postgres, for
 * an arrival at 2026-08-06 03:48Z:
 *
 *   `1`  as month → hard error, `invalid input syntax for type date: "1-01"`
 *   `+3` as tz    → 2026-08-06 00:48 — SILENT, and six hours out in the WRONG direction
 *   `Africa/Dar_es_Salaam` → 2026-08-06 06:48 (correct)
 *   `UTC`                  → 2026-08-06 03:48 (correct)
 *
 * Postgres reads a bare `+3` with the POSIX sign convention, so it means UTC−3, not UTC+3. For an
 * arrival near midnight that puts the mark on the wrong day, with nothing on the page to show it.
 */
describe('isValidIanaZone', () => {
  // Same function the lab.timezone SETTING is guarded with (packages/config/src/lab-identity.ts).
  // It lives here so the setting and the run parameter cannot drift apart.
  it('accepts a real zone name', () => {
    expect(isValidIanaZone('Africa/Dar_es_Salaam')).toBe(true);
    expect(isValidIanaZone('Africa/Nairobi')).toBe(true);
  });

  it('accepts UTC', () => {
    expect(isValidIanaZone('UTC')).toBe(true);
  });

  it('rejects a fixed offset, signed or colon-padded', () => {
    // A fixed offset cannot express daylight saving, so a report spanning a DST boundary buckets
    // half its days an hour out. `+03:00` is the one this runtime's ICU would otherwise ACCEPT —
    // measured: `new Intl.DateTimeFormat('en-US', { timeZone: '+03:00' })` does not throw — which
    // is why the explicit sign guard exists rather than leaning on Intl alone.
    expect(isValidIanaZone('+3')).toBe(false);
    expect(isValidIanaZone('-3')).toBe(false);
    expect(isValidIanaZone('+03:00')).toBe(false);
  });

  it('⛔ rejects the Etc/GMT spelling of a fixed offset, which Intl resolves', () => {
    // The gap this rule used to have, and its own doc comment used to admit. `Intl` resolves
    // `Etc/GMT+3` — measured, `new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+3' })` does
    // not throw — so an Intl-only check stored it happily. IANA defines that name as UTC−3, the
    // opposite of what almost everyone typing it means, and a SETTING is reused unseen on every
    // later run. It is also the last spelling of a FIXED OFFSET the setting still accepted, so
    // refusing it makes the existing "no fixed offset" rule consistent rather than newly strict.
    expect(isValidIanaZone('Etc/GMT+3')).toBe(false);
    expect(isValidIanaZone('Etc/GMT-3')).toBe(false);
    expect(isValidIanaZone('etc/gmt+3')).toBe(false);
    expect(isValidIanaZone('Etc/GMT+0')).toBe(false);
  });

  it('still accepts Etc/UTC, which carries no sign', () => {
    // The rejection above must be the SIGN, not the `Etc/` prefix. `Etc/UTC` and `Etc/Greenwich`
    // are ordinary named zones and stay usable.
    expect(isValidIanaZone('Etc/UTC')).toBe(true);
    expect(isValidIanaZone('Etc/Greenwich')).toBe(true);
  });

  it('rejects a typo in a real zone name', () => {
    expect(isValidIanaZone('Africa/Dar-es-Salaam')).toBe(false);
  });

  it('rejects things that are not zones at all', () => {
    expect(isValidIanaZone('1')).toBe(false);
    expect(isValidIanaZone('March 2026')).toBe(false);
    expect(isValidIanaZone('2026-08')).toBe(false);
  });
});

/**
 * The RUN-parameter rule is DELIBERATELY narrower than the setting's rule above.
 *
 * It rejects only the values that are wrong WITHOUT SAYING SO. Measured on live Postgres, for
 * `2026-08-06 03:48Z`:
 *
 *   +3          → 00:48   silent, inverted (POSIX sign convention: `+3` means UTC−3)
 *   +03:00      → 00:48   silent, inverted — and `Intl.DateTimeFormat` ACCEPTS this one
 *   Etc/GMT+3   → 00:48   silent, inverted — an IANA-shaped name for the same defect
 *   Etc/GMT-3   → 06:48   silent, inverted
 *   Africa/Dar_es_Salaam → 06:48   correct
 *   UTC                  → 03:48   correct
 *   E. Africa Standard Time → ERROR: time zone "…" not recognized   LOUD
 *
 * An unrecognised zone name is not the defect being guarded. Postgres refuses it immediately with
 * a clear message, so the operator learns at once. A sign-inverted offset produces a COMPLETE,
 * PLAUSIBLE, six-hours-wrong report with nothing on the page to show it happened.
 *
 * Guarding the loud case as well would cost a documented workflow: `apps/studio/src/docs/0.1.0/en/
 * reports.md:51` tells SQL Server operators to leave the setting empty and type the WINDOWS zone
 * name into this very filter, because `AT TIME ZONE` on SQL Server takes Windows names.
 */
describe('isSignedOffsetZone', () => {
  it('catches a bare and a colon-padded offset', () => {
    expect(isSignedOffsetZone('+3')).toBe(true);
    expect(isSignedOffsetZone('-3')).toBe(true);
    expect(isSignedOffsetZone('+03:00')).toBe(true);
  });

  it('⛔ catches the Etc/GMT spelling, which wears an IANA-shaped name', () => {
    // The case the first version of this rule MISSED: `Intl.DateTimeFormat` resolves `Etc/GMT+3`
    // happily, so an IANA-validity check waves through exactly the same inversion it was written
    // to stop.
    expect(isSignedOffsetZone('Etc/GMT+3')).toBe(true);
    expect(isSignedOffsetZone('Etc/GMT-3')).toBe(true);
  });

  it('matches the Etc/GMT spelling case-insensitively', () => {
    expect(isSignedOffsetZone('etc/gmt+3')).toBe(true);
    expect(isSignedOffsetZone('ETC/GMT-5')).toBe(true);
  });

  it('catches Etc/GMT+0 and Etc/GMT-0, which are pointless rather than inverted', () => {
    // Zero does not invert, so these are harmless — and still refused. Keeping the rule to one
    // regex with no exception is worth more than accepting a spelling of `UTC` that carries a sign
    // a reader has to know not to trust.
    expect(isSignedOffsetZone('Etc/GMT+0')).toBe(true);
    expect(isSignedOffsetZone('Etc/GMT-0')).toBe(true);
  });

  it('leaves real zone names, Windows zone names and plain nonsense alone', () => {
    expect(isSignedOffsetZone('Africa/Dar_es_Salaam')).toBe(false);
    expect(isSignedOffsetZone('UTC')).toBe(false);
    expect(isSignedOffsetZone('Etc/UTC')).toBe(false);
    expect(isSignedOffsetZone('E. Africa Standard Time')).toBe(false);
    expect(isSignedOffsetZone('Africa/Dar-es-Salaam')).toBe(false);
  });
});

describe('paramFormatMessage — timezone-no-signed-offset', () => {
  const check = (v: string) => paramFormatMessage('tz', 'timezone-no-signed-offset', v);

  it.each(['UTC', 'Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Etc/UTC'])('accepts %s', (v) => {
    expect(check(v)).toBeNull();
  });

  it('accepts a Windows zone name, so the SQL Server workflow keeps working', () => {
    // ⛔ This is the value the docs tell a SQL Server operator to type. It is NOT valid IANA, and
    // the first version of this rule refused it. Postgres will refuse it loudly if it ever reaches
    // a Postgres warehouse, which is the correct place for that argument to happen.
    expect(check('E. Africa Standard Time')).toBeNull();
  });

  it('accepts an unrecognised name, leaving the engine to refuse it loudly', () => {
    expect(check('Africa/Dar-es-Salaam')).toBeNull();
    expect(check('March 2026')).toBeNull();
  });

  it.each(['+3', '-3', '+03:00', 'Etc/GMT+3', 'Etc/GMT-3', 'etc/gmt+3'])('rejects %s', (v) => {
    expect(check(v)).not.toBeNull();
  });

  it('names the parameter, says what is refused, and echoes what was typed', () => {
    const msg = check('+3')!;
    expect(msg).toContain('tz');
    expect(msg).toContain('offset');
    expect(msg).toContain('+3');
  });

  it('starts with the anchored prefix the route maps to a 400', () => {
    // apps/server/src/reports-routes.ts matches `^invalid parameter: ` to turn this into RP0004
    // (400) instead of the SY0500 catch-all. If this prefix changes, that mapping silently stops
    // working and a client mistake becomes a 500 again.
    expect(check('+3')).toMatch(/^invalid parameter: tz \(/);
  });
});

describe('paramFormatMessage — year-month', () => {
  const check = (v: string) => paramFormatMessage('month', 'year-month', v);

  it('accepts YYYY-MM', () => {
    expect(check('2026-08')).toBeNull();
    expect(check('2021-01')).toBeNull();
    expect(check('2026-12')).toBeNull();
  });

  it.each(['1', '+3', 'March 2026', '2026-8', '2026-13', '2026-00', '2026-08-06', 'UTC'])(
    'rejects %s', (v) => { expect(check(v)).not.toBeNull(); },
  );

  it('names the parameter and states the format', () => {
    const msg = check('1')!;
    expect(msg).toContain('month');
    expect(msg).toContain('YYYY-MM');
  });
});

describe('paramFormatMessage — empty and undeclared', () => {
  it('passes an empty value through, so the existing required check owns that error', () => {
    // `substituteParams` (packages/dashboards/src/custom-query-run.ts:33) already throws
    // `required parameter: <id>` for an empty required value, and the route maps it. Reporting a
    // FORMAT complaint for an untouched box would replace a precise error with a vaguer one.
    expect(paramFormatMessage('tz', 'timezone-no-signed-offset', '')).toBeNull();
    expect(paramFormatMessage('month', 'year-month', '')).toBeNull();
  });

  it('truncates a long value rather than echoing it whole', () => {
    const msg = paramFormatMessage('tz', 'timezone-no-signed-offset', `+${'9'.repeat(500)}`)!;
    expect(msg.length).toBeLessThan(400);
  });
});
