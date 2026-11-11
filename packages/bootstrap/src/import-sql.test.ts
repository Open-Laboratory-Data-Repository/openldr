import { describe, expect, it } from 'vitest';
import { validateSelectSql } from '@openldr/dashboards';
import { assertSafeKey, fillDetailQuery, fillKeyQuery, quoteLiteral, toPluginRow } from './import-sql';

const KEY_SQL = 'SELECT DISTINCT TOP ({{limit}}) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > {{after}} ORDER BY [RequestID]';
const DETAIL_SQL = 'SELECT [RequestID], [OBRSetID] FROM [dbo].[Requests] WHERE [RequestID] IN ({{keys}}) ORDER BY [RequestID], [OBRSetID]';

describe('quoteLiteral', () => {
  it('wraps in single quotes and doubles a quote inside', () => {
    expect(quoteLiteral('REQ001')).toBe("'REQ001'");
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(quoteLiteral("'; DROP TABLE Requests; --")).toBe("'''; DROP TABLE Requests; --'");
  });
});

describe('assertSafeKey', () => {
  it.each(['REQ001', 'TZ-2024/000 123', "O'Brien"])('accepts %s', (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });
  it.each([['empty', ''], ['a newline', 'A\nB'], ['a NUL', 'A\u0000B'], ['non-ASCII', 'REQé'], ['too long', 'x'.repeat(201)]])(
    'refuses a key with %s', (_label, key) => {
      expect(() => assertSafeKey(key)).toThrow(/source key/);
    },
  );
});

describe('fillKeyQuery', () => {
  it('starts from the empty string on the first page', () => {
    expect(fillKeyQuery(KEY_SQL, null, 500)).toBe(
      "SELECT DISTINCT TOP (500) [RequestID] FROM [dbo].[Requests] WHERE [RequestID] > '' ORDER BY [RequestID]",
    );
  });
  it('continues after the last key, quoted', () => {
    expect(fillKeyQuery(KEY_SQL, "A'1", 2)).toContain("> 'A''1' ORDER BY");
  });
  it('refuses a limit that is not a whole number from 1 to 2000', () => {
    for (const bad of [0, -1, 1.5, 2001, Number.NaN]) expect(() => fillKeyQuery(KEY_SQL, null, bad)).toThrow(/page size/);
  });
  it('needs both tokens, and refuses a token it does not know', () => {
    expect(() => fillKeyQuery('SELECT TOP ({{limit}}) k FROM t', null, 10)).toThrow(/\{\{after\}\}/);
    expect(() => fillKeyQuery('SELECT k FROM t WHERE k > {{after}}', null, 10)).toThrow(/\{\{limit\}\}/);
    expect(() => fillKeyQuery(`${KEY_SQL} AND x = {{secret}}`, null, 10)).toThrow(/unknown token/);
  });
  it('produces a statement the SELECT-only validator accepts', () => {
    expect(() => validateSelectSql(fillKeyQuery(KEY_SQL, 'REQ001', 500))).not.toThrow();
  });
});

describe('fillDetailQuery', () => {
  it('lists every key as a quoted literal', () => {
    expect(fillDetailQuery(DETAIL_SQL, ['A', "B'2"])).toContain("IN ('A', 'B''2') ORDER BY");
  });
  it('refuses an empty key list and an unsafe key', () => {
    expect(() => fillDetailQuery(DETAIL_SQL, [])).toThrow(/no keys/);
    expect(() => fillDetailQuery(DETAIL_SQL, ['A\nB'])).toThrow(/source key/);
  });
  it('needs the keys token', () => {
    expect(() => fillDetailQuery('SELECT 1 FROM t', ['A'])).toThrow(/\{\{keys\}\}/);
  });
  it('stays a valid SELECT with 2000 keys', () => {
    const keys = Array.from({ length: 2000 }, (_, i) => `REQ${String(i).padStart(6, '0')}`);
    expect(() => validateSelectSql(fillDetailQuery(DETAIL_SQL, keys))).not.toThrow();
  });
  it('a key cannot turn the statement into anything but a SELECT', () => {
    const sql = fillDetailQuery(DETAIL_SQL, ["x'); DELETE FROM Requests; --"]);
    // The whole payload sits inside one string literal.
    expect(sql).toContain("IN ('x''); DELETE FROM Requests; --')");
  });
});

describe('toPluginRow', () => {
  it('turns a SQL Server date into wall-clock text with no zone', () => {
    // tedious returns a datetime as a Date whose UTC fields are the stored wall-clock.
    const row = toPluginRow({ RequestID: 'A', RegisteredDateTime: new Date(Date.UTC(2024, 2, 5, 14, 30, 7, 120)) });
    expect(row).toEqual({ RequestID: 'A', RegisteredDateTime: '2024-03-05T14:30:07.120' });
  });
  it('keeps null, numbers, booleans and strings, and makes binary and bigint JSON-safe', () => {
    expect(toPluginRow({ a: null, b: 4.5, c: true, d: 'x', e: Buffer.from('hi'), f: 12n, g: undefined })).toEqual({
      a: null, b: 4.5, c: true, d: 'x', e: 'aGk=', f: '12', g: null,
    });
  });
  it('turns an invalid date into null', () => {
    expect(toPluginRow({ d: new Date(Number.NaN) })).toEqual({ d: null });
  });
});
