import { describe, it, expect } from 'vitest';
import { createTerminologyStore } from './terminology-store';
import { createFhirStore } from './fhir-store';
import { makeMigratedDb } from './migrations/internal/test-helpers';

// Concept status is compared case-SENSITIVELY downstream: valueset expansion's filterConcepts()
// gates on `status = 'ACTIVE'`, and searchConcepts takes explicit status lists. Every source
// except two wrote uppercase — the SNOMED and RxNorm ontology adapters hardcoded lowercase
// 'active', so on a real install all 532,824 SNOMED concepts were invisible to any activeOnly
// ValueSet expansion. It failed silently: the expansion returned zero rows rather than erroring,
// which surfaced as a specimen picker that found nothing while the concepts sat right there in
// the table. Normalising here (the single choke point every loader and adapter writes through)
// fixes both adapters at once and stops the next one disagreeing again.
describe('upsertConcepts status normalisation', () => {
  async function store() {
    const db = await makeMigratedDb();
    return createTerminologyStore(db as never, createFhirStore(db as never));
  }

  it('upper-cases a lower-case status so activeOnly filters can see it', async () => {
    const s = await store();
    await s.upsertConcepts([
      { system: 'http://sn', code: '119364003', display: 'Serum specimen', status: 'active', properties: null },
    ]);

    const got = await s.getConcept('http://sn', '119364003');
    expect(got?.status).toBe('ACTIVE');
  });

  it('leaves an already-upper-case status untouched', async () => {
    const s = await store();
    await s.upsertConcepts([
      { system: 'http://x', code: 'A', display: 'A', status: 'DEPRECATED', properties: null },
    ]);

    expect((await s.getConcept('http://x', 'A'))?.status).toBe('DEPRECATED');
  });

  // WHONET writes status: null deliberately; normalisation must not invent a value.
  it('leaves a null status null', async () => {
    const s = await store();
    await s.upsertConcepts([
      { system: 'http://x', code: 'B', display: 'B', status: null, properties: null },
    ]);

    expect((await s.getConcept('http://x', 'B'))?.status).toBeNull();
  });
});

describe('searchConcepts', () => {
  async function seeded() {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertConcepts([
      { system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE', properties: null },
      { system: 'http://x', code: 'CIP', display: 'Ciprofloxacin', status: 'DRAFT', properties: null },
      { system: 'http://x', code: 'GEN', display: 'Gentamicin', status: 'ACTIVE', properties: null },
    ]);
    return { db, store };
  }
  it('filters by text on code or display (case-insensitive)', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', query: 'cipro', limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['CIP']);
  });
  it('filters by status and counts', async () => {
    const { store } = await seeded();
    const rows = await store.searchConcepts({ systemUrl: 'http://x', statuses: ['ACTIVE'], limit: 10, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['AMP', 'GEN']);
    expect(await store.countConceptsSearch({ systemUrl: 'http://x', statuses: ['ACTIVE'] })).toBe(2);
  });
  it('pages results ordered by code', async () => {
    const { store } = await seeded();
    const page1 = await store.searchConcepts({ systemUrl: 'http://x', limit: 2, offset: 0 });
    expect(page1.map((r) => r.code)).toEqual(['AMP', 'CIP']);
    const page2 = await store.searchConcepts({ systemUrl: 'http://x', limit: 2, offset: 2 });
    expect(page2.map((r) => r.code)).toEqual(['GEN']);
  });
});

// The Map to FHIR node's code list rule names a map and a code, and only sometimes a source system.
describe('mapTargets', () => {
  async function seeded() {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertMapElements([
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-1', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T1', equivalence: 'equivalent' },
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-2', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T2', equivalence: 'equivalent' },
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-1', sourceCode: 'X2', targetSystem: 'urn:test:tgt', targetCode: 'T3', equivalence: null },
      { mapUrl: 'urn:test:map-b', sourceSystem: 'urn:test:src-1', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T9', equivalence: 'equivalent' },
    ]);
    return store;
  }

  it('finds every row for the map and code, whatever the source system', async () => {
    const s = await seeded();
    const rows = await s.mapTargets({ mapUrl: 'urn:test:map-a', code: 'X1' });
    expect(rows.map((r) => r.targetCode).sort()).toEqual(['T1', 'T2']);
    expect(rows.every((r) => r.mapUrl === 'urn:test:map-a')).toBe(true);
  });

  it('narrows to one source system when one is given', async () => {
    const s = await seeded();
    const rows = await s.mapTargets({ mapUrl: 'urn:test:map-a', code: 'X1', system: 'urn:test:src-2' });
    expect(rows).toEqual([
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-2', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T2', equivalence: 'equivalent' },
    ]);
  });

  it('gives nothing for a code the map does not hold', async () => {
    const s = await seeded();
    expect(await s.mapTargets({ mapUrl: 'urn:test:map-b', code: 'X2' })).toEqual([]);
  });
});

describe('mapSourceSystems', () => {
  it('lists the distinct source systems of one map, sorted', async () => {
    const db = await makeMigratedDb();
    const store = createTerminologyStore(db as never, createFhirStore(db as never));
    await store.upsertMapElements([
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-2', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T1', equivalence: null },
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-1', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T2', equivalence: null },
      { mapUrl: 'urn:test:map-a', sourceSystem: 'urn:test:src-1', sourceCode: 'X2', targetSystem: 'urn:test:tgt', targetCode: 'T3', equivalence: null },
      { mapUrl: 'urn:test:map-b', sourceSystem: 'urn:test:src-9', sourceCode: 'X1', targetSystem: 'urn:test:tgt', targetCode: 'T9', equivalence: null },
    ]);
    expect(await store.mapSourceSystems('urn:test:map-a')).toEqual(['urn:test:src-1', 'urn:test:src-2']);
    expect(await store.mapSourceSystems('urn:test:none')).toEqual([]);
  });
});
