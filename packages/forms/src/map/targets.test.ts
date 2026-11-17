import { describe, expect, it } from 'vitest';
import type { Coding } from 'fhir/r4';
import { validateBatch, validateResource, type StrictnessLevel } from '@openldr/fhir';
import { seededStarterPacks } from '../samples/starter-packs';
import { applyMapping, type ApplyDeps, type FieldMapping } from './apply';
import { parseTargetPath } from './target';
import { labResultTarget, listMapTargets, mapTargetById } from './targets';
import labelsFr from './labels.fr.json';
import labelsPt from './labels.pt.json';

const packs = seededStarterPacks();
const target = labResultTarget(packs);
const LAB_PACKS = ['pack-patient', 'pack-specimen', 'pack-service-request', 'pack-observation'];

describe('labResultTarget', () => {
  it('makes a Patient, a Specimen, an order and repeating results', () => {
    expect(target.id).toBe('lab-result');
    expect(target.name).toBe('Lab result');
    expect(target.records).toEqual([
      { type: 'Patient', packId: 'pack-patient', repeats: false },
      { type: 'Specimen', packId: 'pack-specimen', repeats: false },
      { type: 'ServiceRequest', packId: 'pack-service-request', repeats: false },
      { type: 'Observation', packId: 'pack-observation', repeats: true },
    ]);
    for (const f of target.fields) expect(f.repeats, f.path).toBe(f.path.startsWith('Observation.'));
  });

  it('links each result to its patient, specimen and order, and the order and specimen to the patient', () => {
    expect(target.links).toEqual([
      { from: 'Specimen', path: 'Specimen.subject', to: 'Patient' },
      { from: 'ServiceRequest', path: 'ServiceRequest.subject', to: 'Patient' },
      { from: 'ServiceRequest', path: 'ServiceRequest.specimen', to: 'Specimen' },
      { from: 'Observation', path: 'Observation.subject', to: 'Patient' },
      { from: 'Observation', path: 'Observation.specimen', to: 'Specimen' },
      { from: 'Observation', path: 'Observation.basedOn', to: 'ServiceRequest' },
    ]);
  });

  it('fills the status values FHIR requires, as form extraction does, and marks results as laboratory', () => {
    expect(target.defaults).toEqual([
      { path: 'ServiceRequest.status', value: 'active' },
      { path: 'ServiceRequest.intent', value: 'order' },
      { path: 'Observation.status', value: 'final' },
      { path: 'Observation.category', value: { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' } },
    ]);
  });

  it('requires only the short list, whatever the packs mark', () => {
    expect(target.fields.filter((f) => f.required).map((f) => f.path)).toEqual([
      'Patient.identifier.value', 'Specimen.collection.collectedDateTime', 'Observation.code',
    ]);
    // The packs keep their own flags for forms.
    const sr = packs.find((p) => p.id === 'pack-service-request')!;
    expect(sr.entries.find((e) => e.fhirPath === 'ServiceRequest.priority')?.required).toBe(true);
    expect(target.fields.every((f) => parseTargetPath(f.path) !== null)).toBe(true);
  });

  it('adds the patient identifier and its system, which no pack holds, first; the identifier is required', () => {
    expect(target.fields.slice(0, 2)).toEqual([
      { path: 'Patient.identifier.value', label: 'Patient ID', required: true, repeats: false, valueSet: null },
      { path: 'Patient.identifier.system', label: 'Patient ID system', required: false, repeats: false, valueSet: null },
    ]);
    expect(packs.find((p) => p.id === 'pack-patient')!.entries.some((e) => e.fhirPath?.startsWith('Patient.identifier'))).toBe(false);
  });

  it('identifies each record from the row, as the operator ruled', () => {
    expect(target.identity).toEqual([
      { record: 'Patient', parts: [{ field: 'Patient.identifier.system', optional: true }, { field: 'Patient.identifier.value' }] },
      {
        record: 'Specimen',
        parts: [{ record: 'Patient' }, { field: 'Specimen.accessionIdentifier.value' }],
        fallback: [{ record: 'Patient' }, { field: 'Specimen.collection.collectedDateTime' }],
      },
      { record: 'ServiceRequest', parts: [{ record: 'Specimen' }, { field: 'ServiceRequest.code' }], fallback: [{ record: 'Specimen' }] },
      { record: 'Observation', parts: [{ record: 'ServiceRequest' }, { field: 'Observation.code' }] },
    ]);
  });

  it('leaves out Order rejection, which no single cell can fill', () => {
    expect(target.fields.map((f) => f.path)).not.toContain('ServiceRequest.extension?url=urn:openldr:ext:rejection');
  });

  it('throws naming the pack when one is missing', () => {
    for (const id of LAB_PACKS) {
      expect(() => labResultTarget(packs.filter((p) => p.id !== id))).toThrow(id);
    }
  });

  it('takes stored packs, which carry more than the seed', () => {
    const stored = packs.map((p) => ({ ...p, seeded: true, createdAt: 'x', updatedAt: 'x' }));
    expect(labResultTarget(stored)).toEqual(target);
  });
});

describe('labels in French and Portuguese', () => {
  const paths = new Set(target.fields.map((f) => f.path));

  for (const [locale, file] of [['fr', labelsFr], ['pt', labelsPt]] as const) {
    it(`gives every field a ${locale} label, and keys only fields of the target`, () => {
      const labels = file as Record<string, string>;
      for (const f of target.fields) expect(labels[f.path]?.trim(), `${locale}: ${f.path}`).toBeTruthy();
      for (const key of Object.keys(labels)) expect(paths.has(key), `${locale}: ${key}`).toBe(true);
    });

    it(`uses the ${locale} labels for that locale`, () => {
      const t = labResultTarget(packs, locale);
      const labels = file as Record<string, string>;
      expect(t.fields.map((f) => f.label)).toEqual(target.fields.map((f) => labels[f.path]));
      expect(t.fields.map((f) => f.path)).toEqual(target.fields.map((f) => f.path));
    });
  }

  it('gives English for an unknown locale', () => {
    expect(labResultTarget(packs, 'xx')).toEqual(target);
  });
});

describe('listMapTargets and mapTargetById', () => {
  it('lists the Lab result target', () => {
    expect(listMapTargets(packs)).toEqual([target]);
    expect(listMapTargets(packs, 'pt')).toEqual([labResultTarget(packs, 'pt')]);
  });

  it('finds a target by id, or gives null', () => {
    expect(mapTargetById(packs, 'lab-result')).toEqual(target);
    expect(mapTargetById(packs, 'lab-result', 'fr')).toEqual(labResultTarget(packs, 'fr'));
    expect(mapTargetById(packs, 'nope')).toBeNull();
  });
});

describe('a fully mapped made-up row', () => {
  // Made-up values. The test codes come from a fake code list, as the terminology service would give them.
  const row = {
    pat_no: 'T-0001',
    first: 'Testa',
    last: 'Sample',
    dob: '2001-02-03',
    sex: 'female',
    phone: '000-000',
    collected: '2026-11-03T08:30:00Z',
    spec_type: 'spec-x',
    spec_no: 'S-0001',
    received: '2026-11-03T10:00:00Z',
    tests: 'test-panel-x',
    priority: 'routine',
    clinician: 'Dr Test',
    req_no: 'R-0001',
    notes: 'none',
    facility: 'Test clinic',
    test_a: 'TA',
    test_b: 'TB',
    num_a: '12.5',
    num_b: '7.1',
    text_a: 'see note',
    text_b: 'see note',
    unit_a: 'u-a',
    unit_b: 'u-b',
    res_date_a: '2026-11-04',
    res_date_b: '2026-11-04',
    flag_a: 'flag-x',
    flag_b: 'flag-y',
  };

  // Every field of the target but one. Referring Facility shares ServiceRequest.requester with
  // Requesting Clinician, and an order has one requester, so a row maps one of the two. The writer
  // refuses both at once (see below).
  const rows: FieldMapping[] = [
    { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
    { targetPath: 'Patient.identifier.system', from: { fixed: 'urn:test:patient-id' } },
    { targetPath: 'Patient.name.given?use=official', from: { field: 'first' } },
    { targetPath: 'Patient.name.family?use=official', from: { field: 'last' } },
    { targetPath: 'Patient.birthDate', from: { field: 'dob' } },
    { targetPath: 'Patient.gender', from: { field: 'sex' } },
    { targetPath: 'Patient.telecom.value?system=phone', from: { field: 'phone' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
    { targetPath: 'Specimen.type', from: { field: 'spec_type' } },
    { targetPath: 'Specimen.accessionIdentifier.value', from: { field: 'spec_no' } },
    { targetPath: 'Specimen.receivedTime', from: { field: 'received' } },
    { targetPath: 'ServiceRequest.code', from: { field: 'tests' } },
    { targetPath: 'ServiceRequest.priority', from: { field: 'priority' } },
    { targetPath: 'ServiceRequest.requester?type=Practitioner', from: { field: 'clinician' } },
    { targetPath: 'ServiceRequest.identifier.value?system=urn:openldr:order:requisition', from: { field: 'req_no' } },
    { targetPath: 'ServiceRequest.note.0.text', from: { field: 'notes' } },
    { targetPath: 'Observation.code', from: { fields: ['test_a', 'test_b'] }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
    { targetPath: 'Observation.valueQuantity.value', from: { fields: ['num_a', 'num_b'] } },
    { targetPath: 'Observation.valueString', from: { fields: ['text_a', 'text_b'] } },
    { targetPath: 'Observation.valueQuantity.unit', from: { fields: ['unit_a', 'unit_b'] } },
    { targetPath: 'Observation.effectiveDateTime', from: { fields: ['res_date_a', 'res_date_b'] } },
    { targetPath: 'Observation.interpretation', from: { fields: ['flag_a', 'flag_b'] } },
  ];

  const mapping = (r: FieldMapping[]) => ({ shapeHash: 'h', fieldNames: Object.keys(row).sort(), targetId: target.id, rows: r });

    // A tiny stable hash (FNV-1a 64), so ids are valid FHIR ids and hold no row value.
  function fnv(text: string): string {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, '0');
  }
  const hash = (parts: string[]) => fnv(JSON.stringify(parts));

  function deps(): ApplyDeps {
    return {
      hashId: hash,
      translateCode: async (_url, value): Promise<Coding | null> =>
        value === 'TA' || value === 'TB' ? { system: 'urn:test:codes', code: value.toLowerCase() } : null,
    };
  }

  it('covers every field but Referring Facility', () => {
    const mapped = new Set(rows.map((r) => r.targetPath));
    expect(target.fields.filter((f) => !mapped.has(f.path)).map((f) => f.label)).toEqual(['Referring Facility']);
  });

  it('puts the patient ID system and value in one identifier entry', async () => {
    const res = await applyMapping(mapping(rows), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect((res.resources[0] as unknown as Record<string, unknown>).identifier).toEqual([{ system: 'urn:test:patient-id', value: 'T-0001' }]);
  });

  it('gives ids from the row: the same row twice gives the same ids, and the parts are the ruled ones', async () => {
    const a = await applyMapping(mapping(rows), target, row, deps());
    const b = await applyMapping(mapping(rows), target, { ...row }, deps());
    if (!a.ok || !b.ok) throw new Error('not ok');
    expect(b.resources.map((r) => r.id)).toEqual(a.resources.map((r) => r.id));
    // Exactly what hashId receives for each record (Task 4 documents it).
    const P = hash(['Patient', 't:urn:test:patient-id', 't:T-0001']);
    const S = hash(['Specimen', P, 't:S-0001']);
    const R = hash(['ServiceRequest', S, 't:test-panel-x']);
    expect(a.resources.map((r) => r.id)).toEqual([
      P, S, R, hash(['Observation', R, 'c:["urn:test:codes","ta"]']), hash(['Observation', R, 'c:["urn:test:codes","tb"]']),
    ]);
  });

  it('identifies the specimen by its collected date when the row has no specimen number', async () => {
    const res = await applyMapping(mapping(rows), target, { ...row, spec_no: '' }, deps());
    if (!res.ok) throw new Error(res.reason);
    const P = hash(['Patient', 't:urn:test:patient-id', 't:T-0001']);
    expect(res.resources[1].id).toBe(hash(['Specimen', 'fallback', P, 't:2026-11-03T08:30:00Z']));
  });

  it('gives two ids when one row\'s specimen number equals another row\'s collected date, same patient', async () => {
    const a = await applyMapping(mapping(rows), target, { ...row, spec_no: '2026-11-03T08:30:00Z' }, deps());
    const b = await applyMapping(mapping(rows), target, { ...row, spec_no: '' }, deps());
    if (!a.ok || !b.ok) throw new Error('not ok');
    expect(a.resources[0].id).toBe(b.resources[0].id);
    expect(a.resources[1].id).not.toBe(b.resources[1].id);
  });

  it('holds a row whose required collected date is empty, naming that field as required', async () => {
    const short: FieldMapping[] = [
      { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
      { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
      { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
    ];
    const res = await applyMapping(mapping(short), target, { ...row, collected: '' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'Specimen.collection.collectedDateTime' });
    if (!res.ok) {
      expect(res.reason).toContain('Collected date');
      expect(res.reason).toContain('required');
    }
  });

  it('gives the order the specimen\'s id parts when the row has no order test code', async () => {
    const res = await applyMapping(mapping(rows.filter((r) => r.targetPath !== 'ServiceRequest.code')), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources[2].id).toBe(hash(['ServiceRequest', 'fallback', res.resources[1].id!]));
  });

  it('holds a row with no patient ID, naming the field', async () => {
    const res = await applyMapping(mapping(rows), target, { ...row, pat_no: '' }, deps());
    expect(res).toMatchObject({ ok: false, field: 'Patient.identifier.value' });
  });

  it('refuses Referring Facility beside Requesting Clinician, and passes it alone', async () => {
    const facility: FieldMapping = { targetPath: 'ServiceRequest.requester?type=Organization', from: { field: 'facility' } };
    const both = await applyMapping(mapping([...rows, facility]), target, row, deps());
    expect(both).toMatchObject({ ok: false, field: 'ServiceRequest.requester?type=Organization' });
    const alone = await applyMapping(mapping([...rows.filter((r) => !r.targetPath.startsWith('ServiceRequest.requester')), facility]), target, row, deps());
    if (!alone.ok) throw new Error(alone.reason);
    for (const r of alone.resources) expect(validateResource(r).ok, `${r.resourceType}/${r.id}`).toBe(true);
  });

  it('makes records that pass validateResource, linked as the target says', async () => {
    const res = await applyMapping(mapping(rows), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources.map((r) => r.resourceType)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation', 'Observation']);
    for (const r of res.resources) {
      const v = validateResource(r);
      expect(v.ok ? 'ok' : JSON.stringify(v.outcome), `${r.resourceType}/${r.id}`).toBe('ok');
    }
    const [patient, specimen, order, obs] = res.resources as unknown as Record<string, unknown>[];
    expect(specimen.subject).toEqual({ reference: `Patient/${patient.id}` });
    expect(order.subject).toEqual({ reference: `Patient/${patient.id}` });
    expect(order.specimen).toEqual([{ reference: `Specimen/${specimen.id}` }]);
    expect(order).toMatchObject({ status: 'active', intent: 'order' });
    expect(obs).toMatchObject({
      status: 'final',
      subject: { reference: `Patient/${patient.id}` },
      specimen: { reference: `Specimen/${specimen.id}` },
      basedOn: [{ reference: `ServiceRequest/${order.id}` }],
      valueQuantity: { value: 12.5, unit: 'u-a' },
      interpretation: [{ text: 'flag-x' }],
    });
  });

  const LEVELS: StrictnessLevel[] = ['low', 'medium', 'high'];
  const batchOpts = (level: StrictnessLevel) => ({ level, resolveServiceRequest: async () => false });
  const shortRows: FieldMapping[] = [
    { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
    { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
    { targetPath: 'Observation.valueQuantity.value', from: { field: 'num_a' } },
  ];

  it('maps a row with only patient ID, collected date, a test and a result, and the batch passes at every level', async () => {
    const res = await applyMapping(mapping(shortRows), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources.map((r) => r.resourceType)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    for (const r of res.resources) expect(validateResource(r).ok, `${r.resourceType}/${r.id}`).toBe(true);
    for (const level of LEVELS) {
      const v = await validateBatch(res.resources, batchOpts(level));
      expect(v.ok ? 'ok' : JSON.stringify(v.outcome), level).toBe('ok');
    }
  });

  it('marks a mapped result as laboratory, so the order rule runs on it, and fails it with no order link', async () => {
    const res = await applyMapping(mapping(shortRows), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    const obs = res.resources[3] as unknown as Record<string, unknown>;
    expect(obs.category).toEqual([{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }]);
    const { basedOn: _gone, ...unlinked } = obs;
    for (const level of ['medium', 'high'] as const) {
      expect((await validateBatch(res.resources, batchOpts(level))).ok, level).toBe(true);
      const v = await validateBatch([...res.resources.slice(0, 3), unlinked], batchOpts(level));
      expect(v.ok, level).toBe(false);
      if (!v.ok) expect(JSON.stringify(v.outcome), level).toContain('basedOn');
    }
    // At low the rule does not run.
    expect((await validateBatch([...res.resources.slice(0, 3), unlinked], batchOpts('low'))).ok).toBe(true);
  });

  it('passes validateResource with only the required fields mapped', async () => {
    const required = new Set(target.fields.filter((f) => f.required).map((f) => f.path));
    const res = await applyMapping(mapping(rows.filter((r) => required.has(r.targetPath))), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    for (const r of res.resources) {
      const v = validateResource(r);
      expect(v.ok ? 'ok' : JSON.stringify(v.outcome), `${r.resourceType}/${r.id}`).toBe('ok');
    }
  });

  it('refuses a cell a person sends to the Order rejection path rather than write a broken extension', async () => {
    const res = await applyMapping(mapping([
      ...rows,
      { targetPath: 'ServiceRequest.extension?url=urn:openldr:ext:rejection', from: { field: 'notes' } },
    ]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'ServiceRequest.extension?url=urn:openldr:ext:rejection' });
  });
});
