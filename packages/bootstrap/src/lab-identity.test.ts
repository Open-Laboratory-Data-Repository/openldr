import { describe, it, expect } from 'vitest';
import { LAB_COUNTRY_VALUE_SET } from '@openldr/config';
import { createLabIdentity, countryCodes, labCountry, labTimeZone } from './lab-identity';
import { CONTROLLED_VALUE_SETS } from './facility-controlled-fields';

function fakeStore() {
  const rows = new Map<string, string>();
  return {
    rows,
    store: {
      get: async (k: string) => (rows.has(k) ? { key: k, value: rows.get(k)!, updatedAt: '', updatedBy: null } : undefined),
      set: async (k: string, v: string) => { rows.set(k, v); },
    } as never,
  };
}

describe('createLabIdentity', () => {
  it('round-trips values and exposes them prefix-stripped for the renderer', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store);
    expect(await svc.set({ 'lab.name': 'Muhimbili', 'lab.contact': '+255' }, 'tester')).toEqual([]);
    expect(await svc.all()).toEqual({ 'lab.name': 'Muhimbili', 'lab.contact': '+255' });
    expect(await svc.tokens()).toEqual({ name: 'Muhimbili', contact: '+255' });
  });

  it('⛔ writes NOTHING when any field in the patch is invalid', async () => {
    // A half-applied letterhead is worse than a rejected one: the operator sees success for the
    // part that landed and has to work out which half is live.
    const { store, rows } = fakeStore();
    const svc = createLabIdentity(store);
    const errors = await svc.set({ 'lab.name': 'Muhimbili', 'lab.logo': 'https://example.org/l.png' }, 'tester');
    expect(errors).toEqual([{ key: 'lab.logo', reason: 'not-a-data-uri' }]);
    expect(rows.size).toBe(0);
    expect(await svc.all()).toEqual({});
  });

  it('treats an empty value as a clear, and omits it from the render tokens', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store);
    await svc.set({ 'lab.name': 'Muhimbili' }, null);
    await svc.set({ 'lab.name': '' }, null);
    expect(await svc.all()).toEqual({});
    expect(await svc.tokens()).toEqual({});
  });

  it('only touches the keys in the patch', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store);
    await svc.set({ 'lab.name': 'A', 'lab.contact': 'C' }, null);
    await svc.set({ 'lab.name': 'B' }, null);
    expect(await svc.all()).toEqual({ 'lab.name': 'B', 'lab.contact': 'C' });
  });

  it('rejects an unknown key rather than writing an arbitrary setting', async () => {
    const { store, rows } = fakeStore();
    const svc = createLabIdentity(store);
    expect(await svc.set({ 'sync.client_secret': 'nope' }, null)).toEqual([{ key: 'sync.client_secret', reason: 'unknown-key' }]);
    expect(rows.size).toBe(0);
  });
});

describe('labTimeZone', () => {
  it('reads lab.timezone from the service, under the name tokens() gives it', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store);
    expect(await labTimeZone(svc)).toBeUndefined();
    expect(await svc.set({ 'lab.timezone': 'Africa/Nairobi' }, 'tester')).toEqual([]);
    expect(await labTimeZone(svc)).toBe('Africa/Nairobi');
  });

  it('answers undefined when there is no service or it cannot be read', async () => {
    expect(await labTimeZone(undefined)).toBeUndefined();
    expect(await labTimeZone({ tokens: async () => { throw new Error('down'); } })).toBeUndefined();
  });
});

describe('lab.country', () => {
  const countries = async () => ['TZA', 'KEN'];

  it('saves a code from the country list and reads it back through labCountry', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store, { countries });
    expect(await svc.set({ 'lab.country': 'TZA' }, 'tester')).toEqual([]);
    expect(await svc.all()).toEqual({ 'lab.country': 'TZA' });
    expect(await labCountry(svc)).toBe('TZA');
  });

  it('refuses a code that is not in the country list, and writes nothing', async () => {
    const { store, rows } = fakeStore();
    const svc = createLabIdentity(store, { countries });
    expect(await svc.set({ 'lab.name': 'Muhimbili', 'lab.country': 'XXX' }, 'tester'))
      .toEqual([{ key: 'lab.country', reason: 'invalid-country' }]);
    expect(rows.size).toBe(0);
  });

  it('refuses a country when the list cannot be read, and still clears one', async () => {
    const { store } = fakeStore();
    const svc = createLabIdentity(store, { countries: async () => { throw new Error('down'); } });
    expect(await svc.set({ 'lab.country': 'TZA' }, 'tester')).toEqual([{ key: 'lab.country', reason: 'invalid-country' }]);
    expect(await svc.set({ 'lab.country': '' }, 'tester')).toEqual([]);
  });

  it('reads the codes of the country value set through expand', async () => {
    const seen: string[] = [];
    const ops = {
      expand: async (url: string) => {
        seen.push(url);
        return { expansion: { contains: [{ code: 'TZA' }, { code: 'KEN' }, {}] } };
      },
    };
    expect([...await countryCodes(ops as never)]).toEqual(['TZA', 'KEN']);
    expect(seen).toEqual([CONTROLLED_VALUE_SETS.country]);
  });

  it('names the same value set as the field the studio picks from', () => {
    expect(LAB_COUNTRY_VALUE_SET).toBe(CONTROLLED_VALUE_SETS.country);
  });
});

describe('labCountry', () => {
  it('reads country from tokens(), trimmed, and null when none is set', async () => {
    expect(await labCountry({ tokens: async () => ({ country: ' TZA ' }) })).toBe('TZA');
    expect(await labCountry({ tokens: async () => ({}) })).toBeNull();
    const { store } = fakeStore();
    expect(await labCountry(createLabIdentity(store))).toBeNull();
  });

  it('answers null when there is no service or it cannot be read', async () => {
    expect(await labCountry(undefined)).toBeNull();
    expect(await labCountry({ tokens: async () => { throw new Error('down'); } })).toBeNull();
  });
});
