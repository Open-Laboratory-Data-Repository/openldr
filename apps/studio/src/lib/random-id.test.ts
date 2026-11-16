import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomId } from './random-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => { vi.unstubAllGlobals(); });

describe('randomId', () => {
  it('uses crypto.randomUUID when it is present', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id', getRandomValues: () => { throw new Error('unused'); } });
    expect(randomId()).toBe('fixed-id');
  });

  it('builds a version 4 UUID from getRandomValues when randomUUID is missing', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const a = randomId();
    const b = randomId();
    expect(a).toMatch(UUID_V4);
    expect(b).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });

  it('still returns a UUID-shaped id when no crypto exists', () => {
    vi.stubGlobal('crypto', undefined);
    const a = randomId();
    expect(a).toMatch(UUID_SHAPE);
    expect(a).not.toBe(randomId());
  });
});
