import { describe, it, expect } from 'vitest';
import { createUpdateFetch } from './update-fetch';

/** A fetch that never answers, the way a filtering proxy that accepts and then drops behaves.
 *  It settles ONLY when the caller aborts — which is exactly what we are testing for. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
  })) as unknown as typeof fetch;
}

function okFetch(body: string, status = 200): typeof fetch {
  return (async () => ({ ok: status < 400, status, text: async () => body })) as unknown as typeof fetch;
}

describe('createUpdateFetch', () => {
  it('returns the body on a 200', async () => {
    const fetchText = createUpdateFetch({ fetchImpl: okFetch('{"version":"1.2.3"}') });
    expect(await fetchText('https://example.org/latest.json')).toBe('{"version":"1.2.3"}');
  });

  it('throws on a non-2xx instead of returning the error page as a manifest', async () => {
    const fetchText = createUpdateFetch({ fetchImpl: okFetch('<html>not found</html>', 404) });
    await expect(fetchText('https://example.org/latest.json')).rejects.toThrow('HTTP 404');
  });

  // The failure this exists for: without the abort, this test never finishes.
  it('rejects with a timeout when the connection hangs', async () => {
    const fetchText = createUpdateFetch({ fetchImpl: hangingFetch(), timeoutMs: 20 });
    await expect(fetchText('https://example.org/latest.json')).rejects.toThrow(/timed out after 20ms/);
  });

  // A response head that arrives promptly proves nothing — the body can stall just as well.
  it('rejects with a timeout when the BODY hangs after the headers arrive', async () => {
    const fetchImpl = ((_url: string, init?: { signal?: AbortSignal }) => Promise.resolve({
      ok: true,
      status: 200,
      text: () => new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    })) as unknown as typeof fetch;
    const fetchText = createUpdateFetch({ fetchImpl, timeoutMs: 20 });
    await expect(fetchText('https://example.org/latest.json')).rejects.toThrow(/timed out after 20ms/);
  });

  it('refuses a body far larger than a manifest', async () => {
    const fetchText = createUpdateFetch({ fetchImpl: okFetch('x'.repeat(64 * 1024 + 1)) });
    await expect(fetchText('https://example.org/latest.json')).rejects.toThrow(/too large/);
  });
});
