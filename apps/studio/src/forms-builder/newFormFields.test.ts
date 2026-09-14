import { describe, expect, it } from 'vitest';
import type { FormField } from '@openldr/forms/pure';
import type { RepeatNode } from './fieldTree';
import { buildGroupPart, buildNamedSlot, insertFieldAfter, lastPartIdOf } from './newFormFields';

const f = (o: Partial<FormField> & Pick<FormField, 'id' | 'order'>): FormField => ({
  displayLabel: o.id, fieldType: 'text', required: false, enabled: true, fhirPath: null,
  cardinality: { min: 0, max: '1' }, description: null, ...o,
});

const mfl = f({
  id: 'mfl', order: 1, fieldType: 'identifier', section: 's', fhirPath: 'Location.identifier.value',
  fhirValueField: 'value', fhirDiscriminator: { system: 'urn:mfl' }, apiProperty: 'mflId',
  code: [{ system: 'http://loinc.org', code: 'x' }], translations: { fr: { label: 'MFL' } },
});
const node: RepeatNode = { kind: 'repeat', path: 'Location.identifier', label: 'identifier', slots: [f({ id: 'local', order: 0 }), mfl] };

describe('buildNamedSlot', () => {
  it('copies the last slot shape with the discriminator values blank', () => {
    const slot = buildNamedSlot(node, 'new-slot', 'New slot');
    expect(slot).toMatchObject({
      id: 'new-slot', displayLabel: 'New slot', fieldType: 'identifier', section: 's',
      fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system: '' },
    });
  });

  it('leaves the API property, codes and translations behind', () => {
    const slot = buildNamedSlot(node, 'new-slot', 'New slot');
    expect(slot.apiProperty).toBeUndefined();
    expect(slot.code).toBeUndefined();
    expect(slot.translations).toBeUndefined();
  });

  it('keeps an Any join and each element once', () => {
    const anyNode: RepeatNode = { ...node, slots: [f({ id: 'a', order: 0, fhirPath: 'Location.telecom.value', fhirValueField: 'value',
      fhirDiscriminator: { join: 'any', conds: [{ el: 'system', op: 'equals', val: 'a' }, { el: 'system', op: 'equals', val: 'b' }] } })] };
    expect(buildNamedSlot(anyNode, 's', 'S').fhirDiscriminator).toEqual({ join: 'any', conds: [{ el: 'system', op: 'equals', val: '' }] });
  });
});

describe('buildGroupPart', () => {
  it('parents a blank text field on the group, with no path and no section', () => {
    const group = f({ id: 'addr', order: 3, fieldType: 'group', section: 's', fhirPath: 'Location.address' });
    expect(buildGroupPart(group, 'new-part', 'New part')).toEqual({
      id: 'new-part', displayLabel: 'New part', description: null, fieldType: 'text', required: false,
      enabled: true, order: 3, cardinality: { min: 0, max: '1' }, groupId: 'addr', fhirPath: null,
    });
  });
});

describe('insertFieldAfter and lastPartIdOf', () => {
  it('inserts after the anchor and renumbers order', () => {
    const out = insertFieldAfter([f({ id: 'a', order: 0 }), f({ id: 'b', order: 1 })], 'a', f({ id: 'x', order: 99 }));
    expect(out.map((x) => [x.id, x.order])).toEqual([['a', 0], ['x', 1], ['b', 2]]);
  });

  it('names the last part, or the group itself while it has none', () => {
    const fields = [f({ id: 'g', order: 0, fieldType: 'group' }), f({ id: 'p1', order: 1, groupId: 'g' }), f({ id: 'p2', order: 2, groupId: 'g' })];
    expect(lastPartIdOf(fields, 'g')).toBe('p2');
    expect(lastPartIdOf([fields[0]], 'g')).toBe('g');
  });
});
