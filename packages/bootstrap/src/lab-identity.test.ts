import { describe, it, expect } from 'vitest';
import { createLabIdentity } from './lab-identity';

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
