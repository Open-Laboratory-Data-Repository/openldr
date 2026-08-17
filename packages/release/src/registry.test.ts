import { describe, it, expect, vi } from 'vitest';
import { tagExistsInRegistry, imagesWithTag, findPrivatePackages, parseGhPages, IMAGE_NAMES } from './registry';

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

describe('parseGhPages', () => {
  it('splices two pages older gh concatenated as ][ into one flat array', () => {
    const out = '[{"id":1},{"id":2}][{"id":3}]';
    expect(parseGhPages(out)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('flattens an array of pages, the shape --slurp produces', () => {
    const out = '[[{"id":1},{"id":2}],[{"id":3}]]';
    expect(parseGhPages(out)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('passes a single page through unchanged', () => {
    const out = '[{"metadata":{"container":{"tags":["0.1.0"]}}}]';
    expect(parseGhPages(out)).toEqual([{ metadata: { container: { tags: ['0.1.0'] } } }]);
  });

  it('passes a single object through — the package endpoint answers with one', () => {
    expect(parseGhPages('{"visibility":"public"}')).toEqual({ visibility: 'public' });
  });

  // Empty stdout is not an empty registry. Reading it as [] tells tagExistsInRegistry every
  // tag is free, which disarms the one guard that stops an overwrite.
  it('throws on empty output rather than reporting an empty registry', () => {
    expect(() => parseGhPages('')).toThrow(/empty/i);
  });

  it('throws on whitespace-only output', () => {
    expect(() => parseGhPages('   \n  ')).toThrow(/empty/i);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseGhPages('{"visibility": ')).toThrow();
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

  // An object-shaped body is an unknown. Reading it as "no versions, tag is free" is the same
  // fail-open as an empty read — it just arrives through a different door.
  it('throws on an object body instead of reporting the tag as free', async () => {
    const f = fakeFetch({ [path]: { message: 'API rate limit exceeded' } });
    await expect(tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).rejects.toThrow(/non-list body/i);
  });

  it('throws on a null body', async () => {
    const f = fakeFetch({ [path]: null });
    await expect(tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0')).rejects.toThrow();
  });

  // ⛔ If the throw reads as "package absent" to a caller that catches it, the guard is disarmed
  // one layer up and the fix is worthless. isNotFound matches /\b404\b|not found/i.
  it('throws a message isNotFound cannot match', async () => {
    const f = fakeFetch({ [path]: { message: 'nope' } });
    let msg = '';
    try {
      await tagExistsInRegistry(f, 'acme', 'openldr-api', '0.1.0');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe('');
    expect(msg).not.toMatch(/\b404\b|not found/i);
  });

  // The throw must survive the wrapper it is most likely to be caught by.
  it('is not swallowed by imagesWithTag, which is the caller that catches 404s', async () => {
    const f = fakeFetch({ [path]: { message: 'nope' } });
    await expect(imagesWithTag(f, 'acme', ['openldr-api'], '0.1.0')).rejects.toThrow(/non-list body/i);
  });
});

describe('imagesWithTag', () => {
  const versions = (tags: string[]) => [{ metadata: { container: { tags } } }];
  const routes = (byImage: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(byImage).map(([img, tags]) => [
        `orgs/acme/packages/container/${img}/versions`,
        versions(tags),
      ]),
    );

  it('is empty when no image carries the tag', async () => {
    const f = fakeFetch(routes({ a: ['0.1.0'], b: ['latest'], c: [] }));
    expect(await imagesWithTag(f, 'acme', ['a', 'b', 'c'], '0.2.0')).toEqual([]);
  });

  // The hole this closes: a probe of the FIRST image alone reports the version free while two
  // later images already carry it.
  it('finds a tag carried by images other than the first', async () => {
    const f = fakeFetch(routes({ a: ['0.1.0'], b: ['0.2.0'], c: ['0.2.0'] }));
    expect(await imagesWithTag(f, 'acme', ['a', 'b', 'c'], '0.2.0')).toEqual(['b', 'c']);
  });

  it('names every image that carries the tag, in the order given', async () => {
    const f = fakeFetch(routes({ a: ['0.2.0'], b: ['0.2.0'], c: ['0.2.0'] }));
    expect(await imagesWithTag(f, 'acme', ['a', 'b', 'c'], '0.2.0')).toEqual(['a', 'b', 'c']);
  });

  // A package that does not exist yet is a genuine "free" — the first release of a new image.
  it('treats a missing package as free', async () => {
    const f = vi.fn(async (path: string) => {
      if (path.includes('/b/')) throw new Error('HTTP 404: Not Found');
      return versions(['0.2.0']);
    });
    expect(await imagesWithTag(f, 'acme', ['a', 'b'], '0.2.0')).toEqual(['a']);
  });

  it('rethrows a permission error rather than reporting the tags as free', async () => {
    const f = vi.fn(async () => {
      throw new Error('You need at least read:packages scope (HTTP 403)');
    });
    await expect(imagesWithTag(f, 'acme', ['a', 'b'], '0.2.0')).rejects.toThrow(/read:packages/);
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

describe('parseGhPages — a non-JSON body must not read as "package absent"', () => {
  // Node embeds the input in the SyntaxError: JSON.parse('Not Found') yields
  // `Unexpected token 'N', "Not Found" is not valid JSON`. isNotFound matches /not found/i, so
  // letting that message escape would classify a broken read as "the tag is free".
  it('throws a message that isNotFound cannot match', () => {
    expect(() => parseGhPages('Not Found')).toThrow(/not JSON/);
    let msg = '';
    try { parseGhPages('Not Found'); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/\b404\b|not found/i);
  });

  it('still throws on empty input, with a message isNotFound cannot match', () => {
    let msg = '';
    try { parseGhPages(''); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/\b404\b|not found/i);
  });
});

describe('tagExistsInRegistry — a version number must not smuggle 404 into the error', () => {
  // 1.404.0 is a legal version. If the thrown message interpolated the tag, it would contain
  // "404", and any caller classifying the throw with isNotFound would read a broken read as
  // "package absent" — the same fail-open, arriving through the version number.
  it('throws a message free of 404 even when the tag contains 404', async () => {
    const f = async () => ({ not: 'an array' });
    let msg = '';
    try {
      await tagExistsInRegistry(f, 'acme', 'openldr-api', '1.404.0');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/non-list body/);
    expect(msg).not.toMatch(/404|not found/i);
  });
});
