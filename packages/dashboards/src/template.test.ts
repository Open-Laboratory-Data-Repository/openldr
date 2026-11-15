import { describe, expect, it } from 'vitest';
import { applyTemplate, filterTokens, resolveValues } from './template';

const BACKSLASH = String.fromCharCode(92);
const NEVER_CLOSED = 'the SQL has a string, comment or quoted name that is never closed';
const QUOTED_TOKEN = 'a {{n}} sits inside quotes, a comment or a quoted name: remove the quotes; the value is quoted for you';

// Moved from the studio, whose copy of `resolveValues` is gone: the server splits the values.
describe('filterTokens agrees with resolveValues', () => {
  it('names the keys resolveValues produces', () => {
    const resolved = resolveValues({ period: { from: '2024-01-01', to: '2024-02-01' }, ward: 'ICU' });
    expect(filterTokens({ id: 'period', type: 'date-range' }).every((t) => t in resolved)).toBe(true);
    expect(filterTokens({ id: 'ward', type: 'text' }).every((t) => t in resolved)).toBe(true);
  });
});

describe('applyTemplate: a value stays one literal', () => {
  it('a viewer value with a quote, two dashes or a comment opener stays one literal', () => {
    const out = applyTemplate('SELECT * FROM t WHERE n = {{n}}', { n: "a' -- /* b" });
    expect(out).toBe("SELECT * FROM t WHERE n = 'a'' -- /* b'");
  });

  it('a negative number after a minus sign goes in inside parentheses', () => {
    expect(applyTemplate('SELECT 10 -{{n}}', { n: -1 })).toBe('SELECT 10 -(-1)');
  });

  it('zero and positive numbers go in as they did before', () => {
    expect(applyTemplate('SELECT a FROM t LIMIT {{n}}', { n: 5 })).toBe('SELECT a FROM t LIMIT 5');
    expect(applyTemplate('SELECT a FROM t LIMIT {{n}}', { n: 0 })).toBe('SELECT a FROM t LIMIT 0');
    expect(applyTemplate('SELECT a FROM t WHERE x > {{n}}', { n: 2.5 })).toBe('SELECT a FROM t WHERE x > 2.5');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses the number %s with a fixed sentence', (n) => {
    let message = '';
    try { applyTemplate('SELECT a FROM t WHERE x = {{n}}', { n }); } catch (e) { message = (e as Error).message; }
    expect(message).toBe('the value for {{n}} is not a finite number');
    expect(message).not.toMatch(/NaN|Infinity/);
  });

  it('on mysql a value that ends in a backslash stays one literal', () => {
    const out = applyTemplate('SELECT * FROM t WHERE a = {{a}} AND b = {{b}}', { a: `x${BACKSLASH}`, b: 'y' }, 'mysql');
    expect(out).toBe(`SELECT * FROM t WHERE a = 'x${BACKSLASH}${BACKSLASH}' AND b = 'y'`);
  });

  it.each(['mssql', 'postgres', undefined] as const)('on %s a backslash in a value is left as it is', (dialect) => {
    const out = applyTemplate('SELECT * FROM t WHERE a = {{a}} AND b = {{b}}', { a: `x${BACKSLASH}`, b: 'y' }, dialect);
    expect(out).toBe(`SELECT * FROM t WHERE a = 'x${BACKSLASH}' AND b = 'y'`);
  });
});

describe('applyTemplate: a token sits in plain SQL', () => {
  it('refuses a filter token inside quotes', () => {
    expect(() => applyTemplate("SELECT * FROM t WHERE n = '{{n}}'", { n: 'x' })).toThrow(/remove the quotes/);
  });

  it('refuses a token inside a comment, on every dialect, and the sentence holds no value', () => {
    for (const dialect of ['postgres', 'mssql', 'mysql', undefined] as const) {
      let message = '';
      try { applyTemplate('SELECT * FROM t WHERE n = 1 /* {{n}} */', { n: 'SECRETVALUE' }, dialect); } catch (e) { message = (e as Error).message; }
      expect(message).toBe(QUOTED_TOKEN);
      expect(message).not.toContain('SECRETVALUE');
    }
  });

  it('a token inside an optional clause that is dropped is not checked', () => {
    expect(applyTemplate('SELECT 1 [[ AND a = {{a}} ]]', {})).toBe('SELECT 1 ');
    expect(applyTemplate("SELECT 1 [[ AND a = '{{a}}' ]]", {})).toBe('SELECT 1 ');
  });

  it('a token inside an optional clause that is kept is checked', () => {
    expect(() => applyTemplate("SELECT 1 [[ AND a = '{{a}}' ]]", { a: 'x' })).toThrow(/remove the quotes/);
  });

  it('a token that is plain under one reading only is refused with that dialect and accepted with none', () => {
    // On SQL Server `[...]` is a quoted name. On Postgres `[` is code.
    expect(() => applyTemplate('SELECT [{{n}}]', { n: 'x' }, 'mssql')).toThrow(/remove the quotes/);
    expect(applyTemplate('SELECT [{{n}}]', { n: 'x' }, 'postgres')).toBe("SELECT ['x']");
    expect(applyTemplate('SELECT [{{n}}]', { n: 'x' })).toBe("SELECT ['x']");
  });

  it('with no dialect, two tokens that are plain under different engines only are refused', () => {
    // Postgres reads $$...$$ as a string. SQL Server reads [...] as a name. MySQL reads `...` as a
    // name. So {{a}} is plain on mssql and mysql, {{b}} only on postgres, and no engine reads both.
    const sql = 'SELECT $${{a}}$$, `[{{b}}]`';
    expect(() => applyTemplate(sql, { a: 'x', b: 'y' })).toThrow(QUOTED_TOKEN.replace('{{n}}', '{{a}}'));
    expect(applyTemplate('SELECT $${{a}}$$', { a: 'x' })).toBe("SELECT $$'x'$$");
  });

  it('a string that is never closed is refused with the reader sentence', () => {
    expect(() => applyTemplate("SELECT {{n}} AS a, 'open", { n: 'x' }, 'postgres')).toThrow(NEVER_CLOSED);
    expect(() => applyTemplate("SELECT {{n}} AS a, 'open", { n: 'x' })).toThrow(NEVER_CLOSED);
  });

  it('on postgres and with no dialect, a token right after a lone E is refused', () => {
    // E'...' is a Postgres escape string: a backslash in the value would escape the closing quote.
    const sentence = 'a {{a}} follows a lone E, which Postgres reads as the start of an escape string: remove the E';
    for (const sql of ['SELECT E{{a}}', 'SELECT 1 WHERE x = e{{a}}']) {
      expect(() => applyTemplate(sql, { a: 'SECRETVALUE' }, 'postgres')).toThrow(sentence);
      expect(() => applyTemplate(sql, { a: 'SECRETVALUE' })).toThrow(sentence);
    }
    // Not a lone E: the end of a longer name, or a space between.
    expect(applyTemplate('SELECT NE{{a}}', { a: 'x' }, 'postgres')).toBe("SELECT NE'x'");
    expect(applyTemplate('SELECT E {{a}}', { a: 'x' }, 'postgres')).toBe("SELECT E 'x'");
    // SQL Server and MySQL have no escape string of that form.
    expect(applyTemplate('SELECT E{{a}}', { a: 'x' }, 'mssql')).toBe("SELECT E'x'");
    expect(applyTemplate('SELECT E{{a}}', { a: 'x' }, 'mysql')).toBe("SELECT E'x'");
  });

  it('a token with no value still has to sit in plain SQL', () => {
    expect(applyTemplate('SELECT * FROM t WHERE n = {{n}}', {})).toBe('SELECT * FROM t WHERE n = NULL');
    expect(() => applyTemplate("SELECT * FROM t WHERE n = '{{n}}'", {})).toThrow(/remove the quotes/);
  });
});
