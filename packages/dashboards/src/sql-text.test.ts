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
    ["SELECT /*! 'x' */ 1", "SELECT   ''   1"],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'mysql')).toBe(want); });
  it.each(["SELECT 'a\\", "SELECT /*! a", "SELECT /*! 'a */"])('refuses %s', (input) => {
    expect(() => blankSql(input, 'mysql')).toThrow();
  });
});

describe('blankSql, postgres, round 1', () => {
  it.each([
    ["SELECT $\u00e9$ a ' b $\u00e9$ AS x, 1", "SELECT '' AS x, 1"],
    ["SELECT a$x$ FROM t", "SELECT a$x$ FROM t"],
    ["SELECT \u00e9$x$ FROM t", "SELECT \u00e9$x$ FROM t"],
    ["SELECT 1 /*! x */", "SELECT 1  "],
  ])('blanks %s', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
});

describe('blankSql, mysql, round 2', () => {
  it.each([
    ["SELECT /*! STRAIGHT_JOIN */ a FROM t", "SELECT   STRAIGHT_JOIN   a FROM t"],
    ["SELECT 1 --\u0001x\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 --\fx\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 --\u007fx\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 -- a\r\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 # a\r\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 --x", "SELECT 1 --x"],
    ["SELECT 1 -- a", "SELECT 1  "],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'mysql')).toBe(want); });
  it.each([
    "SELECT /*!50000 a */ FROM t", "SELECT /*!5 a */ FROM t", "SELECT /*M! a */ FROM t",
    "SELECT /*M!100000 a */ FROM t", "SELECT /*m! a */ FROM t",
    "SELECT 1 -- a\rFROM t", "SELECT 1 # a\rFROM t",
  ])('refuses %j', (input) => { expect(() => blankSql(input, 'mysql')).toThrow(); });
});

describe('blankSql, mssql, round 2', () => {
  it.each([
    ["SELECT 1 -- a\r\nFROM t", "SELECT 1  \nFROM t"],
    ['SELECT "a""b" FROM t', 'SELECT "" FROM t'],
    ["SELECT 1 /*M! x */", "SELECT 1  "],
    ["SELECT 1 /*!50000 x */", "SELECT 1  "],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'mssql')).toBe(want); });
  it('refuses a lone carriage return inside a line comment', () => {
    expect(() => blankSql("SELECT 1 -- a\rFROM t", 'mssql')).toThrow();
  });
  it('a carriage return outside a comment is ordinary', () => {
    expect(blankSql("SELECT 1\rFROM t", 'mssql')).toBe("SELECT 1\rFROM t");
  });
});

describe('blankSql, postgres, round 2', () => {
  it.each([
    ["SELECT 1 -- a\rFROM t", "SELECT 1  \rFROM t"],
    ["SELECT 1 -- a\r\nFROM t", "SELECT 1  \r\nFROM t"],
    ["SELECT 1 /*M! x */", "SELECT 1  "],
    ["SELECT 1 /*!50000 x */", "SELECT 1  "],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
});

describe('blankSql, mysql, round 3', () => {
  it.each([
    "SELECT /*!!99999 a */ FROM t", "SELECT /*!! a */ FROM t",
  ])('refuses %j', (input) => { expect(() => blankSql(input, 'mysql')).toThrow(); });
  it.each([
    ["SELECT 1 -- a\r", "SELECT 1  "],
    ["SELECT 1 # a\r", "SELECT 1  "],
    ["SELECT 1 -- a\u2028b\nFROM t", "SELECT 1  \nFROM t"],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'mysql')).toBe(want); });
});

describe('blankSql, mssql, round 3', () => {
  it.each([
    "SELECT 1 -- a\u000bFROM t", "SELECT 1 -- a\fFROM t", "SELECT 1 -- a\u0085FROM t",
    "SELECT 1 -- a\u2028FROM t", "SELECT 1 -- a\u2029FROM t", "SELECT 1 -- a\rFROM t",
  ])('refuses %j', (input) => { expect(() => blankSql(input, 'mssql')).toThrow(); });
  it.each([
    ["SELECT 1 -- a\r", "SELECT 1  "],
    ["SELECT 'a\u2028b' AS x", "SELECT '' AS x"],
    ["SELECT 1 /* a\u2028b */", "SELECT 1  "],
    ["SELECT [a\u2028b] FROM t", "SELECT [] FROM t"],
    ["SELECT 1\u2028FROM t", "SELECT 1\u2028FROM t"],
    ["SELECT 1 -- a\r\nFROM t", "SELECT 1  \nFROM t"],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'mssql')).toBe(want); });
});

describe('blankSql, postgres, round 3', () => {
  it.each([
    ["SELECT 1 -- a\u2028b\nFROM t", "SELECT 1  \nFROM t"],
    ["SELECT 1 /*!!99999 x */", "SELECT 1  "],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
});

describe('blankSql, round 4, a NUL character', () => {
  const inputs = [
    "SELECT 1\u0000",
    "SELECT 'a\u0000b' AS x",
    "SELECT 1 -- a\u0000b",
    "SELECT 1 /* a\u0000b */",
  ];
  for (const dialect of ['mssql', 'postgres', 'mysql'] as const) {
    it.each(inputs)(`refuses %j on ${dialect}`, (input) => { expect(() => blankSql(input, dialect)).toThrow(); });
  }
});

describe('blankSql, mssql, round 4', () => {
  it.each([
    "SELECT 1 -- a\u0001b\u000aFROM t",
    "SELECT 1 -- a\u0008b\u000aFROM t",
    "SELECT 1 -- a\u001cb\u000aFROM t",
    "SELECT 1 -- a\u001eb\u000aFROM t",
    "SELECT 1 -- a\u001fb\u000aFROM t",
    "SELECT 1 -- a\u007fb\u000aFROM t",
    "SELECT 1 -- a\u0080b\u000aFROM t",
    "SELECT 1 -- a\u009fb\u000aFROM t",
    "SELECT 1 --\u000b",
    "SELECT 1 --\u2028",
  ])('refuses %j', (input) => { expect(() => blankSql(input, 'mssql')).toThrow(); });
  it.each([
    ["SELECT 1 -- a\u0009b\u000aFROM t", "SELECT 1  \u000aFROM t"],
    ["SELECT 1 -- \u00e9 \u00fc \u65e5\u672c\u000aFROM t", "SELECT 1  \u000aFROM t"],
    ["SELECT 1 -- a\u00a0b\u000aFROM t", "SELECT 1  \u000aFROM t"],
    ["SELECT 'a\u0001b' AS x", "SELECT '' AS x"],
    ["SELECT 1 /* a\u0001b */", "SELECT 1  "],
    ["SELECT 1\u0001FROM t", "SELECT 1\u0001FROM t"],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'mssql')).toBe(want); });
});

describe('blankSql, mysql and postgres, round 4', () => {
  it.each(['mysql', 'postgres'] as const)('keeps a control character inside a line comment on %s', (dialect) => {
    expect(blankSql("SELECT 1 -- a\u0001b\u000aFROM t", dialect)).toBe("SELECT 1  \u000aFROM t");
  });
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

describe('tokensInPlainSql, round 2', () => {
  it('ignores a sticky flag on the pattern', () => {
    expect(tokensInPlainSql("WHERE a = '{{keys}}'", /\{\{\s*keys\s*\}\}/gy, 'mssql')).toBe(false);
    expect(tokensInPlainSql("WHERE a = '{{keys}}'", /\{\{\s*keys\s*\}\}/y, 'mssql')).toBe(false);
  });
  it('refuses a pattern that matches empty text', () => {
    expect(() => tokensInPlainSql("WHERE a = '{{keys}}'", /(?=\{\{keys\}\})/g, 'mssql')).toThrow();
  });
  it('one global pattern can be used again after a call', () => {
    const T = /\{\{\s*keys\s*\}\}/g;
    T.lastIndex = 5;
    expect(tokensInPlainSql('WHERE id IN ({{keys}})', T, 'mssql')).toBe(true);
    expect(T.lastIndex).toBe(5);
  });
});

describe('blankSql, postgres, a string after an escape string', () => {
  it.each([
    "SELECT E'a'\n'b' AS x", "SELECT e'a'\n\n   'b' AS x", "SELECT E'a' -- note\n'b' AS x",
    "SELECT E'a'   'b' AS x", "SELECT E'a'\n-- one\n-- two\n'b' AS x",
  ])('refuses %j', (input) => { expect(() => blankSql(input, 'postgres')).toThrow(); });
  it.each([
    ["SELECT E'a' AS x, 'b' AS y", "SELECT E'' AS x, '' AS y"],
    ["SELECT E'a' || 'b' AS x", "SELECT E'' || '' AS x"],
    ["SELECT 'a'\n'b' AS x", "SELECT ''\n'' AS x"],
    ["SELECT E'a'\n, 'b' AS y", "SELECT E''\n, '' AS y"],
    ["SELECT E'a' /* c */ 'b' AS x", "SELECT E''   '' AS x"],
  ])('blanks %j', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
  it('other engines are not touched', () => {
    expect(blankSql("SELECT N'a'\n'b' AS x", 'mssql')).toBe("SELECT N''\n'' AS x");
    expect(blankSql("SELECT 'a'\n'b' AS x", 'mysql')).toBe("SELECT ''\n'' AS x");
  });
  it('the refusal holds none of the SQL', () => {
    try { blankSql("SELECT E'SECRETVALUE'\n'b' AS x", 'postgres'); throw new Error('did not throw'); }
    catch (e) { expect(String(e)).not.toContain('SECRETVALUE'); expect(String(e)).not.toContain('did not throw'); }
  });
});

describe('blankSql, postgres, a digit just before a string opener', () => {
  it.each(["SELECT 1E'a'", 'SELECT 1$$a$$', "SELECT 1e'a' AS x", 'SELECT 1$q$a$q$ AS x'])(
    'refuses %j', (input) => { expect(() => blankSql(input, 'postgres')).toThrow(); },
  );
  it.each([
    ['SELECT a1 FROM t', 'SELECT a1 FROM t'],
    ['SELECT $1::int', 'SELECT $1::int'],
  ])('reads %j as before', (input, want) => { expect(blankSql(input, 'postgres')).toBe(want); });
  it('other engines are not touched', () => {
    expect(blankSql("SELECT 1E'a'", 'mssql')).toBe("SELECT 1E''");
    expect(blankSql("SELECT 1E'a'", 'mysql')).toBe("SELECT 1E''");
  });
});

describe('blankSql, round 5', () => {
  it.each(['SELECT 1 -- a\u001db\u000aFROM t', 'SELECT 1 -- a\u0090b\u000aFROM t'])(
    'mssql refuses %j', (input) => { expect(() => blankSql(input, 'mssql')).toThrow(); },
  );
  it('postgres reads nameE followed by a quote as the name nameE and a plain string', () => {
    expect(blankSql("SELECT nameE'a' AS x", 'postgres')).toBe("SELECT nameE'' AS x");
    // A backslash before the closing quote shows the string is plain: as an escape string it
    // would never close.
    expect(blankSql("SELECT nameE'a\\' AS x", 'postgres')).toBe("SELECT nameE'' AS x");
  });
});
