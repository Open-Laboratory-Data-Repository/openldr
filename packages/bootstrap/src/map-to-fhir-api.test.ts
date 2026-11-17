import { describe, it, expect, vi } from 'vitest';
import { seededStarterPacks } from '@openldr/forms';
import type { RunMapToFhirInput, RunMapToFhirOutput } from '@openldr/workflows';
import { createMapToFhirApi, MAP_TEST_MAX_ITEMS, MapConfigError, LOCAL_MAP_NAME } from './map-to-fhir-api';

// Made-up values only.

const PACKS = seededStarterPacks().map((p) => ({ id: p.id, resourceType: p.resourceType, entries: p.entries }));
const config = { targetId: 'lab-result', formIds: [] as string[], mappings: [] as unknown[] };

function api(over: { mapToFhir?: (i: RunMapToFhirInput) => Promise<RunMapToFhirOutput>; conceptMaps?: () => Promise<{ url?: string; name?: string; title?: string }[]> } = {}) {
  return createMapToFhirApi({
    mapToFhir: over.mapToFhir ?? (async () => ({ out: [], held: [], heldIndexes: [], meta: { fhir: 0, form: 0, mapped: 0, held: 0, heldReasons: [] } })),
    packs: async () => PACKS,
    conceptMaps: over.conceptMaps ?? (async () => []),
  });
}

describe('MAP_TEST_MAX_ITEMS', () => {
  it('is 20', () => expect(MAP_TEST_MAX_ITEMS).toBe(20));
});

describe('targets', () => {
  it('lists the lab result target with its fields', async () => {
    const t = await api().targets('en');
    expect(t.map((x) => x.id)).toEqual(['lab-result']);
    expect(t[0]!.fields.length).toBeGreaterThan(0);
  });
  it('gives English for an unknown locale', async () => {
    expect(await api().targets('zz')).toEqual(await api().targets('en'));
    expect(await api().targets(undefined)).toEqual(await api().targets('en'));
  });
});

describe('suggest', () => {
  it('returns null for an unknown target', async () => {
    expect(await api().suggest({ targetId: 'nope', fieldNames: ['a'] })).toBeNull();
  });
  it('suggests the birth date for a column called dob', async () => {
    const res = await api().suggest({ targetId: 'lab-result', fieldNames: ['dob'] });
    expect(res).toContainEqual({ targetPath: 'Patient.birthDate', field: 'dob', score: expect.any(Number) });
  });
  it('gives only target paths the target has', async () => {
    const t = (await api().targets('en'))[0]!;
    const res = await api().suggest({ targetId: 'lab-result', fieldNames: ['zzz_unknown_col'] });
    expect(Array.isArray(res)).toBe(true);
    for (const s of res!) {
      expect(t.fields.some((f) => f.path === s.targetPath)).toBe(true);
      expect(s.field).toBe('zzz_unknown_col');
      expect(typeof s.score).toBe('number');
    }
  });
});

describe('test', () => {
  it('calls the service once per item and reads the kind from the meta', async () => {
    const calls: RunMapToFhirInput[] = [];
    const a = api({
      mapToFhir: async (input) => {
        calls.push(input);
        const n = calls.length;
        if (n === 1) return { out: [{ json: { resourceType: 'Patient', id: 'p1' } }, { json: { resourceType: 'Observation', id: 'o1' } }], held: [], heldIndexes: [], meta: { fhir: 1, form: 0, mapped: 0, held: 0, heldReasons: [] } };
        if (n === 2) return { out: [{ json: { resourceType: 'Patient', id: 'p2' } }], held: [], heldIndexes: [], meta: { fhir: 0, form: 1, mapped: 0, held: 0, heldReasons: [] } };
        if (n === 3) return { out: [{ json: { resourceType: 'Specimen', id: 's3' } }], held: [], heldIndexes: [], meta: { fhir: 0, form: 0, mapped: 1, held: 0, heldReasons: [] } };
        return { out: [], held: [{ json: { item: {}, reason: 'no mapping for this shape', shape: { hash: 'h', fields: [] } } }], heldIndexes: [0], meta: { fhir: 0, form: 0, mapped: 0, held: 1, heldReasons: ['no mapping for this shape'] } };
      },
    });
    const res = await a.test({ config, items: [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }] });
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.items.length === 1 && c.config === config)).toBe(true);
    expect(res).toEqual([
      { ok: true, kind: 'fhir', resourceTypes: ['Patient', 'Observation'], resources: [{ resourceType: 'Patient', id: 'p1' }, { resourceType: 'Observation', id: 'o1' }] },
      { ok: true, kind: 'form', resourceTypes: ['Patient'], resources: [{ resourceType: 'Patient', id: 'p2' }] },
      { ok: true, kind: 'mapped', resourceTypes: ['Specimen'], resources: [{ resourceType: 'Specimen', id: 's3' }] },
      { ok: false, reason: 'no mapping for this shape' },
    ]);
  });
  it('carries the field of a held item', async () => {
    const a = api({ mapToFhir: async () => ({ out: [], held: [{ json: { item: {}, reason: 'needs a value', field: 'Patient.birthDate' } }], heldIndexes: [0], meta: { fhir: 0, form: 0, mapped: 0, held: 1, heldReasons: ['needs a value'] } }) });
    expect(await a.test({ config, items: [{}] })).toEqual([{ ok: false, reason: 'needs a value', field: 'Patient.birthDate' }]);
  });
  it('turns a config fault into a MapConfigError with the message', async () => {
    const a = api({ mapToFhir: async () => { throw new Error('Map to FHIR node config: no map target x'); } });
    const err = await a.test({ config, items: [{}] }).catch((e) => e);
    expect(err).toBeInstanceOf(MapConfigError);
    expect(err.message).toBe('Map to FHIR node config: no map target x');
  });
  it('lets any other error through unchanged', async () => {
    const a = api({ mapToFhir: async () => { throw new Error('database down'); } });
    const err = await a.test({ config, items: [{}] }).catch((e) => e);
    expect(err).not.toBeInstanceOf(MapConfigError);
  });
});

describe('codeLists', () => {
  it('puts the lab map first and then stored maps by name', async () => {
    const a = api({ conceptMaps: async () => [{ url: 'urn:test:b', name: 'Beta' }, { url: 'urn:test:a', title: 'Alpha title' }, { url: 'urn:test:c' }, { name: 'no url' }] });
    const res = await a.codeLists();
    expect(res[0]).toEqual({ url: 'urn:openldr:terminology:local-map', name: LOCAL_MAP_NAME });
    expect(res.slice(1)).toEqual([
      { url: 'urn:test:a', name: 'Alpha title' },
      { url: 'urn:test:b', name: 'Beta' },
      { url: 'urn:test:c', name: 'urn:test:c' },
    ]);
  });
  it('does not list the lab map twice', async () => {
    const a = api({ conceptMaps: async () => [{ url: 'urn:openldr:terminology:local-map', name: 'x' }] });
    expect(await a.codeLists()).toEqual([{ url: 'urn:openldr:terminology:local-map', name: LOCAL_MAP_NAME }]);
  });
});
