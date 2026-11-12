import { describe, expect, it } from 'vitest';
import { createDbStore, pgNumberTypes } from './index';

/**
 * Bug 13: Postgres sends COUNT(*) as int8 and AVG() as numeric, and the driver hands both over as
 * text. A workflow then compared "9" > "18" as text, and added "18" + 1 into "181". These pools now
 * read whole numbers and decimals as numbers, and only when that loses nothing.
 */
const INT8 = 20;
const NUMERIC = 1700;
const TEXT = 25;
const parse = (oid: number, v: string) => (pgNumberTypes.getTypeParser(oid, 'text') as (s: string) => unknown)(v);

describe('pgNumberTypes', () => {
  it('reads a count as a number', () => {
    expect(parse(INT8, '18')).toBe(18);
    expect(parse(INT8, '-3')).toBe(-3);
  });

  it('keeps a whole number too big for JavaScript as text, so it is never rounded', () => {
    expect(parse(INT8, '9007199254740993')).toBe('9007199254740993');
  });

  it('reads a decimal as a number', () => {
    expect(parse(NUMERIC, '19.0')).toBe(19);
    expect(parse(NUMERIC, '17.142857142857')).toBe(17.142857142857);
    // What Postgres actually sends for AVG(): trailing zeros lose nothing.
    expect(parse(NUMERIC, '1.5000000000000000')).toBe(1.5);
  });

  it('reads an average with a long fraction, rounding only the fraction', () => {
    // AVG() of 1, 2 and 4: Postgres sends 16 decimals, more than a JavaScript number holds.
    expect(parse(NUMERIC, '2.3333333333333333')).toBe(2.3333333333333335);
  });

  it('keeps a decimal whose whole part a JavaScript number cannot hold exactly as text', () => {
    expect(parse(NUMERIC, '12345678901234567.89')).toBe('12345678901234567.89');
    expect(parse(NUMERIC, 'NaN')).toBe('NaN');
  });

  it('leaves every other type to the driver, so a numeric-looking code stays text', () => {
    expect(parse(TEXT, '10234')).toBe('10234');
  });
});

// Against a real Postgres, only when one is configured (the dev install's TARGET_DATABASE_URL).
const url = process.env.TARGET_DATABASE_URL;
describe.skipIf(!url)('createDbStore against Postgres', () => {
  it('returns COUNT and AVG as numbers', async () => {
    const store = createDbStore({ url: url! });
    try {
      const { rows } = await (store.db as any).executeQuery({
        sql: "select count(*) as n, avg(x) as mean, (select avg(y) from (values (1), (2), (4)) as u(y)) as third, 'x10' as code from (values (1::numeric), (2::numeric)) as t(x)",
        parameters: [], query: { kind: 'RawNode' },
      });
      expect(rows[0]).toEqual({ n: 2, mean: 1.5, third: 2.3333333333333335, code: 'x10' });
    } finally {
      await store.close();
    }
  });
});
