import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import { libraryElements } from './libraryEntries';

const field = (id: string, fhirPath: string | null): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath,
  order: 0, cardinality: { min: 0, max: '1' }, description: null,
});

describe('libraryElements', () => {
  const paths = (rt: string | null, fields: FormField[] = []) => libraryElements(rt, fields).map((e) => e.path);

  it('offers the resource elements down to two segments', () => {
    expect(paths('Location')).toContain('Location.address');
    expect(paths('Location')).toContain('Location.address.city');
    expect(paths('Patient')).toContain('Patient.contact.address');
    expect(paths('Patient')).not.toContain('Patient.contact.address.city');
  });

  it('hides infrastructure, at any level, as corlix does', () => {
    const offered = paths('Location');
    for (const hidden of ['Location.meta', 'Location.text', 'Location.contained', 'Location.implicitRules', 'Location.language']) {
      expect(offered).not.toContain(hidden);
    }
    expect(offered.some((p) => /\.(id|extension|modifierExtension)(\.|$)/.test(p))).toBe(false);
  });

  it('drops a path any field already binds, disabled fields included, bare paths too', () => {
    const disabled = { ...field('b', 'Location.address.city'), enabled: false };
    const offered = paths('Location', [field('a', 'name'), disabled]);
    expect(offered).not.toContain('Location.name');
    expect(offered).not.toContain('Location.address.city');
    expect(offered).toContain('Location.address.district');
  });

  it('offers nothing with no type, or a type the table does not cover', () => {
    expect(paths(null)).toEqual([]);
    expect(paths('Questionnaire')).toEqual([]);
  });
});
