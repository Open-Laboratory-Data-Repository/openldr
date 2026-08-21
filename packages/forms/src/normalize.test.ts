import { describe, expect, it } from 'vitest';
import { normalizeFormSchema } from './normalize';
import { FormSchema } from './schema/form-schema';

describe('normalizeFormSchema', () => {
  it('fills default targetPages and derives languages from field translations', () => {
    const form = normalizeFormSchema({
      id: 'f',
      name: 'My form',
      fields: [
        {
          id: 'q1',
          displayLabel: 'Question',
          fieldType: 'text',
          order: 0,
          translations: { fr: { label: 'Question FR' } },
        },
      ],
      sections: [],
      version: 1,
      active: true,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: null,
      fhirProfileUrl: null,
      facilityId: null,
    });

    // targetPages defaults to []
    expect(form.targetPages).toEqual([]);
    // languages derived from field translations
    expect(form.languages).toEqual(['fr']);
    // FormSchema.parse accepts the result
    expect(() => FormSchema.parse(form)).not.toThrow();
  });

  it('fills missing order on fields and cardinality/enabled defaults', () => {
    const form = normalizeFormSchema({
      id: 'f',
      name: 'My form',
      fields: [
        { id: 'q1', displayLabel: 'Q1', fieldType: 'text' },
        { id: 'q2', displayLabel: 'Q2', fieldType: 'number' },
      ],
      sections: [],
      version: 1,
      active: true,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: null,
      fhirProfileUrl: null,
      facilityId: null,
    });

    for (const field of form.fields) {
      expect(typeof field.order).toBe('number');
      expect(field.cardinality).toEqual({ min: 0, max: '1' });
      expect(field.enabled).toBe(true);
    }
    expect(() => FormSchema.parse(form)).not.toThrow();
  });

  it('does not overwrite explicit cardinality/enabled/order values', () => {
    const form = normalizeFormSchema({
      id: 'f',
      name: 'My form',
      fields: [
        {
          id: 'q1',
          displayLabel: 'Q1',
          fieldType: 'text',
          order: 5,
          enabled: false,
          cardinality: { min: 1, max: '*' },
        },
      ],
      sections: [],
      version: 1,
      active: true,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: null,
      fhirProfileUrl: null,
      facilityId: null,
    });

    expect(form.fields[0]?.order).toBe(5);
    expect(form.fields[0]?.enabled).toBe(false);
    expect(form.fields[0]?.cardinality).toEqual({ min: 1, max: '*' });
  });

  it('returns a value that FormSchema.parse accepts', () => {
    const raw = {
      id: 'g',
      name: 'G',
      fields: [
        { id: 'a', displayLabel: 'A', fieldType: 'select', valueSetOptions: [{ code: 'y', display: 'Yes' }] },
      ],
      sections: [{ id: 's1', label: 'Section 1', order: 0 }],
      version: 2,
      active: false,
      status: 'published',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      versionLabel: 'v2',
      fhirVersion: '4.0.1',
      fhirResourceType: 'Questionnaire',
      fhirProfileUrl: null,
      facilityId: null,
    };

    const result = normalizeFormSchema(raw);
    expect(() => FormSchema.parse(result)).not.toThrow();
  });
});

describe('normalizeFormSchema fhirPath canonicalisation', () => {
  it('prefixes a bare path with the form resource type', () => {
    const result = normalizeFormSchema({
      id: 'f1',
      name: 'Facility',
      fhirResourceType: 'Location',
      fields: [{ id: 'fld-zone', fhirPath: 'address.district', displayLabel: 'Zone', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('Location.address.district');
  });

  it('leaves an already prefixed path untouched', () => {
    const result = normalizeFormSchema({
      id: 'f2',
      name: 'Requisition',
      fhirResourceType: 'ServiceRequest',
      fields: [{ id: 'fld-spec', fhirPath: 'Specimen.type', displayLabel: 'Specimen', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('Specimen.type');
  });

  it('leaves a bare path alone when it cannot be resolved, rather than blanking it', () => {
    const result = normalizeFormSchema({
      id: 'f3',
      name: 'Untyped',
      fhirResourceType: null,
      fields: [{ id: 'fld-x', fhirPath: 'address.district', displayLabel: 'X', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('address.district');
  });

  it('leaves a null path null', () => {
    const result = normalizeFormSchema({
      id: 'f4',
      name: 'Facility',
      fhirResourceType: 'Location',
      fields: [{ id: 'fld-council', fhirPath: null, displayLabel: 'Council', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBeNull();
  });

  it('resolves a field against its own section resource type, not the form type', () => {
    const result = normalizeFormSchema({
      id: 'f5',
      name: 'Requisition',
      fhirResourceType: 'ServiceRequest',
      sections: [{ id: 'specimen', label: 'Specimen', order: 0, fhirResourceType: 'Specimen' }],
      fields: [{ id: 'fld-type', fhirPath: 'type', displayLabel: 'Type', fieldType: 'text', section: 'specimen' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('Specimen.type');
  });

  it('resolves a field with no section against the form type', () => {
    const result = normalizeFormSchema({
      id: 'f6',
      name: 'Requisition',
      fhirResourceType: 'ServiceRequest',
      sections: [{ id: 'specimen', label: 'Specimen', order: 0, fhirResourceType: 'Specimen' }],
      fields: [{ id: 'fld-priority', fhirPath: 'priority', displayLabel: 'Priority', fieldType: 'text' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('ServiceRequest.priority');
  });

  it('falls back to the form type when the named section declares no resource type', () => {
    const result = normalizeFormSchema({
      id: 'f7',
      name: 'Requisition',
      fhirResourceType: 'ServiceRequest',
      sections: [{ id: 'order', label: 'Order', order: 0 }],
      fields: [{ id: 'fld-status', fhirPath: 'status', displayLabel: 'Status', fieldType: 'text', section: 'order' }],
    });
    expect(result.fields[0]!.fhirPath).toBe('ServiceRequest.status');
  });
});
