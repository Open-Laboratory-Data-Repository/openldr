import { describe, it, expect, vi } from 'vitest';
import { classify, seededStarterPacks, shapeOf, type FormField, type FormSchema, type SavedMapping } from '@openldr/forms';
import { validateBatch } from '@openldr/fhir';
import { runWorkflow, type RunFormValidateInput, type RunFormValidateOutput, type WorkflowItem, type WorkflowServices } from '@openldr/workflows';
// The CLI test reads the file codec the same way: the package index does not export it.
import { fileToRows } from '../../workflows/src/engine/node-handlers/file-codecs';
import { codingFromMapRows, createMapToFhirService, KNOWN_ISSUE_TEXTS, loadStoredPacks, type MapToFhirServiceDeps } from './map-to-fhir-service';

// Made-up values only. QZX marks a value that must never reach a reason.

const field = (over: Partial<FormField>): FormField => ({
  id: 'f', fhirPath: null, displayLabel: 'F', description: null, fieldType: 'text',
  required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' }, ...over,
}) as FormField;

const formSchema: FormSchema = {
  id: 'form-1', name: 'T', versionLabel: null, fhirVersion: null, fhirResourceType: null,
  fhirProfileUrl: null, facilityId: null, sections: [], targetPages: [],
  version: 1, active: true, status: 'published', createdAt: '', updatedAt: '',
  fields: [
    field({ id: 'answer_a', required: true }),
    field({ id: 'answer_b' }),
    field({ id: 'pick', fieldType: 'select', valueSetOptions: [{ code: 'one', display: 'One' }] } as Partial<FormField>),
  ],
} as FormSchema;

const PACKS = seededStarterPacks().map((p) => ({ id: p.id, resourceType: p.resourceType, entries: p.entries }));

const row = { pat_no: 'T-0001', collected: '2026-11-03T08:30:00Z', test_a: 'TA' };
const mapping: SavedMapping = {
  shapeHash: shapeOf(row).hash,
  fieldNames: Object.keys(row).sort(),
  targetId: 'lab-result',
  rows: [
    { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
    { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
    { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
  ],
};

const fhirPatient = { resourceType: 'Patient', id: 'p-1' };

// A fake form-validate service: a valid item gives one Observation record per item.
function fakeValidateForm() {
  return vi.fn(async ({ formId, items }: RunFormValidateInput): Promise<RunFormValidateOutput> => {
    const invalid: RunFormValidateOutput['meta']['invalid'] = [];
    const out: WorkflowItem[] = [];
    items.forEach((item, index) => {
      if (!item.json.answer_a) invalid.push({ index, errors: [{ fieldId: 'answer_a', reason: 'required' }] });
      else if (item.json.pick !== undefined && item.json.pick !== 'one') invalid.push({ index, errors: [{ fieldId: 'pick', reason: `'${String(item.json.pick)}' is not an allowed option` }] });
      else out.push({ json: { resourceType: 'Observation', id: 'form-record', status: 'final', code: { text: 'x' } } });
    });
    return { items: out, meta: { formId, validated: out.length, invalid } };
  });
}

function deps(over: Partial<MapToFhirServiceDeps> = {}): MapToFhirServiceDeps {
  return {
    forms: { get: vi.fn(async (id: string) => (id === 'form-1' ? { schema: formSchema } : null)) },
    validateForm: fakeValidateForm(),
    packs: async () => PACKS,
    translateCode: async (_url, value) => (value === 'TA' ? { system: 'urn:test:codes', code: 'ta' } : null),
    validate: (resources, knownOrderIds) => validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => knownOrderIds.has(id) }),
    ...over,
  };
}

const config = { targetId: 'lab-result', formIds: ['form-1'], mappings: [mapping] as unknown[] };

describe('createMapToFhirService', () => {
  it('passes FHIR, form and mapped items to out, and holds the unknown one', async () => {
    const svc = createMapToFhirService(deps());
    const unknown = { other_col: 'QZX' };
    const res = await svc({
      items: [{ json: fhirPatient }, { json: { answer_a: 'yes' } }, { json: row }, { json: unknown }],
      config,
    });
    expect(res.out.map((i) => i.json.resourceType)).toEqual(['Patient', 'Observation', 'Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    expect(res.held).toEqual([{ json: { item: unknown, reason: 'no mapping for this shape', shape: shapeOf(unknown) } }]);
    expect(res.held[0].json.item).not.toBe(unknown);
    expect(res.heldIndexes).toEqual([3]);
    expect(res.meta).toEqual({ fhir: 1, form: 1, mapped: 1, held: 1, heldReasons: ['no mapping for this shape'] });
  });

  it('holds a row that two saved mappings fit, with the shape, and counts it under held', async () => {
    const wider: SavedMapping = { ...mapping, fieldNames: [...mapping.fieldNames, 'ward'] };
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: row }], config: { ...config, mappings: [mapping, wider] } });
    expect(res.out).toEqual([]);
    expect(res.held).toEqual([{ json: { item: row, reason: 'more than one saved mapping fits this row', shape: shapeOf(row) } }]);
    expect(res.heldIndexes).toEqual([0]);
    expect(res.meta).toEqual({ fhir: 0, form: 0, mapped: 0, held: 1, heldReasons: ['more than one saved mapping fits this row'] });
  });

  it('holds a mapped item whose records fail the clinical rules, with the rule message', async () => {
    const validate = vi.fn(async () => ({
      ok: false as const,
      outcome: { resourceType: 'OperationOutcome' as const, issue: [{ severity: 'error' as const, code: 'business-rule' as const, diagnostics: 'laboratory result must reference a ServiceRequest (basedOn)' }] },
    }));
    const svc = createMapToFhirService(deps({ validate }));
    const res = await svc({ items: [{ json: row }], config });
    expect(res.out).toEqual([]);
    expect(res.held).toHaveLength(1);
    expect(res.held[0].json.item).toEqual(row);
    expect(res.held[0].json.reason).toContain('laboratory result must reference a ServiceRequest (basedOn)');
    expect(res.meta).toMatchObject({ fhir: 0, form: 0, mapped: 0, held: 1 });
  });

  it('gives the same record ids for the same mapped item twice, and no id holds the identifier', async () => {
    const svc = createMapToFhirService(deps());
    const a = await svc({ items: [{ json: row }], config });
    const b = await svc({ items: [{ json: { ...row } }], config });
    const ids = (r: typeof a) => r.out.map((i) => String(i.json.id));
    expect(ids(b)).toEqual(ids(a));
    expect(ids(a)).toHaveLength(4);
    for (const id of ids(a)) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(id).not.toContain('T-0001');
    }
  });

  it('holds a form item that fails validation, naming the field and no answer value', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: { answer_a: 'yes', pick: 'QZX' } }, { json: { answer_a: '', answer_b: 'QZX' } }], config });
    expect(res.out).toEqual([]);
    expect(res.held.map((h) => h.json.item)).toEqual([{ answer_a: 'yes', pick: 'QZX' }, { answer_a: '', answer_b: 'QZX' }]);
    const reasons = res.held.map((h) => String(h.json.reason));
    expect(reasons[0]).toContain('pick');
    expect(reasons[0]).toContain('is not an allowed option');
    expect(reasons[1]).toContain('answer_a');
    expect(reasons[1]).toContain('required');
    for (const r of reasons) expect(r).not.toContain('QZX');
  });

  it('falls back to the field id when a form reason has a shape it cannot strip', async () => {
    const validateForm = vi.fn(async ({ formId }: RunFormValidateInput): Promise<RunFormValidateOutput> => ({
      items: [],
      meta: { formId, validated: 0, invalid: [{ index: 0, errors: [{ fieldId: 'answer_b', reason: "odd 'QZX' reason" }] }] },
    }));
    const svc = createMapToFhirService(deps({ validateForm }));
    const res = await svc({ items: [{ json: { answer_a: 'yes' } }], config });
    expect(res.held[0].json.reason).toBe('form form-1: answer_b');
    expect(res.meta.heldReasons).toEqual(['form form-1: answer_b']);
  });

  it('holds a mapped item when a rule fails, naming the field and no value', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: { ...row, test_a: 'QZX' } }], config });
    expect(res.held).toHaveLength(1);
    expect(res.held[0].json.field).toBe('test_a');
    expect(String(res.held[0].json.reason)).not.toContain('QZX');
  });

  it('keeps the original json of a held item', async () => {
    const svc = createMapToFhirService(deps());
    const unknown = { nested: { a: ['QZX'] } };
    const res = await svc({ items: [{ json: unknown }], config });
    expect(res.held[0].json.item).toEqual({ nested: { a: ['QZX'] } });
  });

  it('never puts a value from a FHIR item in a held reason', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({
      items: [
        { json: { resourceType: 'Patient', id: 'p-2', gender: 'QZX' } },
        { json: { resourceType: 'Observation', id: 'o-1', status: 'final', code: { text: 'x' }, category: [{ coding: [{ code: 'laboratory' }] }], basedOn: [{ reference: 'ServiceRequest/QZX' }] } },
      ],
      config,
    });
    expect(res.held).toHaveLength(2);
    for (const h of res.held) {
      expect(String(h.json.reason)).not.toContain('QZX');
      expect(String(h.json.reason).length).toBeGreaterThan(0);
    }
  });

  it('unwraps a Bundle and a single resource, and keeps the Bundle item unchanged', async () => {
    const svc = createMapToFhirService(deps());
    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ fullUrl: 'urn:uuid:a', resource: { resourceType: 'Patient' } }, { resource: { resourceType: 'Observation', id: 'o-3', status: 'final', code: { text: 'x' }, subject: { reference: 'urn:uuid:a' } } }],
    };
    const before = JSON.parse(JSON.stringify(bundle));
    const res = await svc({ items: [{ json: bundle }, { json: fhirPatient }], config });
    expect(res.held).toEqual([]);
    expect(res.out.map((i) => i.json.resourceType)).toEqual(['Patient', 'Observation', 'Patient']);
    const firstId = String(res.out[0].json.id);
    expect((res.out[1].json.subject as { reference: string }).reference).toBe(`Patient/${firstId}`);
    expect(bundle).toEqual(before);
    expect(res.meta).toEqual({ fhir: 2, form: 0, mapped: 0, held: 0, heldReasons: [] });
  });

  it('holds a Bundle the unwrap refuses, with the fixed reason and its original json', async () => {
    const svc = createMapToFhirService(deps());
    const bad = { resourceType: 'Bundle', type: 'QZX', entry: [] };
    const res = await svc({ items: [{ json: bad }], config });
    expect(res.held).toEqual([{ json: { item: bad, reason: 'not a FHIR Bundle this node can unwrap' } }]);
  });

  it('throws when the target id is unknown', async () => {
    const svc = createMapToFhirService(deps());
    await expect(svc({ items: [{ json: row }], config: { ...config, targetId: 'no-such-target' } })).rejects.toThrow(/no-such-target/);
  });

  it('throws when there are mappings and no target id', async () => {
    const svc = createMapToFhirService(deps());
    await expect(svc({ items: [], config: { ...config, targetId: '' } })).rejects.toThrow(/targetId/);
  });

  it('throws when a mapping does not parse, naming the node config', async () => {
    const svc = createMapToFhirService(deps());
    await expect(svc({ items: [], config: { ...config, mappings: [{ shapeHash: '' }] } })).rejects.toThrow(/Map to FHIR node config: mapping 0/);
  });

  it('throws when a mapping was made for another target', async () => {
    const svc = createMapToFhirService(deps());
    await expect(svc({ items: [], config: { ...config, mappings: [{ ...mapping, targetId: 'other' }] } })).rejects.toThrow(/mapping 0/);
  });

  it('throws when a form id does not exist', async () => {
    const svc = createMapToFhirService(deps());
    await expect(svc({ items: [], config: { ...config, formIds: ['no-such-form'] } })).rejects.toThrow(/no-such-form/);
  });

  it('works for FHIR and forms with no mappings and no target', async () => {
    const packs = vi.fn(async () => PACKS);
    const svc = createMapToFhirService(deps({ packs }));
    const res = await svc({ items: [{ json: fhirPatient }, { json: { answer_a: 'yes' } }], config: { targetId: '', formIds: ['form-1'], mappings: [] } });
    expect(res.meta).toEqual({ fhir: 1, form: 1, mapped: 0, held: 0, heldReasons: [] });
    expect(packs).not.toHaveBeenCalled();
  });

  // The default Ingest node has a target and no mapping. Its runs must not depend on the packs.
  it.each(['lab-result', 'no-such-target'])('reads no packs with no mappings and targetId %s', async (targetId) => {
    const packs = vi.fn(async () => PACKS);
    const svc = createMapToFhirService(deps({ packs }));
    const res = await svc({ items: [{ json: fhirPatient }, { json: { answer_a: 'yes' } }], config: { targetId, formIds: ['form-1'], mappings: [] } });
    expect(res.meta).toEqual({ fhir: 1, form: 1, mapped: 0, held: 0, heldReasons: [] });
    expect(packs).not.toHaveBeenCalled();
  });

  it('runs even when the packs would fail, as long as there is no mapping', async () => {
    const packs = vi.fn(async () => { throw new Error('Map to FHIR: starter pack pack-patient is not stored'); });
    const svc = createMapToFhirService(deps({ packs }));
    const res = await svc({ items: [{ json: fhirPatient }], config: { targetId: 'lab-result', formIds: [], mappings: [] } });
    expect(res.out).toHaveLength(1);
    expect(packs).not.toHaveBeenCalled();
  });

  it('reads the packs once per call when there is a mapping', async () => {
    const packs = vi.fn(async () => PACKS);
    const svc = createMapToFhirService(deps({ packs }));
    await svc({ items: [{ json: row }, { json: row }], config });
    expect(packs).toHaveBeenCalledTimes(1);
    await svc({ items: [{ json: row }], config });
    expect(packs).toHaveBeenCalledTimes(2);
  });
});

describe('codingFromMapRows', () => {
  const r = (targetCode: string, equivalence: string | null = 'equivalent', targetSystem = 'urn:test:tgt') => ({ targetSystem, targetCode, equivalence });

  it('gives null for no rows', () => {
    expect(codingFromMapRows([])).toBeNull();
  });

  it('gives the one target', () => {
    expect(codingFromMapRows([r('T1')])).toEqual({ system: 'urn:test:tgt', code: 'T1' });
  });

  it('gives one target when two rows name it', () => {
    expect(codingFromMapRows([r('T1'), r('T1', null)])).toEqual({ system: 'urn:test:tgt', code: 'T1' });
  });

  it('gives several for two different targets', () => {
    expect(codingFromMapRows([r('T1'), r('T2')])).toBe('several');
    expect(codingFromMapRows([r('T1'), r('T1', 'equivalent', 'urn:test:other')])).toBe('several');
  });

  it('ignores an unmatched or disjoint row beside a real one', () => {
    expect(codingFromMapRows([r('T1'), r('T2', 'unmatched'), r('T3', 'disjoint')])).toEqual({ system: 'urn:test:tgt', code: 'T1' });
    expect(codingFromMapRows([r('T2', 'unmatched')])).toBeNull();
  });

  it('counts only equivalent, equal, unstated and CE\'s own SAME-AS rows as a match', () => {
    for (const eq of ['equivalent', 'equal', null, 'SAME-AS']) expect(codingFromMapRows([r('T1', eq)]), String(eq)).toEqual({ system: 'urn:test:tgt', code: 'T1' });
    for (const eq of ['narrower', 'wider', 'inexact', 'relatedto', 'subsumes', 'specializes', 'NARROWER-THAN', 'BROADER-THAN', 'RELATED-TO', 'UNMAPPED-FROM']) {
      expect(codingFromMapRows([r('T1', eq)]), eq).toBeNull();
    }
    expect(codingFromMapRows([r('T1'), r('T2', 'wider')])).toEqual({ system: 'urn:test:tgt', code: 'T1' });
  });
});

describe('loadStoredPacks', () => {
  it('reads each pack id from the store', async () => {
    const get = vi.fn(async (id: string) => ({ id, resourceType: 'Patient', entries: [] }));
    expect(await loadStoredPacks({ get }, ['a', 'b'])).toEqual([
      { id: 'a', resourceType: 'Patient', entries: [] },
      { id: 'b', resourceType: 'Patient', entries: [] },
    ]);
  });

  it('throws naming a pack the store does not hold', async () => {
    await expect(loadStoredPacks({ get: async () => null }, ['pack-x'])).rejects.toThrow(/pack-x/);
  });
});

describe('held reasons hold no value', () => {
  const labObs = (id: string, basedOn?: string) => ({
    resourceType: 'Observation', id, status: 'final', code: { text: 'x' },
    category: [{ coding: [{ code: 'laboratory' }] }],
    ...(basedOn ? { basedOn: [{ reference: `ServiceRequest/${basedOn}` }] } : {}),
  });

  it('holds a lab Observation whose order is nowhere, with no id or reference in the reason', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: labObs('QZX-ID-1', 'QZX-REF-1') }, { json: labObs('QZX-ID-2') }], config });
    expect(res.held).toHaveLength(2);
    expect(res.held[0].json.reason).toBe('record 1 (Observation) basedOn: basedOn ServiceRequest not found in batch or store');
    expect(res.held[1].json.reason).toBe('record 1 (Observation) basedOn: laboratory result must reference a ServiceRequest (basedOn)');
    for (const h of res.held) expect(String(h.json.reason)).not.toContain('QZX');
  });

  it('gives a structural failure whose message quotes a value no value', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: { resourceType: 'Patient', id: 'p-9', gender: 'QZX' } }, { json: { resourceType: 'QZXType', id: 'x' } }], config });
    expect(res.held).toHaveLength(2);
    expect(res.held[0].json.reason).toBe('record 1 (Patient) gender: this value is not one the field accepts');
    expect(res.held[1].json.reason).toBe('record 1 resourceType: unsupported resourceType');
    for (const h of res.held) expect(String(h.json.reason)).not.toContain('QZX');
  });

  const failWith = (expression: string) =>
    vi.fn(async () => ({
      ok: false as const,
      outcome: { resourceType: 'OperationOutcome' as const, issue: [{ severity: 'error' as const, code: 'business-rule', diagnostics: 'something about QZX', expression: [expression] }] },
    }));

  it('gives the fixed text only when the expression matches no record', async () => {
    const svc = createMapToFhirService(deps({ validate: failWith('Patient/QZX-ID-3.extension.QZX key.value') }));
    const res = await svc({ items: [{ json: fhirPatient }], config });
    expect(res.held[0].json.reason).toBe('failed the business-rule check');
  });

  it('turns a path segment FHIR does not know at that place into *', async () => {
    const svc = createMapToFhirService(deps({ validate: failWith('Patient/p-1.extension.QZXkey.value') }));
    const res = await svc({ items: [{ json: fhirPatient }], config });
    expect(res.held[0].json.reason).toBe('record 1 (Patient) extension.*.*: failed the business-rule check');
  });

  it('keeps the path parts FHIR knows, and indexes', async () => {
    const svc = createMapToFhirService(deps({ validate: failWith('Patient/p-1.name.0.given.1') }));
    const res = await svc({ items: [{ json: fhirPatient }], config });
    expect(res.held[0].json.reason).toBe('record 1 (Patient) name.0.given.1: failed the business-rule check');
  });

  const DOTTED_IDS = ['abc.QZX', 'p.12345', 'QZX.Smith.basedOn'];
  const LEAKS = ['QZX', '12345', 'Smith', 'abc'];

  it('drops a dotted record id whole from a reason and from heldReasons', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: DOTTED_IDS.map((id) => ({ json: labObs(id, 'sr-missing') })), config });
    expect(res.held).toHaveLength(3);
    for (const h of res.held) expect(h.json.reason).toBe('record 1 (Observation) basedOn: basedOn ServiceRequest not found in batch or store');
    for (const text of [...res.held.map((h) => String(h.json.reason)), ...res.meta.heldReasons]) {
      for (const leak of LEAKS) expect(text).not.toContain(leak);
    }
  });

  it('places the issue on the record whose whole prefix matches, when one id starts another', async () => {
    const svc = createMapToFhirService(deps());
    const bundle = { resourceType: 'Bundle', type: 'collection', entry: [{ resource: labObs('abc', 'sr-1') }, { resource: labObs('abc.basedOn') }, { resource: { resourceType: 'ServiceRequest', id: 'sr-1', status: 'active', intent: 'order', subject: { reference: 'Patient/p-1' } } }] };
    const res = await svc({ items: [{ json: bundle }], config });
    expect(res.held[0].json.reason).toBe('record 2 (Observation) basedOn: laboratory result must reference a ServiceRequest (basedOn)');
  });

  it('keeps dotted ids out of the handler\'s thrown message', async () => {
    const svc = createMapToFhirService(deps());
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'm', type: 'action', data: { action: 'map-to-fhir', config: {} } },
      { id: 'a', type: 'action', data: { action: 'no-op' } },
    ];
    const edges = [{ id: 'e0', source: 't', target: 'm' }, { id: 'e1', source: 'm', target: 'a', sourceHandle: 'out' }];
    const res = await runWorkflow(nodes as never, edges as never, {
      input: DOTTED_IDS.map((id) => labObs(id, 'sr-missing')),
      services: { mapToFhir: svc } as unknown as WorkflowServices,
    });
    const error = String(res.results.find((r) => r.nodeId === 'm')?.error);
    expect(error).toContain('3 item(s) held and the held port is not connected');
    for (const leak of LEAKS) expect(error).not.toContain(leak);
  });

  it('pins the rule texts it keeps to the real rule', async () => {
    const missing = await validateBatch([labObs('o-1')], { level: 'high', resolveServiceRequest: async () => false });
    const notFound = await validateBatch([labObs('o-1', 'sr-x')], { level: 'high', resolveServiceRequest: async () => false });
    if (missing.ok || notFound.ok) throw new Error('expected failures');
    expect(KNOWN_ISSUE_TEXTS.some((k) => k.text === missing.outcome.issue[0].diagnostics)).toBe(true);
    expect(KNOWN_ISSUE_TEXTS.some((k) => k.prefix && String(notFound.outcome.issue[0].diagnostics).startsWith(`${k.text}:`))).toBe(true);
  });

  it('keeps the validator\'s date texts, pinned to the real validator', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({
      items: [{ json: { resourceType: 'Patient', id: 'p-1', birthDate: 'QZX-1' } }, { json: { resourceType: 'Specimen', id: 's-1', receivedTime: 'QZX-2' } }],
      config,
    });
    expect(res.held.map((h) => h.json.reason)).toEqual(['record 1 (Patient) birthDate: invalid FHIR date', 'record 1 (Specimen) receivedTime: invalid FHIR dateTime']);
    for (const text of ['invalid FHIR date', 'invalid FHIR dateTime', 'invalid FHIR instant']) {
      expect(KNOWN_ISSUE_TEXTS.some((k) => k.text === text && !k.prefix), text).toBe(true);
    }
  });

  it('keeps only known form reason shapes, with the value cut', async () => {
    const reasons = ["'QZX' is not an allowed option", "'QZX' is not a number", 'required', 'must be selected from the list', 'must be >= 3', 'must be <= 9', 'exceeds max length 20', 'a new QZX reason'];
    const validateForm = vi.fn(async ({ formId }: RunFormValidateInput): Promise<RunFormValidateOutput> => ({
      items: [],
      meta: { formId, validated: 0, invalid: [{ index: 0, errors: reasons.map((reason, i) => ({ fieldId: `f${i}`, reason })) }] },
    }));
    const svc = createMapToFhirService(deps({ validateForm }));
    const res = await svc({ items: [{ json: { answer_a: 'yes' } }], config });
    expect(res.held[0].json.reason).toBe(
      'form form-1: f0 is not an allowed option; f1 is not a number; f2 required; f3 must be selected from the list; f4 must be >= 3; f5 must be <= 9; f6 exceeds max length 20; f7',
    );
  });

  it('keeps at most 20 held reasons, in input order', async () => {
    const svc = createMapToFhirService(deps());
    const items = Array.from({ length: 25 }, (_, i) => ({ json: { [`col_${i}`]: 'QZX' } }));
    const res = await svc({ items, config });
    expect(res.held).toHaveLength(25);
    expect(res.meta.heldReasons).toHaveLength(20);
    expect(res.heldIndexes).toEqual(items.map((_, i) => i));
  });
});

describe('an order in the same run counts', () => {
  const order = (id: string, status = 'active') => ({ resourceType: 'ServiceRequest', id, status, intent: 'order', subject: { reference: 'Patient/p-1' } });
  const result = (id: string, sr: string) => ({
    resourceType: 'Observation', id, status: 'final', code: { text: 'x' },
    category: [{ coding: [{ code: 'laboratory' }] }], basedOn: [{ reference: `ServiceRequest/${sr}` }],
  });

  it('sends out a result whose order came in an earlier item', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: order('sr-1') }, { json: result('o-1', 'sr-1') }], config });
    expect(res.held).toEqual([]);
    expect(res.out.map((i) => i.json.id)).toEqual(['sr-1', 'o-1']);
  });

  it('sends out a result whose order comes in a later item', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: result('o-1', 'sr-1') }, { json: order('sr-1') }], config });
    expect(res.held).toEqual([]);
    expect(res.out.map((i) => i.json.id)).toEqual(['o-1', 'sr-1']);
  });

  it('holds the result when its order\'s own item is held', async () => {
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: [{ json: result('o-1', 'sr-1') }, { json: order('sr-1', 'QZX') }], config });
    expect(res.out).toEqual([]);
    expect(res.heldIndexes).toEqual([0, 1]);
    expect(res.held[0].json.reason).toContain('not found');
  });

  it('stops counting the orders of an item the order rule holds, and holds what needed them in the next pass', async () => {
    // Item 0 carries order sr-1 and a lab result with no basedOn, so the rule holds it in pass 1.
    // Item 1 passes in pass 1 through sr-1, and is held in pass 2 once sr-1 stops counting.
    const first = { resourceType: 'Bundle', type: 'collection', entry: [{ resource: order('sr-1') }, { resource: { ...result('o-0', 'sr-1'), basedOn: undefined } }] };
    const validate = vi.fn((resources: unknown[], known: ReadonlySet<string>) =>
      validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => known.has(id) }),
    );
    const res = await createMapToFhirService(deps({ validate }))({ items: [{ json: JSON.parse(JSON.stringify(first)) }, { json: result('o-1', 'sr-1') }], config });
    expect(res.heldIndexes).toEqual([0, 1]);
    expect(res.held[0].json.reason).toContain('must reference a ServiceRequest');
    expect(res.held[1].json.reason).toContain('not found');
    // Pass 1 checks both items with sr-1 known; pass 2 checks item 1 with nothing known.
    expect(validate.mock.calls.map((c) => [...c[1]])).toEqual([['sr-1'], ['sr-1'], []]);
  });

  it('asks the store for an order the run does not hold', async () => {
    const svc = createMapToFhirService(deps({
      validate: (resources, known) => validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => known.has(id) || id === 'sr-stored' }),
    }));
    const res = await svc({ items: [{ json: result('o-1', 'sr-stored') }], config });
    expect(res.held).toEqual([]);
  });
});

describe('one run, several rows', () => {
  const wide = { pat_no: 'T-0001', first: '', collected: '2026-11-03T08:30:00Z', test_a: 'TA', num_a: '' };
  const wideMapping: SavedMapping = {
    shapeHash: shapeOf(wide).hash,
    fieldNames: Object.keys(wide).sort(),
    targetId: 'lab-result',
    rows: [
      { targetPath: 'Patient.identifier.value', from: { field: 'pat_no' } },
      { targetPath: 'Patient.name.given?use=official', from: { field: 'first' } },
      { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'collected' } },
      { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: 'urn:test:map' } },
      { targetPath: 'Observation.valueString', from: { field: 'num_a' } },
    ],
  };
  const cfg = { targetId: 'lab-result', formIds: [], mappings: [wideMapping] as unknown[] };
  const types = (res: { out: WorkflowItem[] }) => res.out.map((i) => i.json.resourceType);
  const anyCode: MapToFhirServiceDeps['translateCode'] = async (_url, value) => ({ system: 'urn:test:codes', code: String(value).toLowerCase() });

  it('sends the first of two rows that give one result with other values, and holds the second with a fixed reason', async () => {
    const svc = createMapToFhirService(deps({ translateCode: anyCode }));
    const res = await svc({ items: [{ json: { ...wide, num_a: 'QZX-1' } }, { json: { ...wide, num_a: 'QZX-2' } }], config: cfg });
    expect(types(res)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    expect(res.out[3].json.valueString).toBe('QZX-1');
    expect(res.heldIndexes).toEqual([1]);
    expect(res.held[0].json.reason).toBe('this row gives a result that an earlier row of this run already gave, with other values');
    expect(JSON.stringify(res.meta)).not.toContain('QZX');
  });

  it('sends one set of records for two identical rows', async () => {
    const svc = createMapToFhirService(deps({ translateCode: anyCode }));
    const res = await svc({ items: [{ json: { ...wide, num_a: 'QZX-1' } }, { json: { ...wide, num_a: 'QZX-1' } }], config: cfg });
    expect(types(res)).toEqual(['Patient', 'Specimen', 'ServiceRequest', 'Observation']);
    expect(res.held).toEqual([]);
    expect(res.meta).toMatchObject({ mapped: 2, held: 0 });
  });

  it('merges one patient from two rows: the second fills the name the first lacks', async () => {
    const svc = createMapToFhirService(deps({ translateCode: anyCode }));
    const res = await svc({
      items: [{ json: { ...wide, test_a: 'TA', num_a: 'QZX-1' } }, { json: { ...wide, first: 'QZX-NAME', test_a: 'TB', num_a: 'QZX-2' } }],
      config: cfg,
    });
    const patients = res.out.filter((i) => i.json.resourceType === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].json.name).toEqual([{ use: 'official', given: ['QZX-NAME'] }]);
    expect(res.out[0].json.resourceType).toBe('Patient');
  });

  it('keeps the first value and does not let a thin row empty a full one', async () => {
    const svc = createMapToFhirService(deps({ translateCode: anyCode }));
    const res = await svc({
      items: [{ json: { ...wide, first: 'QZX-A', num_a: 'QZX-1' } }, { json: { ...wide, first: '', test_a: 'TB', num_a: 'QZX-2' } }, { json: { ...wide, first: 'QZX-B', test_a: 'TC', num_a: 'QZX-3' } }],
      config: cfg,
    });
    const patients = res.out.filter((i) => i.json.resourceType === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].json.name).toEqual([{ use: 'official', given: ['QZX-A'] }]);
  });

  it('sends one Patient for 50 rows of one patient, and every result link resolves', async () => {
    const svc = createMapToFhirService(deps({ translateCode: anyCode }));
    const items = Array.from({ length: 50 }, (_, i) => ({ json: { ...wide, test_a: `T${i}`, num_a: `QZX-${i}` } }));
    const res = await svc({ items, config: cfg });
    expect(res.held).toEqual([]);
    expect(types(res).filter((t) => t === 'Patient')).toHaveLength(1);
    expect(types(res).filter((t) => t === 'Specimen')).toHaveLength(1);
    expect(types(res).filter((t) => t === 'ServiceRequest')).toHaveLength(1);
    expect(types(res).filter((t) => t === 'Observation')).toHaveLength(50);
    const ids = new Set(res.out.map((i) => `${i.json.resourceType}/${i.json.id}`));
    for (const o of res.out.filter((i) => i.json.resourceType === 'Observation')) {
      for (const key of ['subject', 'specimen']) expect(ids.has((o.json[key] as { reference: string }).reference)).toBe(true);
      expect(ids.has((o.json.basedOn as { reference: string }[])[0].reference)).toBe(true);
    }
  });

  it('takes nothing into the merge from a held row', async () => {
    const validate: MapToFhirServiceDeps['validate'] = async (resources, known) => {
      const p = resources.find((r) => (r as { resourceType?: string }).resourceType === 'Patient') as { name?: unknown } | undefined;
      if (p?.name) return { ok: false, outcome: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'business-rule', diagnostics: 'x' }] } };
      return validateBatch(resources, { level: 'high', resolveServiceRequest: async (id) => known.has(id) });
    };
    const svc = createMapToFhirService(deps({ validate, translateCode: anyCode }));
    const res = await svc({ items: [{ json: { ...wide, num_a: 'QZX-1' } }, { json: { ...wide, first: 'QZX-NAME', test_a: 'TB', num_a: 'QZX-2' } }], config: cfg });
    expect(res.heldIndexes).toEqual([1]);
    const patients = res.out.filter((i) => i.json.resourceType === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].json.name).toBeUndefined();
  });
});

describe('the lab\'s own code list', () => {
  const LOCAL = 'urn:openldr:terminology:local-map';
  const localRow = (sourceSystem?: string): SavedMapping => ({
    ...mapping,
    rows: [
      mapping.rows[0],
      mapping.rows[1],
      { targetPath: 'Observation.code', from: { field: 'test_a' }, rule: { kind: 'codeList', conceptMapUrl: LOCAL, ...(sourceSystem ? { sourceSystem } : {}) } },
    ],
  });

  it('gives no match without a source system, and never asks the store', async () => {
    const translateCode = vi.fn(async () => ({ system: 'urn:test:codes', code: 'ta' }));
    const svc = createMapToFhirService(deps({ translateCode }));
    const res = await svc({ items: [{ json: row }], config: { ...config, mappings: [localRow()] } });
    expect(res.out).toEqual([]);
    expect(res.held[0].json.reason).toBe('test_a: value has no match in the code list');
    expect(translateCode).not.toHaveBeenCalled();
  });

  it('looks up the code with the source system the rule names', async () => {
    const translateCode = vi.fn(async () => ({ system: 'urn:test:codes', code: 'ta' }));
    const svc = createMapToFhirService(deps({ translateCode }));
    const res = await svc({ items: [{ json: row }], config: { ...config, mappings: [localRow('urn:test:src')] } });
    expect(res.held).toEqual([]);
    expect(translateCode).toHaveBeenCalledWith(LOCAL, 'TA', 'urn:test:src');
  });
});

describe('a file with one column per test, end to end through the real pieces', () => {
  // The header of samples/lab-sample.csv, with made-up rows of the same shape. Each test column
  // holds that test's result; a blank cell is no result.
  const csv = [
    'PatientID,Sex,DOB,SpecimenNo,Specimen,CollectionDate,LocationType,Organism,OrganismCode,AMP,CIP,GEN',
    'T-0101,QZX-S,2001-02-03,S-0101,QZX-SP,2026-11-05,QZX-L,QZX-O,QZX-OC,QZX-R1,QZX-R2,QZX-R3',
    'T-0102,QZX-S,2001-02-04,S-0102,QZX-SP,2026-11-06,QZX-L,QZX-O,QZX-OC,QZX-R4,,QZX-R5',
  ].join('\n');

  it('maps each row to linked records, one result per filled test cell, and passes the rules', async () => {
    const rows = fileToRows(new TextEncoder().encode(csv), { cellsAsText: true });
    expect(rows).toHaveLength(2);
    const perColumn: SavedMapping = {
      shapeHash: shapeOf(Object.fromEntries(Object.keys(rows[0]).map((k) => [k, '']))).hash,
      fieldNames: Object.keys(rows[0]).sort(),
      targetId: 'lab-result',
      rows: [
        { targetPath: 'Patient.identifier.value', from: { field: 'PatientID' } },
        { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'CollectionDate' } },
        { targetPath: 'Observation.valueString', from: { fields: ['AMP', 'CIP', 'GEN'] } },
        { targetPath: 'Observation.code', from: { fixedList: ['AMP', 'CIP', 'GEN'] } },
      ],
    };
    // Row two has a blank CIP cell, so its columns are fewer: `classify` still finds the one mapping.
    for (const r of rows) expect(classify(r, [], [perColumn]).kind).toBe('mapped');
    const svc = createMapToFhirService(deps());
    const res = await svc({ items: rows.map((json) => ({ json })), config: { targetId: 'lab-result', formIds: [], mappings: [perColumn] } });
    expect(res.held).toEqual([]);
    const out = res.out.map((i) => i.json as Record<string, unknown> & { resourceType: string; id: string });
    const orders = out.filter((r) => r.resourceType === 'ServiceRequest');
    expect(orders).toHaveLength(2);
    const obs = out.filter((r) => r.resourceType === 'Observation');
    expect(obs.map((o) => (o.code as { text: string }).text)).toEqual(['AMP', 'CIP', 'GEN', 'AMP', 'GEN']);
    const orderIds = new Set(orders.map((o) => `ServiceRequest/${o.id}`));
    for (const o of obs) expect(orderIds.has((o.basedOn as { reference: string }[])[0].reference)).toBe(true);
    // The order takes its results' tests, since its own Tests field is not mapped.
    expect((orders[1].code as { coding: { code: string }[] }).coding.map((c) => c.code)).toEqual(['AMP', 'GEN']);
  });
});

describe('the within-run merge of a list with two pinned entries', () => {
  // A Patient pack with two pinned identifiers on one list, built here: the shipped packs have none.
  const pinned = (ord: number, system: string, label: string) => ({
    ord, fhirPath: 'Patient.identifier.value', label, apiProperty: null, fieldType: 'text' as const, fhirValueField: null,
    required: false, locked: false, defaultOn: true, discriminator: { system }, boundValueSet: null,
    referenceTarget: null, referenceMultiple: false, rationale: 'test',
  });
  const packs = PACKS.map((p) => (p.id === 'pack-patient'
    ? { ...p, entries: [...p.entries, pinned(900, 'urn:test:id-a', 'Number A'), pinned(901, 'urn:test:id-b', 'Number B')] }
    : p));
  const two = { pid: 'T-0201', coll: '2026-11-05', t: 'TA', a: '', b: '' };
  const twoMapping: SavedMapping = {
    shapeHash: 'h2', fieldNames: Object.keys(two).sort(), targetId: 'lab-result',
    rows: [
      { targetPath: 'Patient.identifier.value', from: { field: 'pid' } },
      { targetPath: 'Patient.identifier.value?system=urn:test:id-a', from: { field: 'a' } },
      { targetPath: 'Patient.identifier.value?system=urn:test:id-b', from: { field: 'b' } },
      { targetPath: 'Specimen.collection.collectedDateTime', from: { field: 'coll' } },
      { targetPath: 'Observation.code', from: { field: 't' } },
    ],
  };

  it('merges the entries by their pinned values and adds the one the first row lacks', async () => {
    const svc = createMapToFhirService(deps({ packs: async () => packs }));
    // Row one has no number A, so its number B sits at the slot number A takes in row two.
    const res = await svc({
      items: [{ json: { ...two, b: 'QZX-B1' } }, { json: { ...two, a: 'QZX-A2', b: 'QZX-B1', t: 'TB' } }],
      config: { targetId: 'lab-result', formIds: [], mappings: [twoMapping] },
    });
    expect(res.held).toEqual([]);
    const patients = res.out.filter((i) => i.json.resourceType === 'Patient');
    expect(patients).toHaveLength(1);
    expect(patients[0].json.identifier).toEqual([
      { value: 'T-0201' },
      { value: 'QZX-B1', system: 'urn:test:id-b' },
      { value: 'QZX-A2', system: 'urn:test:id-a' },
    ]);
  });
});
