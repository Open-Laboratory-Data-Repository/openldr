import { afterEach, vi } from 'vitest';
import { STAR_FLOOR, formatStarCount, loadStarCount, shouldShowStarCount } from './github-stars';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function stubFetch(response: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('formatStarCount', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [43100, '43.1k'],
    [43000, '43k'],
    [43149, '43.1k'],
  ])('formats %i as %s', (count, expected) => {
    expect(formatStarCount(count)).toBe(expected);
  });
});

describe('shouldShowStarCount', () => {
  it('hides a count that would argue against the project', () => {
    expect(shouldShowStarCount(0)).toBe(false);
    expect(shouldShowStarCount(STAR_FLOOR - 1)).toBe(false);
  });

  it('shows a count at or above the floor', () => {
    expect(shouldShowStarCount(STAR_FLOOR)).toBe(true);
  });

  it('hides a count that could not be loaded', () => {
    expect(shouldShowStarCount(null)).toBe(false);
  });
});

describe('loadStarCount', () => {
  it('reads the count from the API and caches it', async () => {
    const fetchMock = stubFetch({ stargazers_count: 120 });

    await expect(loadStarCount(1_000)).resolves.toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem('openldr.github-stars') ?? '{}')).toEqual({
      count: 120,
      at: 1_000,
    });
  });

  it('serves a fresh cache without calling the API', async () => {
    window.localStorage.setItem('openldr.github-stars', JSON.stringify({ count: 99, at: 1_000 }));
    const fetchMock = stubFetch({ stargazers_count: 120 });

    await expect(loadStarCount(1_000 + 60_000)).resolves.toBe(99);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refetches once the cache is over an hour old', async () => {
    window.localStorage.setItem('openldr.github-stars', JSON.stringify({ count: 99, at: 0 }));
    const fetchMock = stubFetch({ stargazers_count: 120 });

    await expect(loadStarCount(60 * 60 * 1000 + 1)).resolves.toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when GitHub rate-limits the request', async () => {
    stubFetch({ message: 'API rate limit exceeded' }, false);
    await expect(loadStarCount()).resolves.toBeNull();
  });

  it('returns null when the network is unreachable, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(loadStarCount()).resolves.toBeNull();
  });

  it('returns null when the payload has no count', async () => {
    stubFetch({ stargazers_count: 'lots' });
    await expect(loadStarCount()).resolves.toBeNull();
  });

  it('ignores a corrupt cache entry and fetches', async () => {
    window.localStorage.setItem('openldr.github-stars', 'not json');
    const fetchMock = stubFetch({ stargazers_count: 120 });

    await expect(loadStarCount()).resolves.toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
