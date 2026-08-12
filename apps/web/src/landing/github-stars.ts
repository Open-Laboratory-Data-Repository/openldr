export const GITHUB_REPO = 'Open-Laboratory-Data-Repository/openldr';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

const API_URL = `https://api.github.com/repos/${GITHUB_REPO}`;
const CACHE_KEY = 'openldr.github-stars';
const CACHE_TTL_MS = 60 * 60 * 1000;

// Below this the count is not worth showing: "Star 3" argues against the project better than no
// number at all. Under the floor the header shows the GitHub mark alone. Raise or drop it here.
export const STAR_FLOOR = 25;

// While this is false the landing page makes NO network request — no visitor's IP reaches GitHub,
// which is how the site behaved before the count existed. Flip it to true once the repo has stars
// worth showing; everything below is already built and tested.
export const STAR_COUNT_ENABLED = false;

/** `900` -> `900`, `43100` -> `43.1k`, `43000` -> `43k`. */
export function formatStarCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
}

export function shouldShowStarCount(count: number | null): count is number {
  return count !== null && count >= STAR_FLOOR;
}

function readCache(now: number): number | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { count?: unknown; at?: unknown };
    if (typeof cached.count !== 'number' || typeof cached.at !== 'number') return null;
    return now - cached.at < CACHE_TTL_MS ? cached.count : null;
  } catch {
    // Private mode, disabled storage, or a corrupt entry: just fetch.
    return null;
  }
}

function writeCache(count: number, now: number): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ count, at: now }));
  } catch {
    // Not being able to cache is not worth failing over.
  }
}

/**
 * Resolves to the star count, or null if it cannot be had. Never throws and never rejects: the
 * header must render whether or not GitHub answers. Unauthenticated requests are rate-limited to
 * 60/hour per IP, hence the cache — a visitor behind a shared office IP can otherwise get a 403.
 */
export async function loadStarCount(now = Date.now()): Promise<number | null> {
  const cached = readCache(now);
  if (cached !== null) return cached;

  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return null;
    const body = (await response.json()) as { stargazers_count?: unknown };
    if (typeof body.stargazers_count !== 'number') return null;
    writeCache(body.stargazers_count, now);
    return body.stargazers_count;
  } catch {
    return null;
  }
}
