import { describe, it, expect, vi } from 'vitest';
import { importTerminologyResource, type LoaderStore } from './generic';

function fakeStore() {
  const saveSystem = vi.fn(async () => {});
  const store: LoaderStore = {
    upsertConcepts: vi.fn(async () => {}),
    upsertMapElements: vi.fn(async () => {}),
    saveResource: vi.fn(async () => ({ resourceType: 'CodeSystem', id: 'r1' })),
    saveSystem,
    markSystemChanged: vi.fn(async () => {}),
  };
  return { store, saveSystem };
}

const cs = (extra: Record<string, unknown>) => ({
  resourceType: 'CodeSystem', url: 'urn:test:cs:sites', status: 'active', content: 'complete',
  concept: [{ code: 'A', display: 'Site A' }], ...extra,
});

describe('importTerminologyResource names the system from the resource', () => {
  it('passes the title, the description and the origin to saveSystem', async () => {
    const { store, saveSystem } = fakeStore();
    await importTerminologyResource(cs({ name: 'TestSites', title: 'Test sites', description: 'Sites for testing.' }), store, { origin: 'pack', originRef: 'p1' });
    expect(saveSystem).toHaveBeenCalledWith('urn:test:cs:sites', null, 'CodeSystem', 'r1',
      { name: 'Test sites', description: 'Sites for testing.', origin: 'pack', originRef: 'p1' });
  });

  it('falls back to the name when there is no title, and passes no origin when none is given', async () => {
    const { store, saveSystem } = fakeStore();
    await importTerminologyResource(cs({ name: 'TestSites' }), store);
    expect(saveSystem).toHaveBeenCalledWith('urn:test:cs:sites', null, 'CodeSystem', 'r1', { name: 'TestSites' });
  });
});
