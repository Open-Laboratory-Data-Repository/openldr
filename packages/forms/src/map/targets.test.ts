import { describe, expect, it } from 'vitest';
import type { Coding } from 'fhir/r4';
import { validateResource } from '@openldr/fhir';
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

  it('fills the status values FHIR requires, as form extraction does', () => {
    expect(target.defaults).toEqual([
      { path: 'ServiceRequest.status', value: 'active' },
      { path: 'ServiceRequest.intent', value: 'order' },
      { path: 'Observation.status', value: 'final' },
    ]);
  });

  it('makes every required entry of the four packs a required field', () => {
    const linkPaths = new Set(target.links.map((l) => l.path));
    for (const p of packs.filter((x) => LAB_PACKS.includes(x.id))) {
      for (const e of p.entries) {
        if (!e.required || !e.fhirPath || linkPaths.has(e.fhirPath)) continue;
        const f = target.fields.find((x) => parseTargetPath(x.path)?.path === e.fhirPath && x.label === e.label);
        expect(f, `${p.id}: ${e.label}`).toBeDefined();
        expect(f!.required, `${p.id}: ${e.label}`).toBe(true);
      }
    }
  });

  it('adds the patient identifier, which no pack holds, first and not required', () => {
    expect(target.fields[0]).toEqual({
      path: 'Patient.identifier.value', label: 'Patient ID', required: false, repeats: false, valueSet: null,
    });
    expect(packs.find((p) => p.id === 'pack-patient')!.entries.some((e) => e.fhirPath === 'Patient.identifier.value')).toBe(false);
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

  // Every field of the target but two. Order rejection's leaf is an Extension, which no single cell
  // can fill. Referring Facility shares ServiceRequest.requester with Requesting Clinician, and an
  // order has one requester, so a row maps one of the two. The writer refuses both cases (see below).
  const rows: FieldMapping[] = [
    { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
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

  function deps(): ApplyDeps {
    let n = 0;
    return {
      newId: () => `id-${++n}`,
      translateCode: async (_url, value): Promise<Coding | null> =>
        value === 'TA' || value === 'TB' ? { system: 'urn:test:codes', code: value.toLowerCase() } : null,
    };
  }

  it('covers every field but Referring Facility and Order rejection', () => {
    const mapped = new Set(rows.map((r) => r.targetPath));
    expect(target.fields.filter((f) => !mapped.has(f.path)).map((f) => f.label)).toEqual(['Referring Facility', 'Order rejection']);
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

  it('passes validateResource with only the required fields mapped', async () => {
    const required = new Set(target.fields.filter((f) => f.required).map((f) => f.path));
    const res = await applyMapping(mapping(rows.filter((r) => required.has(r.targetPath))), target, row, deps());
    if (!res.ok) throw new Error(res.reason);
    for (const r of res.resources) {
      const v = validateResource(r);
      expect(v.ok ? 'ok' : JSON.stringify(v.outcome), `${r.resourceType}/${r.id}`).toBe('ok');
    }
  });

  it('refuses a cell sent to Order rejection rather than write a broken extension', async () => {
    const res = await applyMapping(mapping([
      ...rows,
      { targetPath: 'ServiceRequest.extension?url=urn:openldr:ext:rejection', from: { field: 'notes' } },
    ]), target, row, deps());
    expect(res).toMatchObject({ ok: false, field: 'ServiceRequest.extension?url=urn:openldr:ext:rejection' });
  });
});
