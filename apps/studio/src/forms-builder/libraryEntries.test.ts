import { describe, expect, it } from 'vitest';
import type { FormField, StarterPackEntry } from '@openldr/forms/pure';
import { libraryElements, packEntriesNotOnForm } from './libraryEntries';

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

describe('packEntriesNotOnForm', () => {
  const entry = (ord: number, fhirPath: string | null, extra: Partial<StarterPackEntry> = {}): StarterPackEntry => ({
    ord, fhirPath, label: String(ord), apiProperty: null, fieldType: 'text', fhirValueField: null, required: false,
    locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false, rationale: 'r', ...extra,
  });

  it('tells two slots of one path apart by their discriminator', () => {
    const entries = [
      entry(0, 'Location.identifier.value', { discriminator: { system: 'a' } }),
      entry(1, 'Location.identifier.value', { discriminator: { system: 'b' } }),
    ];
    const fields = [{ ...field('x', 'Location.identifier.value'), fhirDiscriminator: { system: 'a' } }];
    expect(packEntriesNotOnForm(entries, fields, 'Location').map((e) => e.ord)).toEqual([1]);
  });

  it('resolves a bare path against the form resource type', () => {
    expect(packEntriesNotOnForm([entry(0, 'Practitioner.name.given')], [field('x', 'name.given')], 'Practitioner')).toEqual([]);
  });

  it('matches an entry with no path by its API property', () => {
    const zone = entry(0, null, { apiProperty: 'zone' });
    expect(packEntriesNotOnForm([zone], [], 'Location')).toEqual([zone]);
    expect(packEntriesNotOnForm([zone], [{ ...field('z', null), apiProperty: 'zone' }], 'Location')).toEqual([]);
  });

  it('keeps pack order, and a disabled field still counts as on the form', () => {
    const entries = [entry(2, 'Location.alias'), entry(0, 'Location.name'), entry(1, 'Location.status')];
    const fields = [{ ...field('s', 'Location.status'), enabled: false }];
    expect(packEntriesNotOnForm(entries, fields, 'Location').map((e) => e.ord)).toEqual([0, 2]);
  });
});
