import { describe, it, expect } from 'vitest';
import type { Coding, Observation, Patient, ServiceRequest, Specimen } from 'fhir/r4';
import { applyMapping, SavedMappingSchema, type ApplyDeps, type FieldMapping, type SavedMapping } from './apply';
import type { MapTarget } from './target';

// A small made-up target. The real Lab result target is built elsewhere.
const target: MapTarget = {
  id: 'test-lab-result',
  name: 'Test lab result',
  records: [
    { type: 'Patient', packId: 'pack-p', repeats: false },
    { type: 'Specimen', packId: 'pack-s', repeats: false },
    { type: 'ServiceRequest', packId: 'pack-sr', repeats: false },
    { type: 'Observation', packId: 'pack-o', repeats: true },
  ],
  links: [
    { from: 'Specimen', path: 'Specimen.subject', to: 'Patient' },
    { from: 'ServiceRequest', path: 'ServiceRequest.subject', to: 'Patient' },
    { from: 'Observation', path: 'Observation.subject', to: 'Patient' },
    { from: 'Observation', path: 'Observation.specimen', to: 'Specimen' },
    { from: 'Observation', path: 'Observation.basedOn', to: 'ServiceRequest' },
  ],
  // The status values extract.ts already writes.
  defaults: [
    { path: 'ServiceRequest.status', value: 'active' },
    { path: 'ServiceRequest.intent', value: 'order' },
    { path: 'Observation.status', value: 'final' },
  ],
  fields: [
    { path: 'Patient.identifier.value?system=urn:test:patient', label: 'Patient number', required: true, repeats: false, valueSet: null },
    { path: 'Patient.name.family?use=official', label: 'Last name', required: false, repeats: false, valueSet: null },
    { path: 'Patient.name.given?use=official', label: 'First name', required: false, repeats: false, valueSet: null },
    { path: 'Patient.birthDate', label: 'Date of birth', required: false, repeats: false, valueSet: null },
    { path: 'Patient.gender', label: 'Sex', required: false, repeats: false, valueSet: null },
    { path: 'Specimen.type', label: 'Specimen type', required: false, repeats: false, valueSet: null },
    { path: 'Observation.code', label: 'Test', required: false, repeats: true, valueSet: null },
    { path: 'Observation.valueQuantity.value', label: 'Result', required: false, repeats: true, valueSet: null },
  ],
};

const row = {
  pat_no: 'T-001',
  surname: 'TESTER',
  given: 'Ann',
  dob: '03/11/26',
  sex: 'F',
  specimen: 'blood-x',
  test_a: 'TA',
  test_b: 'TB',
  result_a: '12,5',
  result_b: '7,1',
};

const baseRows: FieldMapping[] = [
  { targetPath: 'Patient.identifier.value?system=urn:test:patient', from: { field: 'pat_no' } },
  { targetPath: 'Patient.name.family?use=official', from: { field: 'surname' } },
  { targetPath: 'Patient.name.given?use=official', from: { field: 'given' } },
  { targetPath: 'Patient.birthDate', from: { field: 'dob' }, rule: { kind: 'date', format: 'dd/MM/yy' } },
  { targetPath: 'Patient.gender', from: { field: 'sex' }, rule: { kind: 'values', map: { F: 'female', M: 'male' } } },
  { targetPath: 'Specimen.type', from: { field: 'specimen' } },
];

function mapping(rows: FieldMapping[]): SavedMapping {
  return { shapeHash: 'h', fieldNames: Object.keys(row).sort(), targetId: target.id, rows };
}

function deps(): ApplyDeps {
  let n = 0;
  return {
    newId: () => `id-${++n}`,
    translateCode: async (_url, value): Promise<Coding | null> =>
      value === 'TA' || value === 'TB' ? { system: 'urn:test:codes', code: value.toLowerCase() } : null,
    now: new Date(Date.UTC(2026, 10, 17)),
  };
}

describe('applyMapping', () => {
  it('turns one row into a linked Patient, Specimen, ServiceRequest and Observation', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' }, rule: { kind: 'number', decimal: ',' } },
    ]), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resources.map((r) => r.resourceType)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    const [patient, specimen, request, obs] = res.resources as [Patient, Specimen, ServiceRequest, Observation];

    expect(patient).toEqual({
      resourceType: 'Patient',
      id: 'id-1',
      identifier: [{ system: 'urn:test:patient', value: 'T-001' }],
      name: [{ use: 'official', family: 'TESTER', given: ['Ann'] }],
      birthDate: '2026-11-03',
      gender: 'female',
    });
    expect(specimen).toEqual({ resourceType: 'Specimen', id: 'id-2', type: { text: 'blood-x' }, subject: { reference: 'Patient/id-1' } });
    expect(request).toEqual({ resourceType: 'ServiceRequest', id: 'id-3', status: 'active', intent: 'order', subject: { reference: 'Patient/id-1' } });
    expect(obs).toEqual({
      resourceType: 'Observation',
      id: 'id-4',
      status: 'final',
      valueQuantity: { value: 12.5 },
      subject: { reference: 'Patient/id-1' },
      specimen: { reference: 'Specimen/id-2' },
      basedOn: [{ reference: 'ServiceRequest/id-3' }],
    });
  });

  it('gives two Observations for two results in one row, both linked to the one order', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
      { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] }, rule: { kind: 'number', decimal: ',' } },
    ]), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const request = res.resources.find((r) => r.resourceType === 'ServiceRequest')!;
    const obs = res.resources.filter((r) => r.resourceType === 'Observation') as Observation[];
    expect(obs).toHaveLength(2);
    expect(obs.map((o) => o.code)).toEqual([
      { coding: [{ system: 'urn:test:codes', code: 'ta' }] },
      { coding: [{ system: 'urn:test:codes', code: 'tb' }] },
    ]);
    expect(obs.map((o) => o.valueQuantity?.value)).toEqual([12.5, 7.1]);
    expect(new Set(obs.map((o) => o.id)).size).toBe(2);
    for (const o of obs) expect(o.basedOn).toEqual([{ reference: `ServiceRequest/${request.id}` }]);
  });

  it('gives a list source field its elements, and applies a one-value row to every record', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.code', from: { fixed: 'Glucose' } },
      { targetPath: 'Observation.valueQuantity.value', from: { field: 'results' } },
    ]), target, { ...row, results: [1, 2, 3] }, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const obs = res.resources.filter((r) => r.resourceType === 'Observation') as Observation[];
    expect(obs.map((o) => o.valueQuantity?.value)).toEqual([1, 2, 3]);
    for (const o of obs) expect(o.code).toEqual({ text: 'Glucose' });
  });

  it('skips an index where every multi-value row is empty', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] }, rule: { kind: 'number', decimal: ',' } },
    ]), target, { ...row, result_a: '  ' }, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const obs = res.resources.filter((r) => r.resourceType === 'Observation') as Observation[];
    expect(obs.map((o) => o.valueQuantity?.value)).toEqual([7.1]);
  });

  it('fails when two multi-value rows have different lengths, naming the field', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b', 'test_a'] } },
      { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] } },
    ]), target, row, deps());
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.field).toBeDefined();
  });

  it('makes one record of a repeating type when no repeating row is mapped', async () => {
    const res = await applyMapping(mapping(baseRows), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resources.filter((r) => r.resourceType === 'Observation')).toHaveLength(1);
  });

  it('lets a mapped row override a default', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.status', from: { fixed: 'preliminary' } },
    ]), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.resources.find((r) => r.resourceType === 'Observation') as Observation).status).toBe('preliminary');
  });

  it('fails a required field whose value is missing, naming the target field', async () => {
    const res = await applyMapping(mapping(baseRows), target, { ...row, pat_no: '   ' }, deps());
    expect(res).toEqual({
      ok: false,
      field: 'Patient.identifier.value?system=urn:test:patient',
      reason: expect.stringContaining('Patient number'),
    });
  });

  it('fails a required field with no row at all', async () => {
    const res = await applyMapping(mapping(baseRows.slice(1)), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.identifier.value?system=urn:test:patient' });
  });

  it('skips an optional row whose value is missing', async () => {
    const { surname: _gone, ...rest } = row;
    const res = await applyMapping(mapping(baseRows), target, rest, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.resources[0] as Patient).name).toEqual([{ use: 'official', given: ['Ann'] }]);
  });

  it('fails a date that does not fit the format, naming the source field', async () => {
    const res = await applyMapping(mapping(baseRows), target, { ...row, dob: '2026-11-03' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'dob' });
  });

  it('fails a row for a record type the target does not have', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Location.name', from: { field: 'given' } }]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Location.name' });
  });

  it('writes a row a person added for a plain FHIR path', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'ServiceRequest.note.0.text', from: { fixed: 'from the test' } }]), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.resources[2] as ServiceRequest).note).toEqual([{ text: 'from the test' }]);
  });

  it('fails a path the table does not know', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Patient.shoeSize', from: { field: 'given' } }]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.shoeSize' });
  });
});

describe('no failure reason contains the offending value', () => {
  const secret = 'QZX9-31/02/26';
  const cases: { name: string; rows: FieldMapping[]; item: Record<string, unknown> }[] = [
    { name: 'impossible date', rows: baseRows, item: { ...row, dob: secret } },
    { name: 'unmapped value', rows: baseRows, item: { ...row, sex: secret } },
    {
      name: 'bad number',
      rows: [...baseRows, { targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' }, rule: { kind: 'number', decimal: ',' } }],
      item: { ...row, result_a: secret },
    },
    {
      name: 'number leaf without a rule',
      rows: [...baseRows, { targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' } }],
      item: { ...row, result_a: secret },
    },
    {
      name: 'no code list match',
      rows: [...baseRows, { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } }],
      item: { ...row, test_a: secret },
    },
    {
      name: 'split out of range',
      rows: [...baseRows.slice(0, 2), { targetPath: 'Patient.name.given?use=official', from: { field: 'given' }, rule: { kind: 'split', by: ' ', take: 4 } }],
      item: { ...row, given: secret },
    },
    {
      name: 'too many values for a field that does not repeat',
      rows: baseRows,
      item: { ...row, given: [secret, secret] },
    },
    {
      name: 'object value',
      rows: baseRows,
      item: { ...row, given: { v: secret } },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const res = await applyMapping(mapping(c.rows), target, c.item, deps());
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).not.toContain(secret);
        expect(res.reason).not.toContain('QZX9');
      }
    });
  }
});

describe('SavedMappingSchema', () => {
  it('parses a mapping with every source kind', () => {
    const m = mapping([
      { targetPath: 'Patient.gender', from: { field: 'sex' }, rule: { kind: 'values', map: { F: 'female' } } },
      { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] } },
      { targetPath: 'Observation.status', from: { fixed: 'final' } },
    ]);
    expect(SavedMappingSchema.parse(m)).toEqual(m);
  });

  it('rejects a source with two kinds and a row with no target path', () => {
    expect(SavedMappingSchema.safeParse(mapping([{ targetPath: 'Patient.gender', from: { field: 'a', fixed: 'b' } as never }])).success).toBe(false);
    expect(SavedMappingSchema.safeParse(mapping([{ targetPath: '', from: { field: 'a' } }])).success).toBe(false);
  });
});
