import { describe, it, expect } from 'vitest';
import { blankSql, tokensInPlainSql, type SqlDialect } from './sql-text';

describe('blankSql, every dialect', () => {
  it.each(['postgres', 'mssql', 'mysql'] as const)('a refusal holds none of the SQL, on %s', (dialect) => {
    try { blankSql("SELECT 'SECRETVALUE", dialect); throw new Error('did not throw'); }
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
    ["SELECT N'x' AS a", "SELECT N'' AS a"],
    ["SELECT 1 # x", "SELECT 1 # x"],
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
    ["SELECT '--', 1; SELECT 2", "SELECT '', 1; SELECT 2"],
    ["SELECT 'it''s' AS a", "SELECT '' AS a"],
    ["SELECT 1 -- a note\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 /* a ' b */ FROM t", "SELECT 1   FROM t"],
    ['SELECT "set" FROM t', 'SELECT "" FROM t'],
    ['SELECT "a""b" FROM t', 'SELECT "" FROM t'],
    ["SELECT '/*' AS a, '*/' AS b", "SELECT '' AS a, '' AS b"],
    ["SELECT 'C:\\temp\\' AS p, 1", "SELECT '' AS p, 1"],
    ["SELECT a[1] FROM t", "SELECT a[1] FROM t"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
  it('refuses a dollar-quoted string that never ends', () => { expect(() => blankSql('SELECT $$abc', 'postgres')).toThrow(); });
  it.each([
    "SELECT 'abc", "SELECT 1 /* never closed", 'SELECT "abc',
  ])('refuses %s', (input) => { expect(() => blankSql(input, 'postgres')).toThrow(); });
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
  it('refuses a backtick name that never ends', () => { expect(() => blankSql('SELECT `abc', 'mysql')).toThrow(); });
  it('refuses a /*! comment opened inside another one', () => {
    expect(() => blankSql('SELECT /*! a /*! b */ */', 'mysql')).toThrow();
  });
});

describe('blankSql, mysql, round 1', () => {
  it.each([
    ["SELECT 'it\\'s' AS a, 1", "SELECT '' AS a, 1"],
    ['SELECT "a\\"b" AS a, 1', 'SELECT "" AS a, 1'],
    ["SELECT 'a\\\\' AS a, 1", "SELECT '' AS a, 1"],
    ["SELECT 'a\\'b' AS x, 'c\\'d' AS y", "SELECT '' AS x, '' AS y"],
    ["SELECT /*! STRAIGHT_JOIN */ a FROM t", "SELECT   STRAIGHT_JOIN   a FROM t"],
    ["SELECT /*!50000 a */ FROM t", "SELECT   a   FROM t"],
    ["SELECT /*M!100000 a */ FROM t", "SELECT   a   FROM t"],
    ["SELECT /*! 'x' */ 1", "SELECT   ''   1"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'mysql')).toBe(want); });
  it.each(["SELECT 'a\\", "SELECT /*! a", "SELECT /*! 'a */"])('refuses %s', (input) => {
    expect(() => blankSql(input, 'mysql')).toThrow();
  });
});

describe('blankSql, postgres, round 1', () => {
  it.each([
    ["SELECT $é$ a ' b $é$ AS x, 1", "SELECT '' AS x, 1"],
    ["SELECT a$x$ FROM t", "SELECT a$x$ FROM t"],
    ["SELECT é$x$ FROM t", "SELECT é$x$ FROM t"],
    ["SELECT 1 /*! x */", "SELECT 1  "],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
});

describe('blankSql stays linear in the input length', () => {
  const n = 200_000;
  const a = 'a'.repeat(n);
  const cases: [string, SqlDialect, string][] = [
    ['code', 'postgres', `SELECT ${a}`],
    ['a string', 'postgres', `SELECT '${a}'`],
    ['an E string of backslashes', 'postgres', `SELECT E'${'\\\\'.repeat(n / 2)}'`],
    ['a quoted name', 'postgres', `SELECT "${a}"`],
    ['a line comment', 'postgres', `SELECT 1 -- ${a}`],
    ['a block comment', 'postgres', `SELECT 1 /* ${a} */`],
    ['nested block comments', 'postgres', `SELECT 1 ${'/*'.repeat(n / 2)}${'*/'.repeat(n / 2)}`],
    ['a dollar-quoted string', 'postgres', `SELECT $x$${'$'.repeat(n)}$x$`],
    ['many dollar signs in code', 'postgres', `SELECT ${'$a '.repeat(n / 3)}`],
    ['a bracketed name', 'mssql', `SELECT [${a}]`],
    ['a backtick name', 'mysql', `SELECT \`${a}\``],
    ['a hash comment', 'mysql', `SELECT 1 # ${a}`],
    ['a string of backslashes', 'mysql', `SELECT '${'\\\\'.repeat(n / 2)}'`],
    ['a /*! comment', 'mysql', `SELECT /*! ${a} */`],
  ];
  it.each(cases)('returns on %s (%s)', (_kind, dialect, input) => {
    expect(typeof blankSql(input, dialect)).toBe('string');
  });
});

describe('tokensInPlainSql', () => {
  const T = /\{\{\s*keys\s*\}\}/g;
  it('finds a token only in code', () => {
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T, 'mssql')).toBe(true);
    expect(tokensInPlainSql("WHERE id IN ('{{keys}}')", T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE 1=1 /* {{keys}} */', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('SELECT [{{keys}}] FROM t', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE 1=1 -- {{keys}}', T, 'mssql')).toBe(false);
    expect(tokensInPlainSql('WHERE a = {{keys}} AND b = {{keys}}', T, 'postgres')).toBe(true);
    expect(tokensInPlainSql("WHERE a = {{keys}} AND b = '{{keys}}'", T, 'postgres')).toBe(false);
  });
  it('gives the same answer when called twice with one global pattern', () => {
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T, 'postgres')).toBe(true);
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T, 'postgres')).toBe(true);
  });
  it('lets a throw from the reader through', () => {
    expect(() => tokensInPlainSql("WHERE a = '{{keys}}", T, 'postgres')).toThrow();
  });
});

describe('tokensInPlainSql, round 1', () => {
  const T = /\{\{\s*keys\s*\}\}/g;
  it('is not fooled when blanking joins text into a new match', () => {
    expect(tokensInPlainSql("WHERE a = '{{keys}}' AND b = {{/**/keys}}", T, 'mssql')).toBe(false);
  });
  it('a template with no token is fine', () => {
    expect(tokensInPlainSql('WHERE b = {{/**/keys}}', T, 'mssql')).toBe(true);
  });
  it('a token half inside a comment is not in plain SQL', () => {
    expect(tokensInPlainSql('WHERE a = {{keys /* x */ }}', /\{\{[^}]*\}\}/g, 'mssql')).toBe(false);
  });
  it('works with a pattern that has no global flag', () => {
    expect(tokensInPlainSql("WHERE a = '{{keys}}'", /\{\{\s*keys\s*\}\}/, 'mssql')).toBe(false);
  });
});
