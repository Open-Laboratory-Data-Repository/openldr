import { describe, it, expect, vi } from 'vitest';
import { seededStarterPacks, shapeOf, type FormField, type FormSchema, type SavedMapping } from '@openldr/forms';
import { validateBatch } from '@openldr/fhir';
import type { RunFormValidateInput, RunFormValidateOutput, WorkflowItem } from '@openldr/workflows';
import { codingFromMapRows, createMapToFhirService, loadStoredPacks, type MapToFhirServiceDeps } from './map-to-fhir-service';

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
    validate: (resources) => validateBatch(resources, { level: 'high', resolveServiceRequest: async () => false }),
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
    expect(res.meta).toEqual({ fhir: 1, form: 1, mapped: 1, held: 1 });
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
    expect(res.meta).toEqual({ fhir: 0, form: 0, mapped: 0, held: 1 });
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
    expect(res.meta).toEqual({ fhir: 2, form: 0, mapped: 0, held: 0 });
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
    expect(res.meta).toEqual({ fhir: 1, form: 1, mapped: 0, held: 0 });
    expect(packs).not.toHaveBeenCalled();
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

  it('gives null for two different targets', () => {
    expect(codingFromMapRows([r('T1'), r('T2')])).toBeNull();
    expect(codingFromMapRows([r('T1'), r('T1', 'equivalent', 'urn:test:other')])).toBeNull();
  });

  it('ignores an unmatched or disjoint row beside a real one', () => {
    expect(codingFromMapRows([r('T1'), r('T2', 'unmatched'), r('T3', 'disjoint')])).toEqual({ system: 'urn:test:tgt', code: 'T1' });
    expect(codingFromMapRows([r('T2', 'unmatched')])).toBeNull();
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
