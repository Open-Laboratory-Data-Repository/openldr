import { afterEach, describe, expect, it, vi } from 'vitest';
import { authFetch, createCodingSystem, fetchReport, fetchReportPdf, formatApiError } from './api';
import { setAccessToken, setAuthEnforced, setUnauthorizedHandler } from './auth/token';

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

  // Regression: the route answers a missing report request with 404 + { code: 'RP0005',
  // message: '...' } (see reports-pdf.route.test.ts), but fetchReportPdf used to throw a bare
  // "...failed: 404" and discard the body — the studio told the clinician the renderer broke
  // when the real reason was "no such request".
  it('fetchReportPdf surfaces the server message on a coded 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: 'RP0005', message: 'no data for this report request' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )));

    await expect(fetchReportPdf('r-clinical-report')).rejects.toThrow(
      'report pdf r-clinical-report failed: no data for this report request · RP0005',
    );
  });

  it('fetchReportPdf falls back to the status-based message on a non-JSON body, without throwing a parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '',
      { status: 500, headers: { 'content-type': 'text/plain' } },
    )));

    await expect(fetchReportPdf('r-clinical-report')).rejects.toThrow(
      'report pdf r-clinical-report failed: 500',
    );
  });
});

// Regression cover for the notification loop: a tab whose token had lapsed kept polling
// /api/notifications every 45s with no Authorization header, and each 401 wrote an
// `auth.failed`/`missing` audit row that the bell then displayed as "Authentication failure" —
// the poller manufacturing its own notification. A client that knows it has no credential must
// answer locally instead of asking the server to reject it.
describe('authFetch with no access token', () => {
  afterEach(() => {
    setAccessToken(null);
    setAuthEnforced(false);
    setUnauthorizedHandler(null);
    vi.unstubAllGlobals();
  });

  it('short-circuits a protected route to 401 without issuing a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setAuthEnforced(true);

    const res = await authFetch('/api/notifications?limit=50');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'authentication required' });
  });

  it('still triggers re-login, so the session can recover', async () => {
    vi.stubGlobal('fetch', vi.fn());
    setAuthEnforced(true);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    await authFetch('/api/notifications');

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('still sends public routes — /api/config is read before any token exists', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    setAuthEnforced(true);

    for (const path of ['/api/config', '/api/workflows/hooks/abc', '/api/sync/push', '/health']) {
      await authFetch(path);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('still sends protected routes under AUTH_DEV_BYPASS, where the server supplies the actor', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    setAuthEnforced(false);

    const res = await authFetch('/api/notifications');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('sends the request untouched once a token exists', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    setAuthEnforced(true);
    setAccessToken('tok');

    await authFetch('/api/notifications');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const headers = new Headers((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('classifies absolute URLs and Request objects by pathname', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setAuthEnforced(true);

    expect((await authFetch(new URL('http://localhost/api/notifications'))).status).toBe(401);
    expect((await authFetch(new Request('http://localhost/api/notifications'))).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
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
