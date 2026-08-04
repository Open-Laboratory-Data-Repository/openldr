import { describe, expect, it } from 'vitest';
import { lintFormSchema } from './lint';
import { sampleForms } from './samples/forms';
import { makeField, makeSchema } from './__fixtures__/forms';

describe('lintFormSchema', () => {
  it('reports duplicate field id', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'dup', displayLabel: 'Dup 1', fieldType: 'text', order: 0 }),
        makeField({ id: 'dup', displayLabel: 'Dup 2', fieldType: 'text', order: 1 }),
      ],
    });

    const issues = lintFormSchema(form);
    expect(issues.some((i) => i.code === 'duplicate-id' && i.fieldId === 'dup')).toBe(true);
  });

  it('reports dangling visibility — condition references a fieldId that does not exist', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 'q1',
          displayLabel: 'Q1',
          fieldType: 'text',
          order: 0,
          visibility: { combinator: 'all', conditions: [{ fieldId: 'ghost', operator: 'equals', value: 'x' }] },
        }),
      ],
    });

    const issues = lintFormSchema(form);
    const issue = issues.find((i) => i.code === 'visibility-missing-field');
    expect(issue).toBeDefined();
    expect(issue?.fieldId).toBe('q1');
  });

  it('reports select/multiselect with neither valueSetOptions nor valueSetUrl', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 's1', displayLabel: 'Pick one', fieldType: 'select', order: 0 }),
        makeField({ id: 's2', displayLabel: 'Pick many', fieldType: 'multiselect', order: 1 }),
      ],
    });

    const issues = lintFormSchema(form);
    const codes = issues.map((i) => i.code);
    expect(codes.filter((c) => c === 'choice-missing-options').length).toBe(2);
  });

  it('does NOT report select backed by valueSetOptions', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 's1',
          displayLabel: 'Pick one',
          fieldType: 'select',
          order: 0,
          valueSetOptions: [{ code: 'a', display: 'A' }],
        }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'choice-missing-options')).toBe(false);
  });

  it('does NOT report select backed by valueSetUrl', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({
          id: 's1',
          displayLabel: 'Pick one',
          fieldType: 'select',
          order: 0,
          valueSetUrl: 'urn:test:organisms',
        }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'choice-missing-options')).toBe(false);
  });

  it('reports groupId referencing a non-existent group-type field', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 0, groupId: 'missing-group' }),
      ],
    });

    const issues = lintFormSchema(form);
    expect(issues.some((i) => i.code === 'dangling-group-id' && i.fieldId === 'q1')).toBe(true);
  });

  it('does NOT report groupId when the group field exists', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'grp', displayLabel: 'Group', fieldType: 'group', order: 0 }),
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 1, groupId: 'grp' }),
      ],
    });

    expect(lintFormSchema(form).some((i) => i.code === 'dangling-group-id')).toBe(false);
  });

  it('surfaces target-contract violations as issues', () => {
    // users page requires firstName, lastName, email, roles
    const form = makeSchema({
      id: 'f',
      name: 'F',
      targetPages: ['users'],
      fields: [
        // only supply email — firstName, lastName, roles are missing
        makeField({ id: 'q1', displayLabel: 'Email', fieldType: 'email', order: 0, apiProperty: 'email' }),
      ],
    });

    const issues = lintFormSchema(form);
    const contractIssue = issues.find((i) => i.code === 'target-contract-violation');
    expect(contractIssue).toBeDefined();
    expect(contractIssue?.severity).toBe('error');
  });

  it('returns empty array for a clean form', () => {
    const form = makeSchema({
      id: 'f',
      name: 'F',
      fields: [
        makeField({ id: 'q1', displayLabel: 'Q1', fieldType: 'text', order: 0 }),
      ],
    });

    expect(lintFormSchema(form)).toEqual([]);
  });
});

describe('reference source lint', () => {
  const base = {
    id: 'form-1', name: 'F', versionLabel: null, fhirVersion: 'R4' as const,
    fhirResourceType: null, fhirProfileUrl: null, facilityId: null,
    targetPages: [], sections: [], version: 1, active: true,
    status: 'draft' as const, createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
  };
  const refField = (over: Record<string, unknown>) => ({
    id: 'r', fhirPath: null, displayLabel: 'R', description: null,
    fieldType: 'reference' as const, required: false, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, ...over,
  });

  it('errors when a reference field declares no source', () => {
    const issues = lintFormSchema({ ...base, fields: [refField({})] } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'reference-missing-source', fieldId: 'r',
    }));
  });

  it('accepts a reference field with a referenceTarget', () => {
    const issues = lintFormSchema({ ...base, fields: [refField({ referenceTarget: 'Patient' })] } as never);
    expect(issues.filter((i) => i.code === 'reference-missing-source')).toEqual([]);
  });

  it('warns when both valueSetUrl and referenceTarget are set', () => {
    const issues = lintFormSchema({
      ...base, fields: [refField({ valueSetUrl: 'http://x/vs', referenceTarget: 'Patient' })],
    } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'reference-ambiguous-source', fieldId: 'r',
    }));
  });

  it('warns rather than errors for a sourceless facility field', () => {
    const issues = lintFormSchema({
      ...base, fields: [refField({ fieldType: 'facility' })],
    } as never);
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'reference-missing-source', fieldId: 'r',
    }));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('ambiguous-fhir-path', () => {
  const field = (over: Record<string, unknown>) => ({
    id: 'f', fhirPath: 'identifier.value', displayLabel: 'F', description: null,
    fieldType: 'identifier', required: false, enabled: true, order: 0,
    cardinality: { min: 0, max: '1' }, ...over,
  }) as never;
  const form = (fields: unknown[]) => ({
    id: 'x', name: 'X', versionLabel: 'v1', fhirVersion: 'R4', fhirResourceType: 'Location',
    fhirProfileUrl: null, facilityId: null, targetPages: ['forms'], sections: [], version: 1,
    active: true, status: 'draft', createdAt: '', updatedAt: '', fields,
  }) as never;

  it('flags two enabled fields on one fhirPath with no discriminator', () => {
    // The shipped Facility form's defect: Local ID and MFL ID both bound identifier.value, so the
    // form carrying the local↔national PAIR could not tell the two codes apart.
    const issues = lintFormSchema(form([field({ id: 'local' }), field({ id: 'mfl' })]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path').map((i) => i.fieldId).sort())
      .toEqual(['local', 'mfl']);
    expect(issues.find((i) => i.code === 'ambiguous-fhir-path')?.severity).toBe('error');
  });

  it('accepts them once each declares a DISTINCT discriminator', () => {
    const issues = lintFormSchema(form([
      field({ id: 'local', fhirDiscriminator: { system: 'urn:openldr:facility:local' } }),
      field({ id: 'mfl', fhirDiscriminator: { system: 'urn:openldr:facility:national' } }),
    ]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toEqual([]);
  });

  it('still flags them when the discriminators are IDENTICAL', () => {
    // Same {system} on both is exactly as ambiguous as none — a discriminator only disambiguates
    // when it differs.
    const same = { system: 'urn:openldr:facility:local' };
    const issues = lintFormSchema(form([
      field({ id: 'local', fhirDiscriminator: same }),
      field({ id: 'mfl', fhirDiscriminator: { ...same } }),
    ]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toHaveLength(2);
  });

  it('ignores DISABLED fields — they bind nothing', () => {
    const issues = lintFormSchema(form([field({ id: 'local' }), field({ id: 'mfl', enabled: false })]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toEqual([]);
  });

  it('ignores fields with no fhirPath at all', () => {
    const issues = lintFormSchema(form([field({ id: 'a', fhirPath: undefined }), field({ id: 'b', fhirPath: undefined })]));
    expect(issues.filter((i) => i.code === 'ambiguous-fhir-path')).toEqual([]);
  });
});

describe('the shipped sample forms', () => {
  it('⛔ lint clean — the Facility form regression guard', () => {
    // This is what would have caught the Local ID / MFL ID collision before it shipped.
    for (const f of sampleForms) {
      const errors = lintFormSchema(f).filter((i) => i.severity === 'error');
      expect(errors, `${f.name} has lint errors: ${JSON.stringify(errors)}`).toEqual([]);
    }
  });
});
