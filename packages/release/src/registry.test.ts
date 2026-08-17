import { describe, it, expect, vi } from 'vitest';
import { tagExistsInRegistry, findPrivatePackages, IMAGE_NAMES } from './registry';

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    if (!(path in routes)) throw new Error(`unexpected path: ${path}`);
    const v = routes[path];
    if (v instanceof Error) throw v;
    return v;
  });
}

describe('IMAGE_NAMES', () => {
  it('is the five images the compose file pins', () => {
    expect([...IMAGE_NAMES]).toEqual([
      'openldr-api', 'openldr-studio', 'openldr-web', 'openldr-gateway', 'openldr-keycloak',
    ]);
  });
});

describe('tagExistsInRegistry', () => {
  const path = 'orgs/acme/packages/container/openldr-api/versions';

  it('is true when the tag is present', async () => {
    const f = fakeFetch({ [path]: [{ metadata: { container: { tags: ['latest', '0.1.0'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(true);
  });

  it('is false when the tag is absent', async () => {
    const f = fakeFetch({ [path]: [{ metadata: { container: { tags: ['latest'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.2.0')).toBe(false);
  });

  it('is false when the package does not exist yet — the first release of a new image', async () => {
    const f = vi.fn(async () => { throw new Error('HTTP 404: Not Found'); });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(false);
  });

  // A 403 must never read as "tag is free" — that is how an overwrite guard silently disarms.
  it('rethrows a permission error rather than reporting the tag as absent', async () => {
    const f = vi.fn(async () => { throw new Error('You need at least read:packages scope (HTTP 403)'); });
    await expect(tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).rejects.toThrow(/read:packages/);
  });

  it('tolerates a version entry with no tags array', async () => {
    const f = fakeFetch({ [path]: [{ metadata: {} }, { metadata: { container: { tags: ['0.1.0'] } } }] });
    expect(await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).toBe(true);
  });
});

describe('findPrivatePackages', () => {
  it('returns the names of the private ones', async () => {
    const f = fakeFetch({
      'orgs/acme/packages/container/a': { visibility: 'public' },
      'orgs/acme/packages/container/b': { visibility: 'private' },
      'orgs/acme/packages/container/c': { visibility: 'private' },
    });
    expect(await findPrivatePackages(f, 'acme', ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });

  it('returns empty when all are public', async () => {
    const f = fakeFetch({
      'orgs/acme/packages/container/a': { visibility: 'public' },
      'orgs/acme/packages/container/b': { visibility: 'public' },
    });
    expect(await findPrivatePackages(f, 'acme', ['a', 'b'])).toEqual([]);
  });

  // Unreadable is not the same as public. Treating it as public is how the trap fires.
  it('reports a package whose visibility cannot be read', async () => {
    const f = fakeFetch({ 'orgs/acme/packages/container/a': { notVisibility: true } });
    expect(await findPrivatePackages(f, 'acme', ['a'])).toEqual(['a']);
  });
});
