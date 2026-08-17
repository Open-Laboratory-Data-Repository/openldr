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
