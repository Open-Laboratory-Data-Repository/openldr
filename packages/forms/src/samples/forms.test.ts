import { describe, expect, it } from 'vitest';
import { sampleForms } from './forms';
import { FormSchema } from '../schema/form-schema';
import { toQuestionnaire } from '../to-questionnaire';
import { resolveReferenceSource } from '../reference-source';
import { PAGE_TARGETS } from '../page-targets';
import { CORE_FACILITY_KEYS } from '@openldr/db';

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
  it('includes a Facility (Location) form, targeting the facilities page', () => {
    const facility = sampleForms.find((f) => f.fhirResourceType === 'Location');
    expect(facility?.targetPages).toEqual(['facilities']);
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

  // Binds to the SEEDED ValueSet, not to the whole SNOMED CodeSystem.
  //
  // Targeting `http://snomed.info/sct` was broken two ways on a fresh install. SNOMED is not
  // shipped (it needs an affiliate licence), so the picker searched an empty vocabulary and
  // returned "No matches" for every term. And where SNOMED HAD been imported, searching the
  // whole CodeSystem ranked by code across 532k concepts, so "serum" surfaced
  // "BOVI-SERA ANTISERUM (product)" while "Serum specimen" never appeared.
  //
  // `urn:openldr:valueset:specimen-type` is seeded by migration 014, so it is present and
  // populated on EVERY install — which is what makes `required` below safe. A site that
  // imports SNOMED can repoint that ValueSet at the specimen hierarchy without touching this form.
  it('binds specimen type to the seeded specimen ValueSet', () => {
    const r = resolveReferenceSource(field('fld-ord-specimen-type'));
    expect(r).toEqual({ ok: true, source: { kind: 'coding', mode: 'valueset', url: 'urn:openldr:valueset:specimen-type' } });
  });

  // A lab order without a specimen type is not actionable in the lab. Only safe because the
  // binding above resolves against a seeded ValueSet — required against an empty vocabulary
  // would make the form unsubmittable.
  it('requires a specimen type', () => {
    const f = field('fld-ord-specimen-type');
    expect(f.required).toBe(true);
    expect(f.cardinality.min).toBe(1);
  });

  it('allows more than one test per order', () => {
    expect(field('tests').cardinality.max).not.toBe('1');
  });
});

const facility = () => sampleForms.find((f) => f.name === 'Facility')!;

describe('the seeded Facility form', () => {
  it('targets the facilities page', () => {
    expect(facility().targetPages).toEqual(['facilities']);
  });

  it('⛔ gives EVERY field an apiProperty', () => {
    // Under the Users pattern a field with no apiProperty falls into `extras`. Several fields
    // shipped without one, which would have put region/district/status/level in a jsonb bag —
    // unindexed and unjoinable, defeating the reason they are columns.
    const missing = facility().fields.filter((f) => !f.apiProperty).map((f) => f.id);
    expect(missing, `fields with no apiProperty: ${missing.join(', ')}`).toEqual([]);
  });

  it('carries exactly the agreed required set', () => {
    expect(facility().fields.map((f) => f.apiProperty).sort()).toEqual(
      ['country', 'district', 'level', 'localCode', 'name', 'region', 'status', 'zone'].sort(),
    );
  });

  it('⛔ every apiProperty is a REAL facility_registry column, not just a string that happens to match', () => {
    // packages/db/src/facility-answers.ts's CORE_FACILITY_KEYS is what actually routes an answer
    // to an indexed column vs the `extras` jsonb bag. This file used to hand-duplicate the eight
    // names as a plain array — renaming a key in facility-answers.ts would silently start routing
    // answers into extras with BOTH suites green, since neither one cross-checked the other.
    // Importing the real set closes that gap.
    for (const field of facility().fields) {
      expect(CORE_FACILITY_KEYS.has(field.apiProperty!), `"${field.apiProperty}" is not in CORE_FACILITY_KEYS`).toBe(true);
    }
  });

  it('marks the required fields required', () => {
    const required = facility().fields.filter((f) => f.required).map((f) => f.apiProperty).sort();
    expect(required).toEqual(['country', 'district', 'level', 'localCode', 'name', 'region', 'status', 'zone'].sort());
  });

  it('offers facilities as a page target, requiring name plus the only code a template can supply', () => {
    const t = PAGE_TARGETS.find((p) => p.id === 'facilities')!;
    expect(t.available).toBe(true);
    expect(t.requiredKeys.sort()).toEqual(['localCode', 'name']);
  });
});
