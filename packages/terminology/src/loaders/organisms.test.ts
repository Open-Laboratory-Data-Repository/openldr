import { describe, it, expect, vi } from 'vitest';
import { importOrganismDictionary, SITE_ORGANISM_SYSTEM, ORGANISM_TYPES } from './organisms';
import type { LoaderStore } from './generic';

type Concept = { code: string; display: string | null; properties: unknown };

function fakeStore() {
  // Params are declared so `mock.calls[0][0]` is typed — an untyped `vi.fn(async () => {})` gives
  // an empty tuple and passes vitest while failing tsc (the package's test script does not typecheck).
  const upsertConcepts = vi.fn(async (_rows: Concept[]) => {});
  const markSystemChanged = vi.fn(async (_system: string) => {});
  const store = {
    upsertConcepts, markSystemChanged,
    upsertMapElements: vi.fn(async () => {}),
    saveResource: vi.fn(async () => ({ resourceType: 'CodeSystem', id: 'x' })),
    saveSystem: vi.fn(async () => {}),
  } as unknown as LoaderStore;
  return { store, upsertConcepts, markSystemChanged };
}

const ROW = (code: string, category: string, description = `${code} desc`) => ({ code, description, category });

describe('importOrganismDictionary', () => {
  it('carries the classification onto each concept as organism_type', async () => {
    const { store, upsertConcepts } = fakeStore();
    const r = await importOrganismDictionary(
      [ROW('ACIBA', 'bacteria', 'Acinetobacter baumanii'), ROW('ABSID', 'fungus'), ROW('NBG', 'none', 'No bacterial growth')],
      store,
    );
    expect(r.system).toBe(SITE_ORGANISM_SYSTEM);
    expect(r.conceptsLoaded).toBe(3);
    expect(r.byType).toEqual({ bacteria: 1, fungus: 1, none: 1 });

    const rows = upsertConcepts.mock.calls[0][0];
    expect(rows.find((c) => c.code === 'ACIBA')).toMatchObject({
      display: 'Acinetobacter baumanii', properties: { organism_type: 'bacteria' },
    });
    // The negative is imported, not filtered out — it must be classifiable as a NON-pathogen, which
    // is the whole point: excluding it later is a positive definition, not a remembered exclusion.
    expect(rows.find((c) => c.code === 'NBG')).toMatchObject({ properties: { organism_type: 'none' } });
  });

  it('REJECTS an unrecognised classification instead of importing it', async () => {
    // A code in neither the pathogen nor the non-pathogen ValueSet would vanish from AMR reporting
    // with no trace — the exact silent-drop failure this slice exists to remove. Fail at import.
    const { store, upsertConcepts } = fakeStore();
    await expect(importOrganismDictionary([ROW('WEIRD', 'protozoa')], store))
      .rejects.toThrow(/WEIRD.*protozoa/);
    expect(upsertConcepts).not.toHaveBeenCalled(); // nothing partially imported
  });

  it('rejects a missing classification too', async () => {
    const { store } = fakeStore();
    await expect(importOrganismDictionary([{ code: 'X', description: 'x' }], store)).rejects.toThrow(/unrecognised category/);
  });

  it('accepts parasite even though today it is 0 of 647', async () => {
    // The guard rejects the UNKNOWN, not the merely unused — a future dictionary carrying
    // parasites must import rather than blow up.
    const { store } = fakeStore();
    const r = await importOrganismDictionary([ROW('PLAFA', 'parasite')], store);
    expect(r.byType).toEqual({ parasite: 1 });
    expect(ORGANISM_TYPES).toContain('parasite');
  });

  it('skips the snapshot header row (blank code) rather than importing an unaddressable concept', async () => {
    const { store, upsertConcepts } = fakeStore();
    const r = await importOrganismDictionary([{ code: '', description: 'Microbiology Organisms', category: 'bacteria' }, ROW('ACIBA', 'bacteria')], store);
    expect(r.skipped).toBe(1);
    expect(r.conceptsLoaded).toBe(1);
    expect(upsertConcepts.mock.calls[0][0].map((c) => c.code)).toEqual(['ACIBA']);
  });

  it('signals the system ONCE, after the concepts land', async () => {
    const { store, markSystemChanged, upsertConcepts } = fakeStore();
    await importOrganismDictionary([ROW('A', 'bacteria'), ROW('B', 'bacteria')], store);
    expect(markSystemChanged).toHaveBeenCalledTimes(1);
    expect(markSystemChanged).toHaveBeenCalledWith(SITE_ORGANISM_SYSTEM);
    expect(upsertConcepts.mock.invocationCallOrder[0]).toBeLessThan(markSystemChanged.mock.invocationCallOrder[0]);
  });

  it('rejects a non-array payload and an empty dictionary', async () => {
    const { store } = fakeStore();
    await expect(importOrganismDictionary({ code: 'X' }, store)).rejects.toThrow(/must be a JSON array/);
    await expect(importOrganismDictionary([], store)).rejects.toThrow(/no usable codes/);
  });
});
