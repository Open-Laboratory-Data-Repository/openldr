/** Reads a GitHub API path and returns parsed JSON.
 *
 *  Paths must NOT start with '/': `gh api` on Windows Git Bash rewrites a leading slash into a
 *  filesystem path and fails with "invalid API endpoint" (measured 2026-08-17). */
export type FetchJson = (path: string) => Promise<unknown>;

/** The five images `deploy/install/docker-compose.yml` pins to ${OPENLDR_VERSION}. */
export const IMAGE_NAMES = [
  'openldr-api',
  'openldr-studio',
  'openldr-web',
  'openldr-gateway',
  'openldr-keycloak',
] as const;

/** One flat array (or one object) out of however gh chose to print its pages.
 *
 *  gh 2.93.0 merges array pages into a single JSON array — verified by forcing three pages with
 *  per_page=25 and parsing the result as one 59-element array with 59 unique ids. Older gh
 *  concatenated them as `][`, which is not valid JSON, and --slurp produces an array of pages.
 *  `tagExistsInRegistry` reads `.metadata.container.tags` off array ELEMENTS, so all three
 *  shapes have to arrive as the same flat array.
 *
 *  Empty output THROWS. A gh that exits 0 printing nothing is a broken read, not an empty
 *  registry — and `tagExistsInRegistry` turns an empty array into "this tag is free", which is
 *  exactly the fail-open the overwrite guard exists to stop. */
export function parseGhPages(out: string): unknown {
  const text = out.trim();
  if (text === '') {
    throw new Error('gh returned empty output — cannot tell an empty registry from a failed read');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = JSON.parse(text.replace(/\]\s*\[/g, ','));
  }

  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((page) => Array.isArray(page))) {
    return parsed.flat();
  }
  return parsed;
}

function isNotFound(err: unknown): boolean {
  return /\b404\b|not found/i.test(err instanceof Error ? err.message : String(err));
}

/** True when `tag` is already published for `image`.
 *
 *  A missing package means the tag is free — that is the first release of a new image. Any
 *  OTHER error rethrows: a 403 reported as "absent" would silently disarm the overwrite guard,
 *  which is the one thing this function exists to prevent. */
export async function tagExistsInRegistry(
  fetchJson: FetchJson,
  org: string,
  image: string,
  tag: string,
): Promise<boolean> {
  let versions: unknown;
  try {
    versions = await fetchJson(`orgs/${org}/packages/container/${image}/versions`);
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
  if (!Array.isArray(versions)) return false;
  return versions.some((v) => {
    const tags = (v as { metadata?: { container?: { tags?: unknown } } })?.metadata?.container?.tags;
    return Array.isArray(tags) && tags.includes(tag);
  });
}

/** The images that are NOT confirmed public.
 *
 *  Anything whose visibility cannot be read counts as private. New GHCR packages default to
 *  private, and one private image 401s and aborts the entire `docker compose pull` — so an
 *  unreadable answer must never be optimistically treated as public. */
export async function findPrivatePackages(
  fetchJson: FetchJson,
  org: string,
  images: readonly string[],
): Promise<string[]> {
  const bad: string[] = [];
  for (const image of images) {
    const pkg = (await fetchJson(`orgs/${org}/packages/container/${image}`)) as { visibility?: unknown };
    if (pkg?.visibility !== 'public') bad.push(image);
  }
  return bad;
}
