import { describe, expect, it } from 'vitest';
import { sampleForms } from './forms';
import { FormSchema } from '../schema/form-schema';
import { toQuestionnaire } from '../to-questionnaire';
import { resolveReferenceSource } from '../reference-source';

describe('sample forms', () => {
  it('parse against the schema and export to Questionnaire', () => {
    expect(sampleForms.length).toBeGreaterThanOrEqual(4);
    for (const form of sampleForms) {
      const parsed = FormSchema.parse(form);
      const q = toQuestionnaire(parsed);
      expect(q.resourceType).toBe('Questionnaire');
    }
  });
  it('includes all four canonical sample form ids', () => {
    const ids = sampleForms.map((f) => f.id);
    expect(ids).toContain('sample-facility');
    expect(ids).toContain('sample-users');
    expect(ids).toContain('sample-patient');
    expect(ids).toContain('sample-order');
  });
  it('includes a Facility (Location) form, targeting the generic forms page for now', () => {
    const facility = sampleForms.find((f) => f.fhirResourceType === 'Location');
    expect(facility?.targetPages).toEqual(['forms']);
    expect(facility?.fields.some((x) => x.apiProperty === 'name')).toBe(true);
  });
  it('patient form targets the forms page and has a firstName apiProperty field', () => {
    const patient = sampleForms.find((f) => f.id === 'sample-patient');
    expect(patient?.targetPages).toEqual(['forms']);
    expect(patient?.fields.some((x) => x.apiProperty === 'firstName')).toBe(true);
  });
  it('order form has fields with id "patient" and "tests"', () => {
    const order = sampleForms.find((f) => f.id === 'sample-order');
    const fieldIds = order?.fields.map((f) => f.id) ?? [];
    expect(fieldIds).toContain('patient');
    expect(fieldIds).toContain('tests');
  });
  it('users form has no roles field — role assignment is a dedicated control outside the template', () => {
    const users = sampleForms.find((f) => f.id === 'sample-users');
    expect(users?.fields.some((x) => x.apiProperty === 'roles')).toBe(false);
  });
});

describe('Lab order reference fields', () => {
  const labOrder = sampleForms.find((f) => f.name === 'Lab order')!;
  const field = (id: string) => labOrder.fields.find((f) => f.id === id)!;

  it('binds patient to the Patient entity', () => {
    expect(resolveReferenceSource(field('patient')))
      .toEqual({ ok: true, source: { kind: 'entity', target: 'Patient' } });
  });

  it('binds tests to a coding system rather than an unregistered entity', () => {
    const r = resolveReferenceSource(field('tests'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.source.kind).toBe('coding');
  });

  it('allows more than one test per order', () => {
    expect(field('tests').cardinality.max).not.toBe('1');
  });
});
