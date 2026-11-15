import { describe, it, expect } from 'vitest';
import { blankSql, tokensInPlainSql } from './sql-text';

describe('blankSql, no dialect', () => {
  it.each([
    ["SELECT '--', 1; SELECT 2", "SELECT '', 1; SELECT 2"],
    ["SELECT 'it''s' AS a", "SELECT '' AS a"],
    ["SELECT 1 -- a note\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 /* a ' b */ FROM t", "SELECT 1   FROM t"],
    ['SELECT "set" FROM t', 'SELECT "" FROM t'],
    ['SELECT "a""b" FROM t', 'SELECT "" FROM t'],
    ["SELECT `use` FROM t", "SELECT `` FROM t"],
    ["SELECT '/*' AS a, '*/' AS b", "SELECT '' AS a, '' AS b"],
    ["SELECT N'x' AS a", "SELECT N'' AS a"],
    ["SELECT 'C:\\temp\\' AS p, 1", "SELECT '' AS p, 1"],
    ["SELECT a[1] FROM t", "SELECT a[1] FROM t"],
    ["SELECT 1 # x", "SELECT 1 # x"],
  ])('blanks %s', (input, want) => { expect(blankSql(input)).toBe(want); });

  it.each([
    "SELECT 'abc", "SELECT 1 /* never closed", 'SELECT "abc', "SELECT `abc",
    "SELECT 1 /* a /* b */ c */", "SELECT 1 /*! x */", "SELECT 1 /*M! x */",
  ])('refuses %s', (input) => { expect(() => blankSql(input)).toThrow(); });

  it('a refusal holds none of the SQL', () => {
    try { blankSql("SELECT 'SECRETVALUE"); throw new Error('did not throw'); }
    catch (e) { expect(String(e)).not.toContain('SECRETVALUE'); }
  });
});

describe('blankSql, mssql', () => {
  it.each([
    ["SELECT [open], [a]]b] FROM t", "SELECT [], [] FROM t"],
    ["SELECT [it's] FROM t", "SELECT [] FROM t"],
    ["SELECT '[' AS a, ']' AS b", "SELECT '' AS a, '' AS b"],
    ["SELECT 1 --2 AS a", "SELECT 1  "],
    ["SELECT 1 /* a /* b */ c */ FROM t", "SELECT 1   FROM t"],
    ["SELECT 'C:\\temp\\' AS p, 1", "SELECT '' AS p, 1"],
    ["SELECT * FROM ##tmp", "SELECT * FROM ##tmp"],
    ["SELECT 1 /*! x */", "SELECT 1  "],
    ["SELECT `a` FROM t", "SELECT `a` FROM t"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'mssql')).toBe(want); });
  it('refuses a bracketed name that never ends', () => { expect(() => blankSql('SELECT [abc', 'mssql')).toThrow(); });
});

describe('blankSql, postgres', () => {
  it.each([
    ["SELECT $$it's$$ AS a, 1", "SELECT '' AS a, 1"],
    ["SELECT $q$ a ' b $q$ AS a, 1", "SELECT '' AS a, 1"],
    ["SELECT E'it\\'s' AS a, 1", "SELECT E'' AS a, 1"],
    ["SELECT 'a\\' AS a, 1", "SELECT '' AS a, 1"],
    ["SELECT ARRAY[1, 2] AS a", "SELECT ARRAY[1, 2] AS a"],
    ["SELECT $1::int", "SELECT $1::int"],
    ["SELECT 1 /* a /* b */ c */ FROM t", "SELECT 1   FROM t"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
  it('refuses a dollar-quoted string that never ends', () => { expect(() => blankSql('SELECT $$abc', 'postgres')).toThrow(); });
});

describe('blankSql, mysql', () => {
  it.each([
    ["SELECT 1 --2 AS a", "SELECT 1 --2 AS a"],
    ["SELECT 1 -- a note", "SELECT 1  "],
    ["SELECT 1 # it's a note\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 'a\\\\' AS a, 1", "SELECT '' AS a, 1"],
    ["SELECT 'a\\nb' AS a", "SELECT '' AS a"],
    ["SELECT 1 /* a /* b */ FROM t", "SELECT 1   FROM t"],
    ["SELECT `use` FROM t", "SELECT `` FROM t"],
    ["SELECT a[1] FROM t", "SELECT a[1] FROM t"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'mysql')).toBe(want); });
  it.each([
    "SELECT 'a\\'b' AS a", 'SELECT "a\\"b" AS a', "SELECT 1 /*! x */", "SELECT 1 /*M! x */",
  ])('refuses %s', (input) => { expect(() => blankSql(input, 'mysql')).toThrow(); });
});

describe('tokensInPlainSql', () => {
  const T = /\{\{\s*keys\s*\}\}/g;
  it('finds a token only in code', () => {
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T, 'mssql')).toBe(true);
    expect(tokensInPlainSql("WHERE id IN ('{{keys}}')", T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE 1=1 /* {{keys}} */', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('SELECT [{{keys}}] FROM t', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE 1=1 -- {{keys}}', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE a = {{keys}} AND b = {{keys}}', T)).toBe(true);
    expect(tokensInPlainSql("WHERE a = {{keys}} AND b = '{{keys}}'", T)).toBe(false);
  });
  it('gives the same answer when called twice with one global pattern', () => {
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T)).toBe(true);
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T)).toBe(true);
  });
  it('lets a throw from the reader through', () => {
    expect(() => tokensInPlainSql("WHERE a = '{{keys}}", T)).toThrow();
  });
});
