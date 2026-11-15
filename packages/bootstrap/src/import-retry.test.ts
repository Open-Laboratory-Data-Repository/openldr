import { describe, expect, it } from 'vitest';
import { classifySourceError, describeSourceError, growPage, isSourceStartingUp, isStorageDown, retryWaitMs, shrinkPage } from './import-retry';

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

  it('reads a timeout code ahead of the request rule', () => {
    expect(classifySourceError({ code: 'ETIMEOUT', number: -2, message: 'Timeout expired' })).toBe('timeout');
  });

  // M3. A SQL Server error carries a number. Its words may name a column or a table called
  // "timeout", so the message is read for a timeout only when there is no number.
  it('an EREQUEST with number 207 and the word timeout in its message is refused', () => {
    expect(classifySourceError({ code: 'EREQUEST', number: 207, message: "Invalid column name 'timeout_at'." })).toBe('refused');
    expect(classifySourceError({ code: 'EREQUEST', number: -2, message: 'Timeout expired' })).toBe('refused');
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
    // A number with no code still counts.
    expect(describeSourceError({ number: 245, message }, clean)).toBe('the source refused the query (SQL Server error 245)');
  });

  it('rule 3: a deadlock (1205) has its own fixed text, since it is tried again', () => {
    const text = describeSourceError(sqlError(1205, `deadlock victim ${ROW_VALUE}`), clean);
    expect(text).toBe('the source stopped this read to end a deadlock (SQL Server error 1205); it is tried again');
    expect(text).not.toContain(ROW_VALUE);
  });

  it('rule 4: a timeout with no number keeps the driver message, through clean', () => {
    expect(describeSourceError(Object.assign(new Error('Timeout: Request failed to complete in 30000ms'), { code: 'ETIMEOUT' }), clean))
      .toBe('[Timeout: Request failed to complete in 30000ms]');
  });

  it('rule 4: a lost link in the LoggedIn-state error is a fixed sentence, with no driver words', () => {
    const e = Object.assign(new Error('Requests can only be made in the LoggedIn state, not the Final state'), { code: 'EINVALIDSTATE' });
    expect(describeSourceError(e, clean)).toBe('the source could not be reached');
  });

  it.each(['ESOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ECONNCLOSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])(
    'rule 4: network code %s leads with "the source could not be reached"',
    (code) => {
      expect(describeSourceError(Object.assign(new Error('Connection lost - read ECONNRESET hunter2'), { code }), clean))
        .toBe('[the source could not be reached: Connection lost - read ECONNRESET ***]');
    },
  );

  it('rule 4: any other lost error leads with "the source could not be read"', () => {
    expect(describeSourceError(new Error('something nobody has seen'), clean)).toBe('[the source could not be read: something nobody has seen]');
    expect(describeSourceError({ code: 'EWHATEVER', message: 'odd' }, clean)).toBe('[the source could not be read: odd]');
  });

  it('rule 4: the lead is kept when the text is cut to the cap', () => {
    const cap = (text: string) => text.slice(0, 300);
    const long = `Connection lost ${'x'.repeat(400)}`;
    const text = describeSourceError(Object.assign(new Error(long), { code: 'ESOCKET' }), cap);
    expect(text.length).toBe(300);
    expect(text.startsWith('the source could not be reached: Connection lost x')).toBe(true);
    const other = describeSourceError(new Error(long), cap);
    expect(other.length).toBe(300);
    expect(other.startsWith('the source could not be read: Connection lost x')).toBe(true);
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
    expect(describeSourceError(errors, clean)).toBe('[the source could not be reached: Connection lost - read ECONNRESET]');
  });

  it('an AggregateError and an object with an errors array are judged by their members', () => {
    expect(classifySourceError(new AggregateError(missingColumn()))).toBe('refused');
    expect(describeSourceError(new AggregateError(missingColumn()), clean)).toBe("[Invalid column name 'Resultt'.]");
    expect(classifySourceError({ errors: missingColumn() })).toBe('refused');
    expect(describeSourceError({ errors: [] }, clean)).toBe('the source failed in a way OpenLDR does not recognise');
  });
});

// R45. After a restart SQL Server takes logins before its databases have recovered.
describe('isSourceStartingUp', () => {
  const sqlError = (number: number, code = 'EREQUEST') => Object.assign(new Error('text'), { code, number });

  it.each([4060, 18456, 921, 922, 945, 6005, 17142, 17187, 18401])('is true for SQL Server error %i', (number) => {
    expect(isSourceStartingUp(sqlError(number))).toBe(true);
  });

  it('is true for a login error and for a login or database message with no code', () => {
    expect(isSourceStartingUp({ code: 'ELOGIN', message: "Login failed for user 'x'." })).toBe(true);
    expect(isSourceStartingUp(new Error("Login failed for user 'x'."))).toBe(true);
    expect(isSourceStartingUp(new Error('Cannot open database "LabData" requested by the login.'))).toBe(true);
  });

  it('is false for a missing table, a missing column, a row error and a lost link', () => {
    expect(isSourceStartingUp(sqlError(208))).toBe(false);
    expect(isSourceStartingUp(sqlError(207))).toBe(false);
    expect(isSourceStartingUp(sqlError(245))).toBe(false);
    expect(isSourceStartingUp({ code: 'ESOCKET', message: 'Connection lost' })).toBe(false);
    expect(isSourceStartingUp(null)).toBe(false);
  });

  it('is true for a list when any member is', () => {
    expect(isSourceStartingUp([sqlError(8180), sqlError(921)])).toBe(true);
    expect(isSourceStartingUp(new AggregateError([sqlError(208), sqlError(8180)]))).toBe(false);
    expect(isSourceStartingUp([])).toBe(false);
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

// R33b. The shapes are the ones @smithy/node-http-handler 4.7 and @smithy/core 3.29 throw for a
// GetObject: a Node socket error as it is (ECONNRESET, EPIPE and ETIMEDOUT renamed TimeoutError), or
// an S3 service error named by its code with `$metadata.httpStatusCode`. Built by hand here.
describe('isStorageDown', () => {
  const sysErr = (code: string) => Object.assign(new Error(`connect ${code} 10.0.0.9:3900`), { code });
  const s3Err = (name: string, httpStatusCode: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode, attempts: 3 } });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])(
    'is true for a socket error with code %s',
    (code) => { expect(isStorageDown(sysErr(code))).toBe(true); },
  );

  it.each(['TimeoutError', 'RequestTimeout', 'ServiceUnavailable', 'SlowDown', 'InternalError'])(
    'is true for an error named %s',
    (name) => { expect(isStorageDown(Object.assign(new Error('x'), { name }))).toBe(true); },
  );

  it('is true for the connect timeout the HTTP handler throws, which has a name and no code', () => {
    const err = Object.assign(new Error('the request socket did not establish a connection with the server within the configured timeout of 1000 ms.'), { name: 'TimeoutError' });
    expect(isStorageDown(err)).toBe(true);
  });

  it.each([500, 502, 503, 504, 599])('is true for HTTP status %i', (status) => {
    expect(isStorageDown(s3Err('Unknown', status))).toBe(true);
  });

  it('is true for HTTP status 429, which the SDK itself treats as throttling', () => {
    // Added to R33b's list: a store or a proxy that is overloaded answers 429. Waiting cures it.
    expect(isStorageDown(s3Err('TooManyRequests', 429))).toBe(true);
  });

  it('follows cause down, and looks in an errors array', () => {
    expect(isStorageDown(new Error('outer', { cause: new Error('middle', { cause: sysErr('ECONNREFUSED') }) }))).toBe(true);
    // What Node's net throws when every address of a host refuses (autoSelectFamily).
    expect(isStorageDown(new AggregateError([new Error('a'), sysErr('ECONNREFUSED')], 'all refused'))).toBe(true);
    expect(isStorageDown({ errors: [{ cause: { code: 'ETIMEDOUT' } }] })).toBe(true);
  });

  it('is false for a hash mismatch, a missing file, a missing object and a plugin that cannot be invoked', () => {
    expect(isStorageDown(new Error('plugin v1-import@1.2.0 sha256 mismatch (expected aa, got bb)'))).toBe(false);
    expect(isStorageDown(Object.assign(new Error("ENOENT: no such file or directory, open '/data/plugins/x'"), { code: 'ENOENT' }))).toBe(false);
    expect(isStorageDown(s3Err('NoSuchKey', 404))).toBe(false);
    expect(isStorageDown(s3Err('AccessDenied', 403))).toBe(false);
    expect(isStorageDown(new Error('plugin v1-import@1.2.0 is not invokable (kind=source, no entrypoints)'))).toBe(false);
    expect(isStorageDown(new Error('empty object: plugins/x/1/plugin.wasm'))).toBe(false);
  });

  it('is false for values that are not errors, and stops on a cause that loops', () => {
    for (const v of [null, undefined, 'ECONNREFUSED', 42, {}]) expect(isStorageDown(v)).toBe(false);
    const a: { cause?: unknown } = {};
    const b = { cause: a };
    a.cause = b;
    expect(isStorageDown(a)).toBe(false);
  });
});
