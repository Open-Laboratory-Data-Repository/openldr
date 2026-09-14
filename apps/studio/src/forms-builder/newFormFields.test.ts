import { describe, expect, it } from 'vitest';
import { lintFormSchema, seededStarterPacks, type FormField, type FormSchema, type StarterPackEntry } from '@openldr/forms/pure';
import type { RepeatNode } from './fieldTree';
import { lookupFhirPath } from '@openldr/fhir/paths';
import {
  buildFieldFromElement, buildFieldFromPackEntry, buildGroupPart, buildNamedSlot, groupIdForPath, insertFieldAfter, lastPartIdOf,
} from './newFormFields';

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

describe('buildFieldFromElement', () => {
  const info = (p: string) => lookupFhirPath(p)!;

  it('builds a field named from the path, typed from the leaf, not required', () => {
    expect(buildFieldFromElement(info('Location.name'), 'name')).toMatchObject({
      id: 'name', fhirPath: 'Location.name', displayLabel: 'Name', fieldType: 'text', required: false,
      cardinality: { min: 0, max: '1' },
    });
  });

  it('marks an element that repeats as repeatable', () => {
    const field = buildFieldFromElement(info('Location.alias'), 'alias');
    expect(field.repeatable).toBe(true);
    expect(field.cardinality).toEqual({ min: 0, max: '*' });
  });

  it('makes a BackboneElement a group, never repeatable', () => {
    const field = buildFieldFromElement(info('Location.hoursOfOperation'), 'hours');
    expect(field.fieldType).toBe('group');
    expect(field.repeatable).toBeUndefined();
  });

  it('fills a coded element options from its label', () => {
    expect(buildFieldFromElement(info('Location.status'), 'status').valueSetOptions?.map((o) => o.code))
      .toEqual(['active', 'suspended', 'inactive']);
  });
});

describe('groupIdForPath', () => {
  it('finds the group bound to the immediate parent path, and nothing further up', () => {
    const fields = [f({ id: 'addr', order: 0, fieldType: 'group', fhirPath: 'Location.address' })];
    expect(groupIdForPath(fields, 'Location.address.city')).toBe('addr');
    expect(groupIdForPath(fields, 'Location.address.city.text')).toBeUndefined();
    expect(groupIdForPath(fields, 'Location.name')).toBeUndefined();
  });
});

const packEntry = (over: Partial<StarterPackEntry>): StarterPackEntry => ({
  ord: 0, fhirPath: 'Location.name', label: 'Name', apiProperty: null, fieldType: 'text', fhirValueField: null,
  required: false, locked: false, defaultOn: true, boundValueSet: null, referenceTarget: null, referenceMultiple: false,
  rationale: 'r', ...over,
});

describe('buildFieldFromPackEntry', () => {
  it('copies what makes the field save', () => {
    const field = buildFieldFromPackEntry(packEntry({
      fhirPath: 'Location.identifier.value', label: 'Facility code', apiProperty: 'facilityCode', fieldType: 'identifier',
      required: true, locked: true, discriminator: { system: 'urn:x' },
    }), 'code');
    expect(field).toMatchObject({
      id: 'code', fhirPath: 'Location.identifier.value', displayLabel: 'Facility code', apiProperty: 'facilityCode',
      fieldType: 'identifier', required: true, locked: true, fhirDiscriminator: { system: 'urn:x' },
      cardinality: { min: 1, max: '1' },
    });
  });

  it('keeps a reference source, and several answers', () => {
    const field = buildFieldFromPackEntry(packEntry({ fieldType: 'reference', referenceTarget: 'http://loinc.org', referenceMultiple: true }), 'tests');
    expect(field).toMatchObject({ referenceTarget: 'http://loinc.org', referenceMultiple: true, cardinality: { min: 0, max: '*' } });
  });

  it('binds a ValueSet', () => {
    expect(buildFieldFromPackEntry(packEntry({ boundValueSet: 'urn:vs' }), 'x').valueSetUrl).toBe('urn:vs');
  });

  it("reads a coded select's options from the FHIR label, since a pack stores no codes", () => {
    const field = buildFieldFromPackEntry(packEntry({ fhirPath: 'Patient.gender', fieldType: 'select' }), 'sex');
    expect(field.valueSetOptions?.map((o) => o.code)).toEqual(['male', 'female', 'other', 'unknown']);
  });

  it('falls back to text when the entry names no type', () => {
    expect(buildFieldFromPackEntry(packEntry({ fieldType: null }), 'x').fieldType).toBe('text');
  });
});

describe('each seeded starter pack, taken whole', () => {
  const PAGES: Record<string, string[]> = { 'pack-location': ['facilities'], 'pack-practitioner': ['users'] };

  it.each(seededStarterPacks().map((p) => [p.id, p] as const))('%s makes a form with no lint error', (_id, pack) => {
    const form: FormSchema = {
      id: pack.id, name: pack.name, versionLabel: null, fhirVersion: 'R4', fhirResourceType: pack.resourceType,
      fhirProfileUrl: null, facilityId: null,
      fields: pack.entries.map((e, i) => ({ ...buildFieldFromPackEntry(e, `f${i}`), order: i })),
      sections: [], targetPages: PAGES[pack.id] ?? [], version: 1, active: true, status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const errors = lintFormSchema(form).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});
