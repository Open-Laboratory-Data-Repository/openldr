import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFacilities } from './api';

/** Important 1 (Task 5 review): `listFacilities` is the ONLY place the grammar rules become a
 *  query string, and every page test mocks `@/api` wholesale — so they assert what the function was
 *  CALLED WITH and never what URL it builds. Swapping `JSON.stringify(v)` for `String(v)` left the
 *  whole studio suite green while every filtered request shipped `filters=[object Object]`.
 *
 *  Same shape as `api.audit.test.ts`'s "serializes only non-empty audit query params": stub `fetch`,
 *  call the client, assert the built URL. `authFetch` calls `fetch(input)` with ONE argument when no
 *  token is held (api.ts), which is why these assert on a bare URL string. */
describe('facilities api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ rows: [], total: 0, limit: 50, offset: 0 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
  });

  it('serializes filters as JSON, not as "[object Object]"', async () => {
    await listFacilities({
      filters: [{ column: 'zone', operator: 'eq', value: 'Central', combine: 'and' }],
      limit: 50,
    });

    await waitForCall();
    const url = lastUrl();
    // Assert the DECODED param as a string first, not `JSON.parse(...)` of it: `String(v)` sends
    // "[object Object]", and parsing that throws a SyntaxError instead of showing a diff. This way
    // the broken run prints `expected "[object Object]" to be '[{"column":"zone",…}]'`.
    expect(new URL(url, 'http://x').searchParams.get('filters'))
      .toBe('[{"column":"zone","operator":"eq","value":"Central","combine":"and"}]');
    expect(url).toBe(`/api/facilities?filters=${encodeURIComponent('[{"column":"zone","operator":"eq","value":"Central","combine":"and"}]')}&limit=50`);
  });

  it('serializes sorts as JSON too', async () => {
    await listFacilities({ sorts: [{ column: 'name', ascending: false }] });

    await waitForCall();
    const url = lastUrl();
    expect(new URL(url, 'http://x').searchParams.get('sorts'))
      .toBe('[{"column":"name","ascending":false}]');
    expect(url).toBe(`/api/facilities?sorts=${encodeURIComponent('[{"column":"name","ascending":false}]')}`);
  });

  it('omits an empty filters/sorts array from the query string entirely', async () => {
    await listFacilities({ filters: [], sorts: [], q: 'dodoma' });

    await waitForCall();
    const url = lastUrl();
    expect(url).toBe('/api/facilities?q=dodoma');
    expect(url).not.toContain('filters');
    expect(url).not.toContain('sorts');
  });
});

/** The stubbed `fetch` resolves synchronously enough that `await listFacilities(...)` has already
 *  driven it, but assert the call ARRIVED before reading it so a failure reads as a diff on the URL
 *  rather than a `TypeError: Cannot read properties of undefined`. */
async function waitForCall(): Promise<void> {
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
}

function lastUrl(): string {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string;
}
