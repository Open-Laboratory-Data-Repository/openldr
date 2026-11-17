import { describe, it, expect } from 'vitest';
import type { Coding } from 'fhir/r4';
import { applyRule, MapRuleSchema, type MapRule, type RuleDeps } from './rules';

const NOW = new Date(Date.UTC(2026, 10, 17));
const noCodes: RuleDeps = { translateCode: async () => null, now: NOW };

async function run(rule: MapRule, value: string | number, field = 'col_x', deps: RuleDeps = noCodes) {
  return applyRule(rule, value, field, deps);
}

describe('applyRule: date', () => {
  it('reads dd/MM/yy as a full date', async () => {
    expect(await run({ kind: 'date', format: 'dd/MM/yy' }, '03/11/26')).toEqual({ ok: true, value: '2026-11-03' });
  });

  it('reads one-digit day and month tokens', async () => {
    expect(await run({ kind: 'date', format: 'd.M.yyyy' }, '3.1.2024')).toEqual({ ok: true, value: '2024-01-03' });
  });

  it('puts a two-digit year in the latest year that is not after the current year', async () => {
    expect(await run({ kind: 'date', format: 'dd/MM/yy' }, '01/01/26')).toEqual({ ok: true, value: '2026-01-01' });
    expect(await run({ kind: 'date', format: 'dd/MM/yy' }, '01/01/27')).toEqual({ ok: true, value: '1927-01-01' });
    expect(await run({ kind: 'date', format: 'dd/MM/yy' }, '01/01/28')).toEqual({ ok: true, value: '1928-01-01' });
  });

  it('fails a date that does not fit the format, naming the field', async () => {
    const r = await run({ kind: 'date', format: 'dd/MM/yy' }, '2026-11-03', 'dob');
    expect(r).toMatchObject({ ok: false, field: 'dob' });
  });

  it('fails an impossible date', async () => {
    const r = await run({ kind: 'date', format: 'dd/MM/yyyy' }, '31/02/2024', 'dob');
    expect(r).toMatchObject({ ok: false, field: 'dob' });
  });

  it('fails a format with an unsupported token', async () => {
    const r = await run({ kind: 'date', format: 'dd/MMM/yy' }, '03/Nov/26', 'dob');
    expect(r).toMatchObject({ ok: false, field: 'dob' });
    if (!r.ok) expect(r.reason).toContain('unsupported date format');
  });

  it('fails a format with no year', async () => {
    const r = await run({ kind: 'date', format: 'dd/MM' }, '03/11', 'dob');
    expect(r).toMatchObject({ ok: false, field: 'dob' });
    if (!r.ok) expect(r.reason).toContain('unsupported date format');
  });
});

describe('applyRule: date from an Excel date cell', () => {
  const excel: MapRule = { kind: 'date', format: 'excel' };
  // Excel's 1900 system counts days so that serial 1 is 1900-01-01, and it counts a 29 February 1900
  // that never was as serial 60. So from serial 61 on, the date is 1899-12-30 plus the serial in days.

  it('reads a known day', async () => {
    // 1899-12-30 to 2023-01-01: 2 days to 1900-01-01, then 123 years (1900 to 2022) of 365 days plus
    // 30 leap days (1904 to 2020; 1900 is not one): 2 + 44895 + 30 = 44927.
    expect(await run(excel, 44927)).toEqual({ ok: true, value: '2023-01-01' });
    // 45000 is 73 days later: January has 31, February 28, so day 73 is 15 March.
    expect(await run(excel, 45000)).toEqual({ ok: true, value: '2023-03-15' });
  });

  it('reads serial 61 as 1 March 1900, and the serials before the false leap day as January and February', async () => {
    expect(await run(excel, 61)).toEqual({ ok: true, value: '1900-03-01' });
    expect(await run(excel, 1)).toEqual({ ok: true, value: '1900-01-01' });
    expect(await run(excel, 59)).toEqual({ ok: true, value: '1900-02-28' });
  });

  it('fails serial 60, the 29 February 1900 Excel counts and the calendar does not have', async () => {
    expect(await run(excel, 60, 'coll')).toEqual({ ok: false, reason: 'coll: expected a real calendar date', field: 'coll' });
  });

  it('drops the time part, so a value just before midnight stays on its own day', async () => {
    expect(await run(excel, 45000.99999)).toEqual({ ok: true, value: '2023-03-15' });
    expect(await run(excel, 45000.5)).toEqual({ ok: true, value: '2023-03-15' });
  });

  it('reads a text that is a plain number, as a CSV read as text gives it', async () => {
    expect(await run(excel, ' 45000 ')).toEqual({ ok: true, value: '2023-03-15' });
    expect(await run(excel, '45000.25')).toEqual({ ok: true, value: '2023-03-15' });
  });

  it('fails a negative, zero, a serial past 9999-12-31 and a text that is not a number, naming the field only', async () => {
    for (const v of [-5, 0, '-5', 2958466, 'QZX-7', '12/03/2023', true]) {
      const r = await applyRule(excel, v, 'coll', noCodes);
      expect(r, String(v)).toEqual({ ok: false, reason: 'coll: expected an Excel date cell, a day number', field: 'coll' });
    }
    // 2958465 is 9999-12-31, the last day Excel holds.
    expect(await run(excel, 2958465)).toEqual({ ok: true, value: '9999-12-31' });
  });
});

describe('applyRule: values', () => {
  it('translates a listed value', async () => {
    expect(await run({ kind: 'values', map: { M: 'male' } }, 'M')).toEqual({ ok: true, value: 'male' });
  });

  it('matches after trimming', async () => {
    expect(await run({ kind: 'values', map: { M: 'male' } }, ' M ')).toEqual({ ok: true, value: 'male' });
  });

  it('gives a Coding for a value mapped to a code from a value set, and text for an old string map', async () => {
    const rule: MapRule = { kind: 'values', map: { F: { system: 'urn:test:sys', code: 'female' }, M: 'male' } };
    expect(await run(rule, 'F')).toEqual({ ok: true, value: { system: 'urn:test:sys', code: 'female' } });
    expect(await run(rule, 'M')).toEqual({ ok: true, value: 'male' });
  });

  it('refuses a coded value with no system or no code', () => {
    expect(MapRuleSchema.safeParse({ kind: 'values', map: { F: { system: '', code: 'f' } } }).success).toBe(false);
    expect(MapRuleSchema.safeParse({ kind: 'values', map: { F: { system: 'urn:test:sys' } } }).success).toBe(false);
  });

  it('fails an unmapped value naming the field, not the value', async () => {
    const r = await run({ kind: 'values', map: { M: 'male' } }, 'QZX', 'sex');
    expect(r).toMatchObject({ ok: false, field: 'sex' });
    if (!r.ok) {
      expect(r.reason).toContain('sex');
      expect(r.reason).not.toContain('QZX');
    }
  });
});

describe('applyRule: codeList', () => {
  const coding: Coding = { system: 'urn:test:codes', code: 'T1', display: 'Test one' };

  it('gives the coding the concept map returns', async () => {
    const calls: [string, string][] = [];
    const deps: RuleDeps = {
      translateCode: async (url, value) => {
        calls.push([url, value]);
        return coding;
      },
    };
    expect(await run({ kind: 'codeList', conceptMapUrl: 'urn:test:map' }, ' t1 ', 'test', deps)).toEqual({ ok: true, value: coding });
    expect(calls).toEqual([['urn:test:map', 't1']]);
  });

  it('passes the source system through when the rule names one', async () => {
    const calls: unknown[][] = [];
    const deps: RuleDeps = {
      translateCode: async (...args) => {
        calls.push(args);
        return coding;
      },
    };
    await run({ kind: 'codeList', conceptMapUrl: 'urn:test:map', sourceSystem: 'urn:test:local' }, 't1', 'test', deps);
    await run({ kind: 'codeList', conceptMapUrl: 'urn:test:map' }, 't1', 'test', deps);
    expect(calls).toEqual([
      ['urn:test:map', 't1', 'urn:test:local'],
      ['urn:test:map', 't1', undefined],
    ]);
  });

  it('accepts a source system in the schema and refuses an empty one', () => {
    expect(MapRuleSchema.safeParse({ kind: 'codeList', conceptMapUrl: 'urn:test:map', sourceSystem: 'urn:test:local' }).success).toBe(true);
    expect(MapRuleSchema.safeParse({ kind: 'codeList', conceptMapUrl: 'urn:test:map', sourceSystem: '' }).success).toBe(false);
  });

  it('fails when the concept map has no match', async () => {
    const r = await run({ kind: 'codeList', conceptMapUrl: 'urn:test:map' }, 'QZX', 'test');
    expect(r).toEqual({ ok: false, reason: 'test: value has no match in the code list', field: 'test' });
  });

  it('says so when the code list gives more than one match, with no value', async () => {
    const r = await run({ kind: 'codeList', conceptMapUrl: 'urn:test:map' }, 'QZX', 'test', { translateCode: async () => 'several', now: NOW });
    expect(r).toEqual({ ok: false, reason: 'test: more than one match in the code list', field: 'test' });
  });
});

describe('applyRule: number, for a CSV cell read as text', () => {
  it('takes the text 12.5 with a decimal point', async () => {
    expect(await run({ kind: 'number', decimal: '.' }, '12.5')).toEqual({ ok: true, value: 12.5 });
  });
  it('takes the number 12.5', async () => {
    expect(await run({ kind: 'number', decimal: '.' }, 12.5)).toEqual({ ok: true, value: 12.5 });
  });
  it('takes the text 12,5 with a decimal comma', async () => {
    expect(await run({ kind: 'number', decimal: ',' }, '12,5')).toEqual({ ok: true, value: 12.5 });
  });
});

describe('applyRule: split', () => {
  it('takes the last part', async () => {
    expect(await run({ kind: 'split', by: ' ', take: 'last' }, 'BANDA Mary')).toEqual({ ok: true, value: 'Mary' });
  });

  it('takes the first part', async () => {
    expect(await run({ kind: 'split', by: ' ', take: 'first' }, 'BANDA Mary')).toEqual({ ok: true, value: 'BANDA' });
  });

  it('takes a zero-based index', async () => {
    expect(await run({ kind: 'split', by: '-', take: 1 }, 'a-b-c')).toEqual({ ok: true, value: 'b' });
  });

  it('fails an index out of range', async () => {
    expect(await run({ kind: 'split', by: '-', take: 5 }, 'a-b', 'code')).toMatchObject({ ok: false, field: 'code' });
  });
});

describe('applyRule: trim', () => {
  it('trims', async () => {
    expect(await run({ kind: 'trim' }, '  T-1 ')).toEqual({ ok: true, value: 'T-1' });
  });
});

describe('applyRule: number', () => {
  it('reads a comma decimal', async () => {
    expect(await run({ kind: 'number', decimal: ',' }, '12,5')).toEqual({ ok: true, value: 12.5 });
  });

  it('reads a point decimal and a sign', async () => {
    expect(await run({ kind: 'number', decimal: '.' }, '-0.25')).toEqual({ ok: true, value: -0.25 });
  });

  it('keeps a JSON number', async () => {
    expect(await run({ kind: 'number', decimal: ',' }, 7)).toEqual({ ok: true, value: 7 });
  });

  it('fails the other decimal mark, thousands marks and text', async () => {
    for (const v of ['12.5', '1.200,5', '12,5,1', 'abc', '']) {
      expect(await run({ kind: 'number', decimal: ',' }, v, 'result')).toMatchObject({ ok: false, field: 'result' });
    }
  });
});

describe('MapRuleSchema', () => {
  it('accepts every rule kind', () => {
    const rules: MapRule[] = [
      { kind: 'date', format: 'dd/MM/yy' },
      { kind: 'values', map: { M: 'male' } },
      { kind: 'values', map: { F: { system: 'urn:test:sys', code: 'female' }, M: 'male' } },
      { kind: 'codeList', conceptMapUrl: 'urn:test:map' },
      { kind: 'split', by: ' ', take: 2 },
      { kind: 'trim' },
      { kind: 'number', decimal: ',' },
    ];
    for (const r of rules) expect(MapRuleSchema.parse(r)).toEqual(r);
  });

  it('rejects an unknown kind and a bad take', () => {
    expect(MapRuleSchema.safeParse({ kind: 'upper' }).success).toBe(false);
    expect(MapRuleSchema.safeParse({ kind: 'split', by: ' ', take: 'middle' }).success).toBe(false);
    expect(MapRuleSchema.safeParse({ kind: 'split', by: ' ', take: -1 }).success).toBe(false);
  });
});

describe('applyRule: number, with a whole number too long to hold exactly', () => {
  it('refuses it with either decimal mark, naming the field and not the value', async () => {
    for (const decimal of [',', '.'] as const) {
      const r = await applyRule({ kind: 'number', decimal }, '4471200000000000123', 'specimen_no', {} as RuleDeps);
      expect(r).toEqual({ ok: false, reason: 'specimen_no: has more digits than a number can hold exactly', field: 'specimen_no' });
    }
    const neg = await applyRule({ kind: 'number', decimal: '.' }, '-9007199254740993', 'x', {} as RuleDeps);
    expect(neg.ok).toBe(false);
  });

  it('still reads the largest safe whole number', async () => {
    expect(await applyRule({ kind: 'number', decimal: '.' }, '9007199254740991', 'x', {} as RuleDeps)).toEqual({ ok: true, value: 9007199254740991 });
  });
});
