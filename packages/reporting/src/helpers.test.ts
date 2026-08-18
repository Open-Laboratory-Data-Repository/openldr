import { describe, it, expect } from 'vitest';
import { pivotResistance, ageBand, monthKey, hoursBetween, toCsv, endOfDay } from './helpers';

describe('pivotResistance', () => {
  it('sums per antibiotic and computes %R sorted desc', () => {
    const out = pivotResistance([
      { antibiotic: 'AMP', interpretation_code: 'R', n: 3 },
      { antibiotic: 'AMP', interpretation_code: 'S', n: 1 },
      { antibiotic: 'CIP', interpretation_code: 'S', n: 4 },
    ]);
    expect(out[0]).toMatchObject({ antibiotic: 'AMP', tested: 4, r: 3, s: 1, percentR: 75 });
    expect(out[1]).toMatchObject({ antibiotic: 'CIP', tested: 4, r: 0, percentR: 0 });
  });
});

describe('ageBand', () => {
  it('buckets ages and handles unknown', () => {
    expect(ageBand('1990-01-01', '2026-01-01')).toBe('25-49');
    expect(ageBand('2024-01-01', '2026-01-01')).toBe('0-4');
    expect(ageBand(null, '2026-01-01')).toBe('unknown');
    expect(ageBand('not-a-date', '2026-01-01')).toBe('unknown');
  });
});

describe('monthKey', () => {
  it('buckets by year-month', () => {
    expect(monthKey('2026-01-10T00:00:00Z')).toBe('2026-01');
    expect(monthKey(null)).toBe('unknown');
  });
});

describe('hoursBetween', () => {
  it('computes hours and rejects bad/negative', () => {
    expect(hoursBetween('2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z')).toBe(24);
    expect(hoursBetween('2026-01-11T00:00:00Z', '2026-01-10T00:00:00Z')).toBeNull();
    expect(hoursBetween(null, '2026-01-11T00:00:00Z')).toBeNull();
  });
});

describe('toCsv', () => {
  it('escapes and renders', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,y', b: 1 }]);
    expect(csv).toBe('A,B\n"x,y",1\n');
  });
});

describe('endOfDay', () => {
  it('extends a date-only bound and passes through full timestamps', () => {
    expect(endOfDay('2026-03-31')).toBe('2026-03-31T23:59:59.999Z');
    expect(endOfDay('2026-03-31T08:00:00Z')).toBe('2026-03-31T08:00:00Z');
  });
});

describe('toCsv — a cell containing a newline', () => {
  // ⛔ The transmission grid's date row carries `2\nFeb`: the design's `headerRow` stacks a header
  // cell's newlines, which is what keeps a day column the width of "Feb" instead of "2 Feb". That
  // value reaches this exporter unchanged, because a report's CSV is its QUERY RESULT and not a
  // transcript of the drawn page.
  //
  // It needs no stripping and gets none. RFC 4180 §2.6 allows a line break inside a quoted field,
  // and `esc` already quotes on /[",\n]/. Removing it here would make the CSV disagree with
  // `GET /api/reports/:id`, which hands the same rows back as JSON, and would do it for every
  // report rather than this one.
  it('quotes it, so the record survives a conforming parser', () => {
    const csv = toCsv([{ key: 'lab', label: 'Laboratory' }, { key: 'd01', label: 'd01' }],
      [{ lab: '(dates)', d01: '2\nFeb' }]);
    expect(csv).toBe('Laboratory,d01\n(dates),"2\nFeb"\n');
    // Two physical lines in the body, ONE logical record — the break is inside the quotes.
    expect(csv.split('"')[1]).toBe('2\nFeb');
  });

  it('is not mistaken for a formula, and is not silently flattened', () => {
    const csv = toCsv([{ key: 'd01', label: 'd01' }], [{ d01: '2\nFeb' }]);
    expect(csv).not.toContain("'2");    // the injection guard keys on ^[=@\t\r], never on \n
    expect(csv).toContain('2\nFeb');    // and nothing turned it into "2 Feb" or "2Feb"
  });
});

describe('toCsv formula-injection', () => {
  it('neutralizes leading = @ and non-numeric +/-, leaves negative numbers intact', () => {
    const cols = [{ key: 'a', label: 'A' }];
    expect(toCsv(cols, [{ a: '=SUM(1)' }])).toContain("'=SUM(1)");
    expect(toCsv(cols, [{ a: '@x' }])).toContain("'@x");
    expect(toCsv(cols, [{ a: -5 }])).toContain('-5');
    expect(toCsv(cols, [{ a: -5 }])).not.toContain("'-5");
  });
});
