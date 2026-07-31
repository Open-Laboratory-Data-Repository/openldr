import { describe, it, expect } from 'vitest';
import { createOperations } from './operations';
import type { ConceptSource } from './source';
import type { ConceptRecord } from '@openldr/db';
import type { ValueSet } from '@openldr/fhir';

function memSource(concepts: ConceptRecord[], resources: Record<string, unknown> = {}): ConceptSource {
  const has = (system: string, code: string) => concepts.find((c) => c.system === system && c.code === code) ?? null;
  return {
    async getConcept(s, c) { return has(s, c); },
    async findConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      if (q.property) rows = rows.filter((c) => (c.properties as Record<string, unknown> | null)?.[q.property!.name] === q.property!.value);
      return rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    },
    async countConcepts(q) {
      let rows = concepts.filter((c) => c.system === q.system);
      if (q.codes) rows = rows.filter((c) => q.codes!.includes(c.code));
      return rows.length;
    },
    async getResourceByUrl(url) { return resources[url] ?? null; },
    async translate() { return []; },
  };
}

const loinc: ConceptRecord[] = [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine', status: 'ACTIVE', properties: { CLASS: 'CHEM' } }];

describe('lookup', () => {
  const ops = createOperations(memSource(loinc));
  it('finds a concept', async () => {
    const r = await ops.lookup('http://loinc.org', '2160-0');
    expect(r.found).toBe(true);
    expect(r.display).toBe('Creatinine');
  });
  it('misses unknown', async () => {
    expect((await ops.lookup('http://loinc.org', 'nope')).found).toBe(false);
  });
});

describe('validateCode (CodeSystem)', () => {
  const ops = createOperations(memSource(loinc));
  it('true for an existing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: '2160-0' })).result).toBe(true);
  });
  it('false for a missing code', async () => {
    expect((await ops.validateCode({ system: 'http://loinc.org', code: 'x' })).result).toBe(false);
  });
});

const abx: ConceptRecord[] = [
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP', display: 'Ampicillin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP', display: 'Ciprofloxacin', status: null, properties: null },
  { system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'GEN', display: 'Gentamicin', status: null, properties: null },
];
const abxVs: ValueSet = { resourceType: 'ValueSet', url: 'http://whonet.org/fhir/ValueSet/antibiotics', status: 'active', compose: { include: [{ system: 'http://whonet.org/fhir/CodeSystem/antibiotic' }] } };

describe('expand', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('expands a whole-system include, paginated', async () => {
    const vs = await ops.expand('http://whonet.org/fhir/ValueSet/antibiotics', { count: 2, offset: 0 });
    expect(vs.expansion?.total).toBe(3);
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['AMP', 'CIP']);
  });
  it('expands a multi-include ValueSet with an exclude', async () => {
    const source = memSource([
      { system: 's1', code: 'A', display: 'Alpha', status: 'ACTIVE', properties: null },
      { system: 's1', code: 'B', display: 'Beta', status: 'ACTIVE', properties: null },
      { system: 's2', code: 'Z', display: 'Zeta', status: 'ACTIVE', properties: null },
    ], {
      'urn:vs:multi': {
        resourceType: 'ValueSet', url: 'urn:vs:multi', status: 'active',
        compose: { include: [{ system: 's1' }, { system: 's2' }], exclude: [{ system: 's1', concept: [{ code: 'B' }] }] },
      },
    });
    const multiOps = createOperations(source);
    const vs = await multiOps.expand('urn:vs:multi', {});
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['A', 'Z']);
  });
  it('404s an unknown ValueSet', async () => {
    await expect(ops.expand('http://x/nope', {})).rejects.toThrow(/not found/i);
  });
});

describe('validateCode (ValueSet)', () => {
  const ops = createOperations(memSource(abx, { [abxVs.url]: abxVs }));
  it('true when the code is in the ValueSet', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'AMP' })).result).toBe(true);
  });
  it('false when not', async () => {
    expect((await ops.validateCode({ valueSetUrl: abxVs.url, code: 'XXX' })).result).toBe(false);
  });
});

describe('translate', () => {
  const src = memSource(abx);
  // override translate for this test
  src.translate = async (q) => (q.code === 'AMP' ? [{ mapUrl: 'http://x/cm', sourceSystem: q.system, sourceCode: 'AMP', targetSystem: 'http://loinc.org', targetCode: '101477-8', equivalence: 'equivalent' }] : []);
  const ops = createOperations(src);
  it('returns mapped targets', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'AMP' });
    expect(r.result).toBe(true);
    expect(r.matches[0].targetCode).toBe('101477-8');
  });
  it('empty for unmapped', async () => {
    const r = await ops.translate({ system: 'http://whonet.org/fhir/CodeSystem/antibiotic', code: 'CIP' });
    expect(r.result).toBe(false);
    expect(r.matches).toEqual([]);
  });
});

describe('expand filter', () => {
  const panel: ConceptRecord[] = [
    { system: 'http://loinc.org', code: '718-7',  display: 'Hemoglobin', status: 'ACTIVE', properties: null },
    { system: 'http://loinc.org', code: '2345-7', display: 'Glucose',    status: 'ACTIVE', properties: null },
  ];
  const vsResource = {
    resourceType: 'ValueSet', url: 'http://x/vs',
    compose: { include: [{ system: 'http://loinc.org' }] },
  };
  const ops = createOperations(memSource(panel, { 'http://x/vs': vsResource }));

  it('matches on display, case-insensitively', async () => {
    const vs = await ops.expand('http://x/vs', { filter: 'hemo' });
    expect(vs.expansion?.contains?.map((c) => c.display)).toEqual(['Hemoglobin']);
  });

  it('matches on code', async () => {
    const vs = await ops.expand('http://x/vs', { filter: '2345-7' });
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['2345-7']);
  });

  it('reports the filtered total, not the unfiltered one', async () => {
    expect((await ops.expand('http://x/vs', { filter: 'hemo' })).expansion?.total).toBe(1);
  });

  it('returns everything when no filter is given', async () => {
    expect((await ops.expand('http://x/vs', {})).expansion?.contains).toHaveLength(2);
  });

  it('applies the filter before paginating, not after', async () => {
    // Large fixture: 5 concepts arranged so a match sits outside the unfiltered
    // first page but inside the filtered first page.
    // Unfiltered order: [Apricot, Blueberry, Carrot, Bluefish, Date]
    // Filter 'blue': [Blueberry, Bluefish]
    // If filter-then-paginate (correct): paginate [Blueberry, Bluefish] with count=2 → [Blueberry, Bluefish]
    // If paginate-then-filter (wrong): paginate [Apricot, Blueberry] with count=2, then filter → [Blueberry] only (1 match, not 2)
    const pagingTestConcepts: ConceptRecord[] = [
      { system: 'http://test.org', code: 'C001', display: 'Apricot',      status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C002', display: 'Blueberry',    status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C003', display: 'Carrot',       status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C004', display: 'Bluefish',     status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C005', display: 'Date',         status: 'ACTIVE', properties: null },
    ];
    const pagingTestVs = {
      resourceType: 'ValueSet', url: 'http://test.org/paging-vs',
      compose: { include: [{ system: 'http://test.org' }] },
    };
    const pagingOps = createOperations(memSource(pagingTestConcepts, { 'http://test.org/paging-vs': pagingTestVs }));

    const vs = await pagingOps.expand('http://test.org/paging-vs', { filter: 'blue', count: 2, offset: 0 });
    // With correct ordering (filter-then-paginate), we get both matches: C002, C004
    expect(vs.expansion?.contains?.map((c) => c.code)).toEqual(['C002', 'C004']);
    // If paginating first, we'd paginate to [C001, C002], then filter to [C002], returning only 1 code
  });

  it('reports filtered total distinct from page count when filter is small', async () => {
    // Separate fixture to verify that total reflects the filtered set, not the page
    const pagingTestConcepts: ConceptRecord[] = [
      { system: 'http://test.org', code: 'C001', display: 'Apricot',      status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C002', display: 'Blueberry',    status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C003', display: 'Carrot',       status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C004', display: 'Bluefish',     status: 'ACTIVE', properties: null },
      { system: 'http://test.org', code: 'C005', display: 'Date',         status: 'ACTIVE', properties: null },
    ];
    const pagingTestVs = {
      resourceType: 'ValueSet', url: 'http://test.org/paging-vs2',
      compose: { include: [{ system: 'http://test.org' }] },
    };
    const pagingOps = createOperations(memSource(pagingTestConcepts, { 'http://test.org/paging-vs2': pagingTestVs }));

    const vs = await pagingOps.expand('http://test.org/paging-vs2', { filter: 'blue', count: 1, offset: 0 });
    // total should be 2 (the number of matches: C002 and C004), but contains should have only 1 (the page)
    expect(vs.expansion?.total).toBe(2);
    expect(vs.expansion?.contains).toHaveLength(1);
  });
});
