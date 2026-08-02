import { describe, expect, it, vi } from 'vitest';
import { createCodingSystem, fetchReport, formatApiError } from './api';

describe('api error handling', () => {
  it('includes server error messages for failed JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'duplicate code system url: http://snomed.info/sct' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )));

    await expect(createCodingSystem({
      systemCode: 'SNOMED-CT',
      systemName: 'SNOMED CT',
      url: 'http://snomed.info/sct',
      active: true,
    })).rejects.toThrow('create system failed: duplicate code system url: http://snomed.info/sct');
  });

  // Regression: this used to throw the bare status ("report r-amr-antibiogram failed: 500"), which
  // hid the one thing the operator needed — that they had not picked a date range.
  it('fetchReport surfaces the server reason, code and correlation id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'required parameter: from', code: 'RP0001', correlationId: 'a1b2c3d4' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));

    await expect(fetchReport('r-amr-antibiogram')).rejects.toThrow(
      'report r-amr-antibiogram failed: required parameter: from · RP0001 · a1b2c3d4',
    );
  });
});

describe('formatApiError', () => {
  it('appends code and correlation id when present', () => {
    expect(formatApiError('list dashboards', { message: 'your session has expired', code: 'AU0001', correlationId: 'a1b2c3d4' }))
      .toBe('list dashboards failed: your session has expired · AU0001 · a1b2c3d4');
  });
  it('omits code/id when absent', () => {
    expect(formatApiError('list dashboards', { message: 'boom' })).toBe('list dashboards failed: boom');
  });
});
