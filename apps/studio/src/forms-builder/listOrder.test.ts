import { describe, expect, it } from 'vitest';
import type { FormField, FormSection } from '@openldr/forms/pure';
import { buildFieldListModel, drawnOrder, matchesFieldSearch } from './listOrder';

const f = (id: string, order: number, extra: Partial<FormField> = {}): FormField => ({
  id, displayLabel: id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  order, cardinality: { min: 0, max: '1' }, description: null, ...extra,
});
const slot = (id: string, order: number, system: string) =>
  f(id, order, { fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system } });

describe('matchesFieldSearch', () => {
  it('matches the label or the path, ignoring case, and everything on an empty query', () => {
    const field = f('Patient name', 0, { fhirPath: 'Patient.name' });
    expect(matchesFieldSearch(field, 'PATIENT')).toBe(true);
    expect(matchesFieldSearch(field, 'patient.na')).toBe(true);
    expect(matchesFieldSearch(field, 'zzz')).toBe(false);
    expect(matchesFieldSearch(field, '  ')).toBe(true);
  });
});

describe('drawnOrder', () => {
  it('puts group children under their group and a repeat at its first slot', () => {
    const fields = [
      f('g', 0, { fieldType: 'group' }), f('c1', 1, { groupId: 'g' }), f('c2', 2, { groupId: 'g' }),
      slot('s1', 3, 'a'), f('x', 4), slot('s2', 5, 'b'),
    ];
    expect(drawnOrder(buildFieldListModel(fields, [], ''))).toEqual(['g', 'c1', 'c2', 's1', 's2', 'x']);
  });

  it('follows section order, puts the unsectioned last and skips empty sections', () => {
    const sections: FormSection[] = [
      { id: 'one', label: 'One', order: 0 }, { id: 'two', label: 'Two', order: 1 }, { id: 'empty', label: 'Empty', order: 2 },
    ];
    const fields = [f('a', 0, { section: 'two' }), f('b', 1), f('c', 2, { section: 'one' })];
    const model = buildFieldListModel(fields, sections, '');
    expect(model.buckets.map((b) => b.label)).toEqual(['One', 'Two', 'No section']);
    expect(drawnOrder(model)).toEqual(['c', 'a', 'b']);
  });

  it('draws without headers, in plain order, when no sections exist and fields use one section id', () => {
    const model = buildFieldListModel([f('a', 0, { section: 'x' }), f('b', 1), f('c', 2, { section: 'x' })], [], '');
    expect(model.showSectionHeaders).toBe(false);
    expect(drawnOrder(model)).toEqual(['a', 'b', 'c']);
  });

  it('hides a child whose group the search leaves out, as the list does', () => {
    const fields = [f('g', 0, { fieldType: 'group' }), f('c1', 1, { groupId: 'g' })];
    expect(drawnOrder(buildFieldListModel(fields, [], 'c1'))).toEqual([]);
  });
});
