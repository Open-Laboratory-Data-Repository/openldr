import { describe, expect, it } from 'vitest';
import type { Coding } from 'fhir/r4';
import { validateBatch, validateResource, type StrictnessLevel } from '@openldr/fhir';
import { seededStarterPacks } from '../samples/starter-packs';
import { applyMapping, SavedMappingSchema, type ApplyDeps, type FieldMapping } from './apply';
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
      {
        record: 'Observation',
        parts: [{ record: 'ServiceRequest' }, { field: 'Observation.code' }, { field: 'Observation.effectiveDateTime', optional: true }],
      },
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
      // `$name` is the target's own name, not a field.
      for (const key of Object.keys(labels).filter((k) => k !== '$name')) expect(paths.has(key), `${locale}: ${key}`).toBe(true);
    });

    it(`names the target in ${locale}`, () => {
      const name = (file as Record<string, string>).$name;
      expect(name?.trim()).toBeTruthy();
      expect(labResultTarget(packs, locale).name).toBe(name);
      expect(name).not.toBe('Lab result');
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
      P, S, R,
      hash(['Observation', R, 'c:["urn:test:codes","ta"]', 't:2026-11-04']),
      hash(['Observation', R, 'c:["urn:test:codes","tb"]', 't:2026-11-04']),
    ]);
  });

  it('gives two results of one test on one order different ids when their result dates differ', async () => {
    const noSpec = { ...row, spec_no: '' };
    const morning = await applyMapping(mapping(rows), target, { ...noSpec, res_date_a: '2026-11-04T08:00:00Z' }, deps());
    const evening = await applyMapping(mapping(rows), target, { ...noSpec, res_date_a: '2026-11-04T18:00:00Z' }, deps());
    if (!morning.ok || !evening.ok) throw new Error('not ok');
    expect(evening.resources[2].id).toBe(morning.resources[2].id);
    expect(evening.resources[3].id).not.toBe(morning.resources[3].id);
  });

  it('refuses one column per test with one shared test code, as the docs say', async () => {
    const wide = { pat_no: 'T-0001', collected: '2026-11-03T08:30:00Z', test: 'TA', res_a: '1', res_b: '2' };
    const perColumn: FieldMapping[] = [
      { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
      { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
      { targetPath: 'Observation.code', from: { field: 'test' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
      { targetPath: 'Observation.valueString', from: { fields: ['res_a', 'res_b'] } },
    ];
    const res = await applyMapping({ shapeHash: 'h', fieldNames: Object.keys(wide).sort(), targetId: target.id, rows: perColumn }, target, wide, deps());
    expect(res).toEqual({ ok: false, reason: 'Test: two Observation records in this row have the same value, so they would share one id', field: 'test' });
  });

  it('gives a result with no result date mapped an empty date part', async () => {
    const res = await applyMapping(mapping(rows.filter((r) => r.targetPath !== 'Observation.effectiveDateTime')), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources[3].id).toBe(hash(['Observation', res.resources[2].id!, 'c:["urn:test:codes","ta"]', '']));
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
      interpretation: [{ text: 'flag-x', coding: [{ code: 'flag-x' }] }],
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

describe('a file with one column per test', () => {
  // The header of samples/lab-sample.csv, with made-up values. Each test column holds that test's result.
  const fnv = (text: string): string => {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, '0');
  };
  const hash = (parts: string[]) => fnv(JSON.stringify(parts));
  const deps = (): ApplyDeps => ({
    hashId: hash,
    translateCode: async (_url, value): Promise<Coding | null> => ({ system: 'urn:test:codes', code: `std-${value.toLowerCase()}` }),
  });
  const wide = {
    PatientID: 'T-0009', Sex: 'QZX-SEX', DOB: '2001-02-03', SpecimenNo: 'S-0009', Specimen: 'QZX-SPEC',
    CollectionDate: '2026-11-05', LocationType: 'QZX-LOC', Organism: 'QZX-ORG', OrganismCode: 'QZX-OC',
    AMP: 'QZX-R1', CIP: 'QZX-R2', GEN: 'QZX-R3',
  };
  const perColumn = (testRow: Partial<FieldMapping> = {}): FieldMapping[] => [
    { targetPath: 'Patient.identifier.value', from: { field: 'PatientID' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'CollectionDate' } },
    { targetPath: 'Observation.valueString', from: { fields: ['AMP', 'CIP', 'GEN'] } },
    { targetPath: 'Observation.code', from: { fixedList: ['AMP', 'CIP', 'GEN'] }, ...testRow },
  ];
  const mapping = (r: FieldMapping[]) => ({ shapeHash: 'h', fieldNames: Object.keys(wide).sort(), targetId: target.id, rows: r });
  type Rec = Record<string, unknown> & { resourceType: string; id: string };
  const results = (res: { resources: unknown[] }) => (res.resources as Rec[]).filter((r) => r.resourceType === 'Observation');

  it('gives one result per column, each with its own test, linked to the one order, specimen and patient', async () => {
    const res = await applyMapping(mapping(perColumn()), target, wide, deps());
    if (!res.ok) throw new Error(res.reason);
    const [patient, specimen, order] = res.resources as Rec[];
    const obs = results(res);
    expect(obs.map((o) => o.code)).toEqual([
      { text: 'AMP', coding: [{ code: 'AMP' }] },
      { text: 'CIP', coding: [{ code: 'CIP' }] },
      { text: 'GEN', coding: [{ code: 'GEN' }] },
    ]);
    expect(obs.map((o) => o.valueString)).toEqual(['QZX-R1', 'QZX-R2', 'QZX-R3']);
    for (const o of obs) {
      expect(o.subject).toEqual({ reference: `Patient/${patient.id}` });
      expect(o.specimen).toEqual({ reference: `Specimen/${specimen.id}` });
      expect(o.basedOn).toEqual([{ reference: `ServiceRequest/${order.id}` }]);
    }
  });

  it('gives the three results different ids, the same on every run', async () => {
    const a = await applyMapping(mapping(perColumn()), target, wide, deps());
    const b = await applyMapping(mapping(perColumn()), target, { ...wide }, deps());
    if (!a.ok || !b.ok) throw new Error('not ok');
    const ids = results(a).map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
    expect(results(b).map((o) => o.id)).toEqual(ids);
  });

  it('gives no result for a blank cell, though the test row has a test there', async () => {
    const res = await applyMapping(mapping(perColumn()), target, { ...wide, CIP: '  ' }, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(results(res).map((o) => (o.code as { text: string }).text)).toEqual(['AMP', 'GEN']);
  });

  it('maps the patient, specimen and order with no result when every test cell is blank', async () => {
    const res = await applyMapping(mapping(perColumn()), target, { ...wide, AMP: '', CIP: '', GEN: '' }, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources.map((r) => r.resourceType)).toEqual(['Patient', 'Specimen', 'ServiceRequest']);
  });

  it('fails a list of tests of the wrong length, naming the test field', async () => {
    const res = await applyMapping(mapping(perColumn({ from: { fixedList: ['AMP', 'CIP'] } })), target, wide, deps());
    expect(res).toMatchObject({ ok: false, field: 'Observation.code' });
  });

  it('fails a list of fixed values on a field that does not repeat, naming the key', async () => {
    const rows = [...perColumn(), { targetPath: 'Patient.gender', from: { fixedList: ['female'] } }];
    const res = await applyMapping(mapping(rows), target, wide, deps());
    expect(res).toEqual({
      ok: false,
      reason: 'Patient.gender: a list of fixed values is allowed only on a field of a repeating record',
      field: 'Patient.gender',
    });
  });

  it('fails two columns with the same test, as two results with one id', async () => {
    const res = await applyMapping(mapping(perColumn({ from: { fixedList: ['AMP', 'AMP', 'GEN'] } })), target, wide, deps());
    expect(res).toEqual({ ok: false, reason: 'Test: two Observation records in this row have the same value, so they would share one id', field: 'Observation.code' });
  });

  it('runs a Code list rule on the test row over each test', async () => {
    const res = await applyMapping(mapping(perColumn({ rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } })), target, wide, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(results(res).map((o) => o.code)).toEqual([
      { coding: [{ system: 'urn:test:codes', code: 'std-amp' }] },
      { coding: [{ system: 'urn:test:codes', code: 'std-cip' }] },
      { coding: [{ system: 'urn:test:codes', code: 'std-gen' }] },
    ]);
  });

  it('runs a rule on the result row over every column', async () => {
    const rows = perColumn().map((r) =>
      r.targetPath === 'Observation.valueString' ? { ...r, rule: { kind: 'values' as const, map: { 'QZX-R1': 'one', 'QZX-R2': 'two', 'QZX-R3': 'three' } } } : r,
    );
    const res = await applyMapping(mapping(rows), target, wide, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(results(res).map((o) => o.valueString)).toEqual(['one', 'two', 'three']);
  });

  it('keeps what a record with only fixed rows gives: one result for a fixed test', async () => {
    const base = perColumn().slice(0, 2);
    const one = await applyMapping(mapping([...base, { targetPath: 'Observation.code', from: { fixed: 'AMP' } }]), target, wide, deps());
    if (!one.ok) throw new Error(one.reason);
    expect(results(one)).toHaveLength(1);
  });

  it('fails a list of tests with no data row of the same length on the record, naming the test field', async () => {
    const base = perColumn().slice(0, 2);
    const reason = 'Observation.code: a list of fixed values needs a field of the same record that reads as many columns';
    // No data row at all.
    const none = await applyMapping(mapping([...base, { targetPath: 'Observation.code', from: { fixedList: ['AMP', 'CIP'] } }]), target, wide, deps());
    expect(none).toEqual({ ok: false, reason, field: 'Observation.code' });
    // One column and three tests would copy one value to three results.
    const one = await applyMapping(mapping([
      ...base,
      { targetPath: 'Observation.valueString', from: { fields: ['AMP'] } },
      { targetPath: 'Observation.code', from: { fixedList: ['AMP', 'CIP', 'GEN'] } },
    ]), target, wide, deps());
    expect(one).toEqual({ ok: false, reason, field: 'Observation.code' });
  });

  it('runs a Code list rule on the tests only where the row has a value', async () => {
    // The code list knows AMP and GEN, not CIP.
    const partial: ApplyDeps = {
      hashId: hash,
      translateCode: async (_url, value): Promise<Coding | null> => (value === 'CIP' ? null : { system: 'urn:test:codes', code: value.toLowerCase() }),
    };
    const rows = perColumn({ rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } });
    const blank = await applyMapping(mapping(rows), target, { ...wide, CIP: '' }, partial);
    if (!blank.ok) throw new Error(blank.reason);
    expect(results(blank).map((o) => o.code)).toEqual([
      { coding: [{ system: 'urn:test:codes', code: 'amp' }] },
      { coding: [{ system: 'urn:test:codes', code: 'gen' }] },
    ]);
    const filled = await applyMapping(mapping(rows), target, wide, partial);
    expect(filled).toEqual({ ok: false, reason: 'Observation.code: value has no match in the code list', field: 'Observation.code' });
  });

  it('passes the saved mapping schema with a list of tests, and refuses an empty list or an empty test', () => {
    expect(SavedMappingSchema.safeParse(mapping(perColumn())).success).toBe(true);
    expect(SavedMappingSchema.safeParse(mapping(perColumn({ from: { fixedList: [] } }))).success).toBe(false);
    expect(SavedMappingSchema.safeParse(mapping(perColumn({ from: { fixedList: ['AMP', ''] } }))).success).toBe(false);
  });
});

describe('the order takes its results\' tests when its own Tests field is not mapped', () => {
  const fnv = (text: string): string => {
    let h = 0xcbf29ce484222325n;
    for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return h.toString(16).padStart(16, '0');
  };
  const deps = (): ApplyDeps => ({
    hashId: (parts) => fnv(JSON.stringify(parts)),
    translateCode: async (_url, value): Promise<Coding | null> => ({ system: 'urn:test:codes', code: value.toLowerCase() }),
  });
  const row = { pid: 'T-0010', coll: '2026-11-05', t1: 'TA', t2: 'TA', t3: 'TB', r1: 'QZX-1', r2: 'QZX-2', r3: 'QZX-3', d1: '2026-11-05T08:00:00Z', d2: '2026-11-05T18:00:00Z', d3: '2026-11-05T08:00:00Z' };
  const base: FieldMapping[] = [
    { targetPath: 'Patient.identifier.value', from: { field: 'pid' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'coll' } },
  ];
  const mapping = (r: FieldMapping[]) => ({ shapeHash: 'h', fieldNames: Object.keys(row).sort(), targetId: target.id, rows: [...base, ...r] });
  type Rec = Record<string, unknown> & { resourceType: string; id: string };
  const orderOf = (res: { resources: unknown[] }) => (res.resources as Rec[]).find((r) => r.resourceType === 'ServiceRequest')!;

  it('declares the order\'s code as taken from the results\' codes', () => {
    expect(target.derived).toEqual([{ path: 'ServiceRequest.code', from: 'Observation.code' }]);
  });

  it('gives one result\'s code to the order', async () => {
    const res = await applyMapping(mapping([
      { targetPath: 'Observation.code', from: { field: 't1' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
      { targetPath: 'Observation.valueString', from: { field: 'r1' } },
    ]), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(orderOf(res).code).toEqual({ coding: [{ system: 'urn:test:codes', code: 'ta' }] });
  });

  it('gives three results with two distinct codes two codings, in order, duplicates dropped', async () => {
    const res = await applyMapping(mapping([
      { targetPath: 'Observation.code', from: { fields: ['t1', 't2', 't3'] }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
      { targetPath: 'Observation.valueString', from: { fields: ['r1', 'r2', 'r3'] } },
      { targetPath: 'Observation.effectiveDateTime', from: { fields: ['d1', 'd2', 'd3'] } },
    ]), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(res.resources.filter((r) => r.resourceType === 'Observation')).toHaveLength(3);
    expect(orderOf(res).code).toEqual({ coding: [{ system: 'urn:test:codes', code: 'ta' }, { system: 'urn:test:codes', code: 'tb' }] });
  });

  it('leaves a mapped Tests field as the row gives it', async () => {
    const res = await applyMapping(mapping([
      { targetPath: 'ServiceRequest.code', from: { field: 't3' } },
      { targetPath: 'Observation.code', from: { field: 't1' } },
    ]), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    expect(orderOf(res).code).toEqual({ text: 'TB', coding: [{ code: 'TB' }] });
  });

  it('gives the order the same id with and without the derived code', async () => {
    const rows: FieldMapping[] = [{ targetPath: 'Observation.code', from: { field: 't1' } }];
    const withIt = await applyMapping(mapping(rows), target, row, deps());
    const without = await applyMapping(mapping(rows), { ...target, derived: [] }, row, deps());
    if (!withIt.ok || !without.ok) throw new Error('not ok');
    expect(orderOf(without).code).toBeUndefined();
    expect(orderOf(withIt).id).toBe(orderOf(without).id);
  });
});

describe('a Values rule whose To is a code from a value set', () => {
  const deps: ApplyDeps = { hashId: (parts) => String(parts.length) + 'x' + parts.join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 40), translateCode: async () => null };
  const row = { pid: 'T-0011', coll: '2026-11-05', sex: 'F', spec: 'QZX-B', t: 'TA' };
  const rows: FieldMapping[] = [
    { targetPath: 'Patient.identifier.value', from: { field: 'pid' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'coll' } },
    { targetPath: 'Observation.code', from: { field: 't' } },
    { targetPath: 'Patient.gender', from: { field: 'sex' }, rule: { kind: 'values', map: { F: { system: 'urn:test:gender', code: 'female' } } } },
    { targetPath: 'Specimen.type', from: { field: 'spec' }, rule: { kind: 'values', map: { 'QZX-B': { system: 'urn:test:spec', code: 'bld' } } } },
  ];

  it('lands with its system on a CodeableConcept, and as its code on a code field like Sex', async () => {
    const res = await applyMapping({ shapeHash: 'h', fieldNames: Object.keys(row).sort(), targetId: target.id, rows }, target, row, deps);
    if (!res.ok) throw new Error(res.reason);
    const byType = (t: string) => res.resources.find((r) => r.resourceType === t) as unknown as Record<string, unknown>;
    expect(byType('Patient').gender).toBe('female');
    expect(byType('Specimen').type).toEqual({ coding: [{ system: 'urn:test:spec', code: 'bld' }] });
  });
});
