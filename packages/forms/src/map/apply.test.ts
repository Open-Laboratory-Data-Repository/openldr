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
  // The specimen number is not a field of this target: a row a person adds for it still counts.
  identity: [
    { record: 'Patient', parts: [{ field: 'Patient.identifier.value?system=urn:test:patient' }] },
    {
      record: 'Specimen',
      parts: [{ record: 'Patient' }, { field: 'Specimen.accessionIdentifier.value' }],
      fallback: [{ record: 'Patient' }, { field: 'Specimen.type' }],
    },
    { record: 'ServiceRequest', parts: [{ record: 'Specimen' }, { field: 'ServiceRequest.code', optional: true }] },
    { record: 'Observation', parts: [{ record: 'ServiceRequest' }, { field: 'Observation.code', optional: true }] },
  ],
};

// A real hash, so a test can show no id holds a value from the row. FNV-1a 64, 16 hex digits.
function fnv(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}
const hash = (parts: string[]) => fnv(JSON.stringify(parts));

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
  return {
    hashId: hash,
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
    // No specimen number, so the Specimen id falls back to the patient and the specimen type.
    // hashId gets the record type, a 'fallback' marker when the fallback was used, then each part:
    // a record id, `t:` plus trimmed text, `c:` plus [system, code], or '' for a missing optional part.
    const P = hash(['Patient', 't:T-001']);
    const S = hash(['Specimen', 'fallback', P, 't:blood-x']);
    const R = hash(['ServiceRequest', S, '']);
    const O = hash(['Observation', R, '']);

    expect(patient).toEqual({
      resourceType: 'Patient',
      id: P,
      identifier: [{ system: 'urn:test:patient', value: 'T-001' }],
      name: [{ use: 'official', family: 'TESTER', given: ['Ann'] }],
      birthDate: '2026-11-03',
      gender: 'female',
    });
    expect(specimen).toEqual({ resourceType: 'Specimen', id: S, type: { text: 'blood-x', coding: [{ code: 'blood-x' }] }, subject: { reference: `Patient/${P}` } });
    expect(request).toEqual({ resourceType: 'ServiceRequest', id: R, status: 'active', intent: 'order', subject: { reference: `Patient/${P}` } });
    expect(obs).toEqual({
      resourceType: 'Observation',
      id: O,
      status: 'final',
      valueQuantity: { value: 12.5 },
      subject: { reference: `Patient/${P}` },
      specimen: { reference: `Specimen/${S}` },
      basedOn: [{ reference: `ServiceRequest/${R}` }],
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
    // The codes are a list too: one fixed code for every result would give every result one id.
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'Observation.code', from: { field: 'tests' } },
      { targetPath: 'Observation.valueQuantity.value', from: { field: 'results' } },
      { targetPath: 'Observation.valueQuantity.unit', from: { fixed: 'u-x' } },
    ]), target, { ...row, tests: ['T1', 'T2', 'T3'], results: [1, 2, 3] }, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const obs = res.resources.filter((r) => r.resourceType === 'Observation') as Observation[];
    expect(obs.map((o) => o.valueQuantity?.value)).toEqual([1, 2, 3]);
    expect(obs.map((o) => o.code)).toEqual([{ text: 'T1', coding: [{ code: 'T1' }] }, { text: 'T2', coding: [{ code: 'T2' }] }, { text: 'T3', coding: [{ code: 'T3' }] }]);
    for (const o of obs) expect(o.valueQuantity?.unit).toBe('u-x');
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
    ]), target, { ...row, result_a: 'QZX7', result_b: 'QZX8' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'result_a' });
    if (!res.ok) expect(res.reason).not.toContain('QZX');
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
    expect(res.resources[0]).toEqual({
      resourceType: 'Patient',
      id: hash(['Patient', 't:T-001']),
      identifier: [{ system: 'urn:test:patient', value: 'T-001' }],
      name: [{ use: 'official', given: ['Ann'] }],
      birthDate: '2026-11-03',
      gender: 'female',
    });
  });

  it('fails two pinned keys on one single Reference, naming the second key', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'ServiceRequest.requester?type=Practitioner', from: { field: 'given' } },
      { targetPath: 'ServiceRequest.requester?type=Organization', from: { field: 'surname' } },
    ]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'ServiceRequest.requester?type=Organization' });
    if (!res.ok) {
      expect(res.reason).toContain('only one');
      expect(res.reason).not.toContain('TESTER');
    }
  });

  it('writes either pinned requester key alone', async () => {
    const res = await applyMapping(mapping([
      ...baseRows,
      { targetPath: 'ServiceRequest.requester?type=Organization', from: { field: 'surname' } },
    ]), target, row, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.resources[2] as ServiceRequest).requester).toEqual({ display: 'TESTER', type: 'Organization' });
  });

  it('fails a malformed key without throwing, naming the key', async () => {
    for (const key of ['Patient.identifier.value?system=%zz', 'Patient.identifier.value?system']) {
      const res = await applyMapping(mapping([...baseRows, { targetPath: key, from: { field: 'pat_no' } }]), target, row, deps());
      expect(res).toMatchObject({ ok: false, field: key });
    }
  });

  it('fails a string sent to a complex leaf instead of writing a bad shape', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Patient.identifier', from: { field: 'pat_no' } }]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.identifier' });
    if (!res.ok) {
      expect(res.reason).toContain('more specific');
      expect(res.reason).not.toContain('T-001');
    }
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

  it('refuses a mapped record id, naming the target key and no value', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Patient.id', from: { field: 'pat_no' } }]), target, row, deps());
    expect(res).toEqual({ ok: false, reason: 'Patient.id: a record\'s id is made from its identity and cannot be mapped', field: 'Patient.id' });
  });

  it('refuses a mapped link path, with pins or an index, naming the target key', async () => {
    for (const key of ['Observation.subject', 'Observation.basedOn.0', 'Observation.specimen?type=Specimen']) {
      const res = await applyMapping(mapping([...baseRows, { targetPath: key, from: { field: 'given' } }]), target, row, deps());
      expect(res, key).toEqual({ ok: false, reason: `${key}: the target makes this link itself, so it cannot be mapped`, field: key });
    }
  });

  it('fails a path the table does not know', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Patient.shoeSize', from: { field: 'given' } }]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.shoeSize' });
  });
});

describe('record ids come from the row', () => {
  const specNo: FieldMapping = { targetPath: 'Specimen.accessionIdentifier.value', from: { field: 'spec_no' } };
  const twoResults: FieldMapping[] = [
    { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
    { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] }, rule: { kind: 'number', decimal: ',' } },
  ];
  const ids = (res: Awaited<ReturnType<typeof applyMapping>>) => {
    if (!res.ok) throw new Error(res.reason);
    return res.resources.map((r) => `${r.resourceType}/${r.id}`);
  };
  const idOf = (res: Awaited<ReturnType<typeof applyMapping>>, type: string) => {
    if (!res.ok) throw new Error(res.reason);
    return res.resources.find((r) => r.resourceType === type)!.id;
  };

  it('gives the same ids for the same row twice', async () => {
    const m = mapping([...baseRows, specNo, ...twoResults]);
    const item = { ...row, spec_no: 'S-1' };
    const a = ids(await applyMapping(m, target, item, deps()));
    const b = ids(await applyMapping(m, target, { ...item }, deps()));
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
    expect(b).toEqual(a);
  });

  it('gives one Patient id for one patient ID, and a Specimen id per specimen number', async () => {
    const m = mapping([...baseRows, specNo]);
    const a = await applyMapping(m, target, { ...row, spec_no: 'S-1' }, deps());
    const b = await applyMapping(m, target, { ...row, spec_no: 'S-2', given: 'Bea', dob: '04/11/26', sex: 'M' }, deps());
    expect(idOf(b, 'Patient')).toBe(idOf(a, 'Patient'));
    expect(idOf(b, 'Specimen')).not.toBe(idOf(a, 'Specimen'));
  });

  it('gives different Patient ids for different patient IDs', async () => {
    const m = mapping(baseRows);
    const a = await applyMapping(m, target, row, deps());
    const b = await applyMapping(m, target, { ...row, pat_no: 'T-002' }, deps());
    expect(idOf(b, 'Patient')).not.toBe(idOf(a, 'Patient'));
  });

  it('fails a row with no patient identifier, naming the field and not the value', async () => {
    const loose: MapTarget = { ...target, fields: target.fields.map((f) => ({ ...f, required: false })) };
    // The value under test is empty, so check that no other value of the row leaks into the reason.
    const item = { ...row, pat_no: '', surname: 'QZXSUR', given: 'QZXGIV', specimen: 'QZXSPC' };
    const res = await applyMapping(mapping(baseRows), loose, item, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.identifier.value?system=urn:test:patient' });
    if (!res.ok) {
      expect(res.reason).toContain('Patient number');
      expect(res.reason).not.toContain('QZX');
    }
  });

  it('uses the specimen number when there is one, and the fallback when there is not', async () => {
    const m = mapping([...baseRows, specNo]);
    const P = hash(['Patient', 't:T-001']);
    expect(idOf(await applyMapping(m, target, { ...row, spec_no: 'S-1' }, deps()), 'Specimen')).toBe(hash(['Specimen', P, 't:S-1']));
    expect(idOf(await applyMapping(m, target, { ...row, spec_no: ' ' }, deps()), 'Specimen')).toBe(hash(['Specimen', 'fallback', P, 't:blood-x']));
  });

  it('names the fallback\'s missing part when neither the parts nor the fallback are there', async () => {
    const res = await applyMapping(mapping([...baseRows.filter((r) => r.targetPath !== 'Specimen.type'), specNo]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'Specimen.type' });
  });

  it('reports a required value that is empty as required, before any id is worked out', async () => {
    const strict: MapTarget = { ...target, fields: target.fields.map((f) => (f.path === 'Specimen.type' ? { ...f, required: true } : f)) };
    const res = await applyMapping(mapping([...baseRows, specNo]), strict, { ...row, specimen: '' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'Specimen.type' });
    if (!res.ok) expect(res.reason).toContain('required');
  });

  it('trims an identity value, and keeps the stored value as the row gave it', async () => {
    const a = await applyMapping(mapping(baseRows), target, { ...row, pat_no: ' T-001 ' }, deps());
    const b = await applyMapping(mapping(baseRows), target, row, deps());
    expect(idOf(a, 'Patient')).toBe(idOf(b, 'Patient'));
    if (!a.ok) throw new Error(a.reason);
    expect((a.resources[0] as Patient).identifier).toEqual([{ system: 'urn:test:patient', value: ' T-001 ' }]);
  });

  it('never gives a coding and a text the same id', async () => {
    const codeDeps = { ...deps(), translateCode: async (): Promise<Coding | null> => ({ system: 'a', code: 'b' }) };
    const coded = await applyMapping(mapping([...baseRows,
      { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
    ]), target, row, codeDeps);
    const text = await applyMapping(mapping([...baseRows,
      { targetPath: 'Observation.code', from: { fixed: 'a|b' } },
    ]), target, row, codeDeps);
    expect(idOf(coded, 'Observation')).not.toBe(idOf(text, 'Observation'));
    // A text that spells the coding's tagged form does not meet it either.
    const spelled = await applyMapping(mapping([...baseRows,
      { targetPath: 'Observation.code', from: { fixed: 'c:["a","b"]' } },
    ]), target, row, codeDeps);
    expect(idOf(coded, 'Observation')).not.toBe(idOf(spelled, 'Observation'));
  });

  it('turns a coding into system and code for an id part', async () => {
    const res = await applyMapping(mapping([...baseRows, ...twoResults]), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    const R = res.resources.find((r) => r.resourceType === 'ServiceRequest')!.id!;
    const obs = res.resources.filter((r) => r.resourceType === 'Observation').map((r) => r.id);
    expect(obs).toEqual([hash(['Observation', R, 'c:["urn:test:codes","ta"]']), hash(['Observation', R, 'c:["urn:test:codes","tb"]'])]);
  });

  it('fails two results in one row with the same code, naming the source field', async () => {
    const res = await applyMapping(mapping([...baseRows, ...twoResults]), target, { ...row, test_b: 'TA' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'test_b' });
    if (!res.ok) expect(res.reason).not.toContain('TA');
  });

  it('puts no identifier value in any id', async () => {
    const res = await applyMapping(mapping([...baseRows, specNo]), target, { ...row, pat_no: 'QZX-P1', spec_no: 'QZX-S1' }, deps());
    if (!res.ok) throw new Error(res.reason);
    for (const r of res.resources) expect(r.id).not.toContain('QZX');
  });

  it('takes an async hashId, and throws on an id FHIR does not allow', async () => {
    const asyncDeps = { ...deps(), hashId: async (parts: string[]) => hash(parts) };
    expect(ids(await applyMapping(mapping(baseRows), target, row, asyncDeps))).toEqual(ids(await applyMapping(mapping(baseRows), target, row, deps())));
    for (const bad of ['has space', 'a'.repeat(65), '', 'a/b']) {
      await expect(applyMapping(mapping(baseRows), target, row, { ...deps(), hashId: () => bad })).rejects.toThrow('hashId');
    }
  });

  it('throws on a target with no identity for a record', async () => {
    const broken: MapTarget = { ...target, identity: target.identity.filter((i) => i.record !== 'Specimen') };
    await expect(applyMapping(mapping(baseRows), broken, row, deps())).rejects.toThrow('Specimen');
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

describe('a result with a comparator, and a unit with no number', () => {
  const resultRow = (rule?: FieldMapping['rule']): FieldMapping => ({
    targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' }, ...(rule ? { rule } : {}),
  });
  const obsOf = (res: Awaited<ReturnType<typeof applyMapping>>) => {
    if (!res.ok) throw new Error(res.reason);
    return res.resources.find((r) => r.resourceType === 'Observation') as Observation;
  };

  it('reads a leading > as the comparator and the rest as the number', async () => {
    const res = await applyMapping(mapping([...baseRows, resultRow()]), target, { ...row, result_a: '>100000' }, deps());
    expect(obsOf(res).valueQuantity).toEqual({ comparator: '>', value: 100000 });
  });

  it('reads <, <=, >= and spaces, through the Number rule with a decimal comma', async () => {
    const cases: [string, string, number][] = [['<0,5', '<', 0.5], ['<= 1,25', '<=', 1.25], ['>=12,5', '>=', 12.5]];
    for (const [cell, comparator, value] of cases) {
      const res = await applyMapping(mapping([...baseRows, resultRow({ kind: 'number', decimal: ',' })]), target, { ...row, result_a: cell }, deps());
      expect(obsOf(res).valueQuantity).toEqual({ comparator, value });
    }
  });

  it('writes no comparator for a plain number', async () => {
    const res = await applyMapping(mapping([...baseRows, resultRow({ kind: 'number', decimal: ',' })]), target, row, deps());
    expect(obsOf(res).valueQuantity).toEqual({ value: 12.5 });
  });

  it('fails a comparator with no number after it, naming the field and not the value', async () => {
    const res = await applyMapping(mapping([...baseRows, resultRow()]), target, { ...row, result_a: '>' }, deps());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('Observation.valueQuantity.value');
  });

  it('leaves a comparator alone on a field that has none in FHIR', async () => {
    const res = await applyMapping(mapping([...baseRows, { targetPath: 'Observation.valueString', from: { field: 'result_a' } }]), target, { ...row, result_a: '>100000' }, deps());
    expect(obsOf(res).valueString).toBe('>100000');
  });

  it('stores the text result without a unit when the row has no number, and notes it', async () => {
    const rows: FieldMapping[] = [
      ...baseRows,
      { targetPath: 'Observation.valueString', from: { field: 'result_a' } },
      { targetPath: 'Observation.valueQuantity.unit', from: { fixed: 'CFU/mL' } },
    ];
    const res = await applyMapping(mapping(rows), target, { ...row, result_a: 'Growth detected' }, deps());
    const obs = obsOf(res);
    expect(obs.valueString).toBe('Growth detected');
    expect(obs.valueQuantity).toBeUndefined();
    expect(res.ok && res.notes).toEqual(['Observation.valueQuantity.unit: no number in this row, so the unit was not stored']);
  });

  it('keeps the unit with its number, and notes nothing', async () => {
    const rows: FieldMapping[] = [...baseRows, resultRow(), { targetPath: 'Observation.valueQuantity.unit', from: { fixed: 'CFU/mL' } }];
    const res = await applyMapping(mapping(rows), target, { ...row, result_a: '>100000' }, deps());
    expect(obsOf(res).valueQuantity).toEqual({ comparator: '>', value: 100000, unit: 'CFU/mL' });
    expect(res.ok && res.notes).toBeUndefined();
  });
});

describe('nested data no mapping reads', () => {
  const nested = {
    ...row,
    culture: { status: 'Final', isolates: [{ organism: 'Escherichia coli' }] },
    microscopy: { white_cells: { value: '25-30' } },
    symptoms: ['Dysuria', 'Urinary frequency'],
    isolates: [{ organism: 'E. coli' }],
  };

  it('notes each object column, and each list of objects, by name and never by value', async () => {
    const res = await applyMapping(mapping(baseRows), target, nested, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.notes).toEqual([
      'culture: holds nested data no mapping reads, so it was not stored',
      'isolates: holds nested data no mapping reads, so it was not stored',
      'microscopy: holds nested data no mapping reads, so it was not stored',
    ]);
    expect(JSON.stringify(res.notes)).not.toContain('coli');
  });

  it('notes nothing for a flat row, or a list of plain values', async () => {
    const res = await applyMapping(mapping(baseRows), target, { ...row, symptoms: ['a', 'b'] }, deps());
    expect(res.ok && res.notes).toBeUndefined();
  });
});

describe('a blank result gives no result record', () => {
  const needs: MapTarget = {
    ...target,
    needsValue: ['Observation'],
    derived: [{ path: 'ServiceRequest.code', from: 'Observation.code' }],
  };
  const rows: FieldMapping[] = [
    ...baseRows,
    { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] } },
    { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] }, rule: { kind: 'number', decimal: ',' } },
  ];
  const typesOf = (res: Awaited<ReturnType<typeof applyMapping>>) => (res.ok ? res.resources.map((r) => r.resourceType) : res.reason);

  it.each([['an empty text', ''], ['a null', null], ['a missing key', undefined]])('makes no Observation for %s, and notes it', async (_, blank) => {
    const r: Record<string, unknown> = { ...row, result_b: blank };
    if (blank === undefined) delete r.result_b;
    const res = await applyMapping(mapping(rows), needs, r, deps());
    expect(typesOf(res)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    expect(res.ok && res.notes).toEqual(['Result: no result in this row, so no result record was stored']);
  });

  it('keeps the blank test on the order, through its derived test codes', async () => {
    const res = await applyMapping(mapping(rows), needs, { ...row, result_b: '' }, deps());
    if (!res.ok) throw new Error(res.reason);
    const order = res.resources.find((r) => r.resourceType === 'ServiceRequest') as ServiceRequest;
    expect(order.code?.coding?.map((c) => c.code)).toEqual(['TA', 'TB']);
  });

  it('keeps a zero', async () => {
    const res = await applyMapping(mapping(rows), needs, { ...row, result_b: '0' }, deps());
    if (!res.ok) throw new Error(res.reason);
    const values = res.resources.filter((r) => r.resourceType === 'Observation').map((o) => (o as Observation).valueQuantity?.value);
    expect(values).toEqual([12.5, 0]);
    expect(res.notes).toBeUndefined();
  });

  it('makes no Observation when every result is blank, and still stores the patient, specimen and order', async () => {
    const res = await applyMapping(mapping(rows), needs, { ...row, result_a: '', result_b: '' }, deps());
    expect(typesOf(res)).toEqual(['Patient', 'Specimen', 'ServiceRequest']);
  });

  it('leaves a target without needsValue as before', async () => {
    const res = await applyMapping(mapping(rows), target, { ...row, result_b: '' }, deps());
    expect(typesOf(res)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation', 'Observation']);
  });
});

describe('chunk 2: comparators written as one character, and list entries in reasons', () => {
  const listRows = (rule?: FieldMapping['rule']): FieldMapping[] => [
    ...baseRows,
    { targetPath: 'Observation.code', from: { field: 'tests' } },
    { targetPath: 'Observation.valueQuantity.value', from: { field: 'results' }, ...(rule ? { rule } : {}) },
  ];

  it('reads ≤ and ≥ as <= and >=, and stores the FHIR comparator', async () => {
    const cases: [string, string, number][] = [['≤0,5', '<=', 0.5], ['≥ 12,5', '>=', 12.5]];
    for (const [cell, comparator, value] of cases) {
      const res = await applyMapping(mapping([...baseRows, {
        targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' }, rule: { kind: 'number', decimal: ',' },
      }]), target, { ...row, result_a: cell }, deps());
      if (!res.ok) throw new Error(res.reason);
      const obs = res.resources.find((r) => r.resourceType === 'Observation') as Observation;
      expect(obs.valueQuantity).toEqual({ comparator, value });
    }
  });

  it('names the list entry a rule refuses, and never its value', async () => {
    const res = await applyMapping(mapping(listRows({ kind: 'number', decimal: '.' })), target,
      { ...row, tests: ['T1', 'T2', 'T3'], results: ['1', 'QZX7', '3'] }, deps());
    expect(res).toMatchObject({ ok: false, field: 'results' });
    if (res.ok) return;
    expect(res.reason).toBe('results: expected a number with a point as the decimal mark (entry 2 of 3)');
  });

  it('names the list entry that is not a single value', async () => {
    const res = await applyMapping(mapping(listRows()), target,
      { ...row, tests: ['T1', 'T2'], results: ['1', ['QZX7']] }, deps());
    expect(res).toMatchObject({ ok: false, field: 'results' });
    if (!res.ok) expect(res.reason).toBe('results: expected a single value, not a list or an object (entry 2 of 2)');
  });

  it('names the column and the entry when the writer refuses a list entry', async () => {
    const res = await applyMapping(mapping(listRows()), target,
      { ...row, tests: ['T1', 'T2', 'T3'], results: ['1', '2', '>'] }, deps());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/^Observation\.valueQuantity\.value .* \(results, entry 3 of 3\)$/);
    expect(res.reason).not.toContain('>');
  });

  it('keeps a one-column reason as it was', async () => {
    const res = await applyMapping(mapping([...baseRows, {
      targetPath: 'Observation.valueQuantity.value', from: { field: 'result_a' }, rule: { kind: 'number', decimal: '.' },
    }]), target, { ...row, result_a: 'QZX7' }, deps());
    if (!res.ok) expect(res.reason).toBe('result_a: expected a number with a point as the decimal mark');
    else throw new Error('expected a failure');
  });

  // The target's own optional identity part tells two results of one test apart.
  const dated: MapTarget = {
    ...target,
    fields: [...target.fields, { path: 'Observation.effectiveDateTime', label: 'Result date', required: false, repeats: true, valueSet: null }],
    identity: target.identity.map((i) => i.record === 'Observation'
      ? { ...i, parts: [...i.parts, { field: 'Observation.effectiveDateTime', optional: true }] }
      : i),
  };

  it('names the two list entries that give one result, and the field that would tell them apart', async () => {
    const res = await applyMapping(mapping(listRows()), dated,
      { ...row, tests: ['T1', 'T2', 'T1'], results: ['1', '2', '3'] }, deps());
    expect(res).toMatchObject({ ok: false, field: 'tests' });
    if (res.ok) return;
    expect(res.reason).toBe(
      'Test: the same for entries 1 and 3 of 3 in tests, so they would be one Observation record. Map Result date if the source has one, so each gets its own id.',
    );
  });

  it('names two columns that give one result, and gives no hint once the date is mapped', async () => {
    const twoCols: FieldMapping[] = [
      { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] } },
      { targetPath: 'Observation.valueQuantity.value', from: { fields: ['result_a', 'result_b'] }, rule: { kind: 'number', decimal: ',' } },
      { targetPath: 'Observation.effectiveDateTime', from: { fixed: '2026-11-17' } },
    ];
    const res = await applyMapping(mapping([...baseRows, ...twoCols]), dated, { ...row, test_b: 'TA' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'test_b' });
    if (!res.ok) expect(res.reason).toBe('Test: the same for test_a and test_b, so they would be one Observation record.');
  });
});
