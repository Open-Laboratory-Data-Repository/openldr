import { describe, it, expect } from 'vitest';
import { isValidIanaZone, paramFormatMessage } from './param-format';

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

  it('rejects a typo in a real zone name', () => {
    expect(isValidIanaZone('Africa/Dar-es-Salaam')).toBe(false);
  });

  it('rejects things that are not zones at all', () => {
    expect(isValidIanaZone('1')).toBe(false);
    expect(isValidIanaZone('March 2026')).toBe(false);
    expect(isValidIanaZone('2026-08')).toBe(false);
  });
});

describe('paramFormatMessage — iana-timezone', () => {
  const check = (v: string) => paramFormatMessage('tz', 'iana-timezone', v);

  it.each(['UTC', 'Africa/Dar_es_Salaam'])('accepts %s', (v) => {
    expect(check(v)).toBeNull();
  });

  it.each(['+3', '1', 'March 2026', 'Africa/Dar-es-Salaam', '2026-08'])('rejects %s', (v) => {
    expect(check(v)).not.toBeNull();
  });

  it('names the parameter, says what is accepted, and echoes what was typed', () => {
    const msg = check('+3')!;
    expect(msg).toContain('tz');
    expect(msg).toContain('IANA');
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
    expect(paramFormatMessage('tz', 'iana-timezone', '')).toBeNull();
    expect(paramFormatMessage('month', 'year-month', '')).toBeNull();
  });

  it('truncates a long value rather than echoing it whole', () => {
    const msg = paramFormatMessage('tz', 'iana-timezone', 'x'.repeat(500))!;
    expect(msg.length).toBeLessThan(300);
  });
});
