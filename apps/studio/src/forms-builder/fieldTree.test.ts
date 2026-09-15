import { describe, expect, it } from 'vitest';
import { seededStarterPacks, type FormField } from '@openldr/forms/pure';
import { arrayPathOf, buildFieldTree } from './fieldTree';
import { buildFieldFromPackEntry } from './newFormFields';

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'order'>): FormField {
  return {
    displayLabel: overrides.id,
    fieldType: 'text',
    required: false,
    enabled: true,
    fhirPath: null,
    cardinality: { min: 0, max: '1' },
    description: null,
    ...overrides,
  };
}

const slot = (id: string, order: number, system: string) =>
  field({ id, order, fhirPath: 'Location.identifier.value', fhirValueField: 'value', fhirDiscriminator: { system } });

describe('arrayPathOf', () => {
  it('strips the value field from the path of a slot', () => {
    expect(arrayPathOf(slot('a', 0, 'urn:a'))).toBe('Location.identifier');
  });

  it('is null without a discriminator', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.value', fhirValueField: 'value' }))).toBeNull();
  });

  it('is null without a value field', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.value', fhirDiscriminator: { system: 'x' } }))).toBeNull();
  });

  it('is null when the path does not end in the value field', () => {
    expect(arrayPathOf(field({ id: 'a', order: 0, fhirPath: 'Location.identifier.system', fhirValueField: 'value', fhirDiscriminator: { system: 'x' } }))).toBeNull();
  });
});

describe('buildFieldTree', () => {
  it('draws slots of one list under a single repeat node', () => {
    const nodes = buildFieldTree([slot('local', 1, 'urn:local'), slot('mfl', 2, 'urn:mfl')]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'repeat', path: 'Location.identifier', label: 'identifier' });
    expect(nodes[0].kind === 'repeat' && nodes[0].slots.map((s) => s.id)).toEqual(['local', 'mfl']);
  });

  it('puts the repeat where its first slot sits, so nothing reorders', () => {
    const nodes = buildFieldTree([
      field({ id: 'name', order: 0 }),
      slot('local', 1, 'urn:local'),
      field({ id: 'status', order: 2 }),
      slot('mfl', 3, 'urn:mfl'),
    ]);
    expect(nodes.map((n) => (n.kind === 'field' ? n.field.id : n.path))).toEqual(['name', 'Location.identifier', 'status']);
  });

  it('leaves a group child alone, because groupId already nests it', () => {
    const child = { ...slot('local', 1, 'urn:local'), groupId: 'g' };
    const nodes = buildFieldTree([child]);
    expect(nodes).toEqual([{ kind: 'field', field: child }]);
  });
});

// The shipped forms had no field with both a discriminator and a value field, so no install ever
// saw a list drawn as slots: the Patient form's names drew as two unrelated rows. A fresh form
// built from a pack takes the pack's entries, and the packs are built from the shipped forms.
describe('the shipped starter packs', () => {
  const treeOf = (packId: string) => {
    const pack = seededStarterPacks().find((p) => p.id === packId)!;
    return buildFieldTree(pack.entries.map((e, i) => ({ ...buildFieldFromPackEntry(e, `f-${i}`), order: i })));
  };
  const lists = (packId: string) =>
    treeOf(packId).flatMap((n) => (n.kind === 'repeat' ? [[n.path, n.slots.map((s) => s.displayLabel)]] : []));

  it('draw a fresh Patient form with its names under Patient.name and its phone under Patient.telecom', () => {
    expect(lists('pack-patient')).toEqual([
      ['Patient.name', ['First name', 'Last name']],
      ['Patient.telecom', ['Phone']],
    ]);
  });

  it('draw a fresh Facility form with its code as a slot of Location.identifier', () => {
    expect(lists('pack-location')).toEqual([['Location.identifier', ['Facility code']]]);
  });
});
