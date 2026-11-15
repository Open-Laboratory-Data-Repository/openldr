import { describe, expect, it } from 'vitest';
import { classifySourceError, growPage, retryWaitMs, shrinkPage } from './import-retry';

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
