import { describe, expect, it } from 'vitest';
import { classifySourceError, describeSourceError, growPage, retryWaitMs, shrinkPage } from './import-retry';

// Layer: pure functions only. No driver, no connection, no database. Whether a real tedious,
// pg or mysql2 error carries these codes and messages is not tested here.

describe('classifySourceError', () => {
  it.each([
    [{ code: 'ETIMEOUT', message: 'Timeout: Request failed to complete in 30000ms' }, 'timeout'],
    [{ code: 'ESOCKET', message: 'Connection lost - read ECONNRESET' }, 'lost'],
    [{ code: 'ELOGIN', message: "Login failed for user 'x'." }, 'refused'],
    [{ code: 'EREQUEST', number: 208, message: "Invalid object name 'dbo.Requests'." }, 'refused'],
    [{ code: 'EREQUEST', number: 1205, message: 'deadlock victim' }, 'lost'],
    [new Error('something nobody has seen'), 'lost'],
  ])('classifies %j as %s', (err, kind) => expect(classifySourceError(err)).toBe(kind));

  it('reads ETIMEDOUT and a timed-out message as a timeout', () => {
    expect(classifySourceError({ code: 'ETIMEDOUT', message: 'connect' })).toBe('timeout');
    expect(classifySourceError(new Error('canceling statement due to statement timeout'))).toBe('timeout');
    expect(classifySourceError(new Error('Connection timed out'))).toBe('timeout');
  });

  it('reads a login or missing database message with no code as refused', () => {
    expect(classifySourceError(new Error('password authentication failed for user "x"'))).toBe('refused');
    expect(classifySourceError(new Error('Cannot open database "LabData" requested by the login.'))).toBe('refused');
  });

  it('puts a timeout ahead of the request rule', () => {
    expect(classifySourceError({ code: 'EREQUEST', number: -2, message: 'Timeout expired' })).toBe('timeout');
  });

  it('treats a value that is not an object as lost', () => {
    expect(classifySourceError('boom')).toBe('lost');
    expect(classifySourceError(null)).toBe('lost');
    expect(classifySourceError(undefined)).toBe('lost');
  });
});

describe('describeSourceError', () => {
  const clean = (text: string) => `[${text.replace(/hunter2/g, '***')}]`;
  const ROW_VALUE = 'ZX-ROW-VALUE-4417';
  const sqlError = (number: number, message: string, code = 'EREQUEST') => Object.assign(new Error(message), { code, number });

  it('rule 1: a login error keeps the driver message, through clean', () => {
    expect(describeSourceError(sqlError(18456, "Login failed for user 'sa'. hunter2", 'ELOGIN'), clean))
      .toBe("[Login failed for user 'sa'. ***]");
    expect(describeSourceError({ code: 'ELOGIN', message: 'Login failed.' }, clean)).toBe('[Login failed.]');
  });

  it.each([207, 208, 229, 230, 262, 911, 916, 4060, 18452, 18456])(
    'rule 2: SQL Server error %i names no row, so the driver message is kept through clean',
    (number) => expect(describeSourceError(sqlError(number, 'object name text'), clean)).toBe('[object name text]'),
  );

  it('rule 2: error 208 keeps its table name', () => {
    expect(describeSourceError(sqlError(208, "Invalid object name 'dbo.Requests'."), clean))
      .toBe("[Invalid object name 'dbo.Requests'.]");
  });

  it('rule 3: any other SQL Server error number is shown as the number only', () => {
    const message = `Conversion failed when converting the varchar value '${ROW_VALUE}' to data type int.`;
    const text = describeSourceError(sqlError(245, message), clean);
    expect(text).toBe('the source refused the query (SQL Server error 245)');
    expect(text).not.toContain(ROW_VALUE);
    expect(describeSourceError(sqlError(1205, `deadlock victim ${ROW_VALUE}`), clean))
      .toBe('the source refused the query (SQL Server error 1205)');
    // A number with no code still counts.
    expect(describeSourceError({ number: 245, message }, clean)).toBe('the source refused the query (SQL Server error 245)');
  });

  it('rule 4: a network or timer error with no number keeps the driver message, through clean', () => {
    expect(describeSourceError(Object.assign(new Error('Connection lost - read ECONNRESET'), { code: 'ESOCKET' }), clean))
      .toBe('[Connection lost - read ECONNRESET]');
    expect(describeSourceError(Object.assign(new Error('Timeout: Request failed to complete in 30000ms'), { code: 'ETIMEOUT' }), clean))
      .toBe('[Timeout: Request failed to complete in 30000ms]');
    expect(describeSourceError(new Error('something nobody has seen'), clean)).toBe('[something nobody has seen]');
  });

  it('rule 5: anything else is a fixed sentence', () => {
    expect(describeSourceError(new Error(`password authentication failed for user "${ROW_VALUE}"`), clean))
      .toBe('the source failed in a way OpenLDR does not recognise');
    expect(describeSourceError({ code: 'EREQUEST', message: `bad value ${ROW_VALUE}` }, clean))
      .toBe('the source failed in a way OpenLDR does not recognise');
  });
});

describe('a statement that fails with several errors', () => {
  // tedious 18 raises an AggregateError when one request gets more than one error token
  // (lib/token/handler.js:295). Kysely 0.28 rejects with its `errors`, a plain array
  // (dialect/mssql/mssql-driver.js:281). So the reader sees an array with no code or number.
  const clean = (text: string) => `[${text}]`;
  const ROW_VALUE = 'ZX-ROW-VALUE-4417';
  const sqlError = (number: number, message: string) => Object.assign(new Error(message), { code: 'EREQUEST', number });
  const missingColumn = () => [
    sqlError(207, "Invalid column name 'Resultt'."),
    sqlError(8180, 'Statement(s) could not be prepared.'),
  ];

  it('an array of 207 and 8180 is refused, and its text names the column', () => {
    expect(classifySourceError(missingColumn())).toBe('refused');
    const text = describeSourceError(missingColumn(), clean);
    expect(text).toBe("[Invalid column name 'Resultt'.]");
  });

  it('an array of 245 and 8180 with a row value leaks nothing', () => {
    const errors = [
      sqlError(245, `Conversion failed when converting the varchar value '${ROW_VALUE}' to data type int.`),
      sqlError(8180, 'Statement(s) could not be prepared.'),
    ];
    expect(classifySourceError(errors)).toBe('refused');
    const text = describeSourceError(errors, clean);
    expect(text).toBe('the source refused the query (SQL Server error 245)');
    expect(text).not.toContain(ROW_VALUE);
  });

  it('an array holding only a timeout is a timeout', () => {
    const errors = [Object.assign(new Error('Timeout: Request failed to complete in 30000ms'), { code: 'ETIMEOUT' })];
    expect(classifySourceError(errors)).toBe('timeout');
    expect(describeSourceError(errors, clean)).toBe('[Timeout: Request failed to complete in 30000ms]');
  });

  it('an empty array is lost, with the fixed sentence', () => {
    expect(classifySourceError([])).toBe('lost');
    expect(describeSourceError([], clean)).toBe('the source failed in a way OpenLDR does not recognise');
  });

  it('a refused member wins over a timeout or a lost link, and is the one described', () => {
    const errors = [
      Object.assign(new Error('Connection lost - read ECONNRESET'), { code: 'ESOCKET' }),
      Object.assign(new Error('Timeout: Request failed'), { code: 'ETIMEOUT' }),
      sqlError(208, "Invalid object name 'dbo.Results'."),
    ];
    expect(classifySourceError(errors)).toBe('refused');
    expect(describeSourceError(errors, clean)).toBe("[Invalid object name 'dbo.Results'.]");
  });

  it('a timeout member wins over a lost one, and the first member is described', () => {
    const errors = [
      Object.assign(new Error('Connection lost - read ECONNRESET'), { code: 'ESOCKET' }),
      Object.assign(new Error('Timeout: Request failed'), { code: 'ETIMEOUT' }),
    ];
    expect(classifySourceError(errors)).toBe('timeout');
    expect(describeSourceError(errors, clean)).toBe('[Connection lost - read ECONNRESET]');
  });

  it('an AggregateError and an object with an errors array are judged by their members', () => {
    expect(classifySourceError(new AggregateError(missingColumn()))).toBe('refused');
    expect(describeSourceError(new AggregateError(missingColumn()), clean)).toBe("[Invalid column name 'Resultt'.]");
    expect(classifySourceError({ errors: missingColumn() })).toBe('refused');
    expect(describeSourceError({ errors: [] }, clean)).toBe('the source failed in a way OpenLDR does not recognise');
  });
});

describe('retryWaitMs', () => {
  it('waits 5 s first and doubles to a ceiling of 300 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 40].map(retryWaitMs)).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  });
});

describe('shrinkPage', () => {
  it('halves a page down to 1', () => { expect([500, 3, 1].map(shrinkPage)).toEqual([250, 1, 1]); });
});

describe('growPage', () => {
  it('grows back by doubling after 5 good pages, never above the target', () => {
    expect(growPage(100, 500, 4)).toBe(100);
    expect(growPage(100, 500, 5)).toBe(200);
    expect(growPage(400, 500, 5)).toBe(500);
  });

  it('leaves a page at the target as it is', () => {
    expect(growPage(500, 500, 9)).toBe(500);
  });
});
