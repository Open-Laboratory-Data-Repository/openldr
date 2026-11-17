import { validateResource } from '@openldr/fhir';
import { describe, it, expect } from 'vitest';
import { canWriteFromCell, pinnedListOf, writeValue } from './write';

function rec(resourceType: string): Record<string, unknown> {
  return { resourceType, id: 'r1' };
}

describe('writeValue', () => {
  it('writes a scalar under a list entry at index 0', () => {
    const r = rec('Patient');
    expect(writeValue(r, 'Patient.identifier.value', 'T-1')).toEqual({ ok: true });
    expect(r.identifier).toEqual([{ value: 'T-1' }]);
  });

  it('creates the pinned list entry and reuses it for the next field', () => {
    const r = rec('Patient');
    r.name = [{ use: 'usual', family: 'OTHER' }];
    expect(writeValue(r, 'Patient.name.given?use=official', 'Ann')).toEqual({ ok: true });
    expect(writeValue(r, 'Patient.name.family?use=official', 'TESTER')).toEqual({ ok: true });
    expect(r.name).toEqual([
      { use: 'usual', family: 'OTHER' },
      { use: 'official', given: ['Ann'], family: 'TESTER' },
    ]);
  });

  it('sets pinned values on the leaf object when no segment is a list', () => {
    const r = rec('ServiceRequest');
    expect(writeValue(r, 'ServiceRequest.requester?type=Practitioner', 'Dr Test')).toEqual({ ok: true });
    expect(r.requester).toEqual({ display: 'Dr Test', type: 'Practitioner' });
  });

  it('keeps an explicit index', () => {
    const r = rec('ServiceRequest');
    expect(writeValue(r, 'ServiceRequest.note.0.text', 'a note')).toEqual({ ok: true });
    expect(r.note).toEqual([{ text: 'a note' }]);
  });

  it('wraps a CodeableConcept from a coding or a string', () => {
    const r = rec('Observation');
    writeValue(r, 'Observation.code', { system: 'urn:test:codes', code: 'T1' });
    expect(r.code).toEqual({ coding: [{ system: 'urn:test:codes', code: 'T1' }] });
    const s = rec('Specimen');
    writeValue(s, 'Specimen.type', 'blood-x');
    expect(s.type).toEqual({ text: 'blood-x', coding: [{ code: 'blood-x' }] });
  });

  it('stores a plain text in a CodeableConcept as the lab\'s own code with no system, and it passes validateResource', () => {
    const r = rec('Observation');
    r.status = 'final';
    writeValue(r, 'Observation.code', 'QZX-T1');
    expect(r.code).toEqual({ text: 'QZX-T1', coding: [{ code: 'QZX-T1' }] });
    expect(validateResource(r).ok).toBe(true);
  });

  it('writes the text 12.5 with no rule to a number leaf as a number', () => {
    const r = rec('Observation');
    expect(writeValue(r, 'Observation.valueQuantity.value', '12.5')).toEqual({ ok: true });
    expect(r.valueQuantity).toEqual({ value: 12.5 });
  });

  it('keeps a coding for a Coding leaf and fails a string', () => {
    const r = rec('Observation');
    expect(writeValue(r, 'Observation.code.coding', { system: 'urn:test:codes', code: 'T1' })).toEqual({ ok: true });
    expect(r.code).toEqual({ coding: [{ system: 'urn:test:codes', code: 'T1' }] });
    const bad = writeValue(rec('Observation'), 'Observation.code.coding', 'QZX-T1');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).not.toContain('QZX');
  });

  it('writes a link reference into a list as a list', () => {
    const r = rec('Observation');
    writeValue(r, 'Observation.basedOn', { reference: 'ServiceRequest/sr1' });
    writeValue(r, 'Observation.subject', { reference: 'Patient/p1' });
    expect(r.basedOn).toEqual([{ reference: 'ServiceRequest/sr1' }]);
    expect(r.subject).toEqual({ reference: 'Patient/p1' });
  });

  it('turns a Reference string into a display', () => {
    const r = rec('Observation');
    writeValue(r, 'Observation.subject', 'a person');
    expect(r.subject).toEqual({ display: 'a person' });
  });

  it('converts a plain-number string for a number leaf and fails anything else', () => {
    const r = rec('Observation');
    expect(writeValue(r, 'Observation.valueQuantity.value', '12.5')).toEqual({ ok: true });
    expect(r.valueQuantity).toEqual({ value: 12.5 });
    writeValue(r, 'Observation.valueQuantity.value', 3);
    expect(r.valueQuantity).toEqual({ value: 3 });
    const bad = writeValue(rec('Observation'), 'Observation.valueQuantity.value', 'QZX12');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).not.toContain('QZX');
  });

  it('fails a path the table does not know, naming the path', () => {
    const r = rec('Patient');
    const res = writeValue(r, 'Patient.shoeSize', 'QZX-44');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('Patient.shoeSize');
      expect(res.reason).not.toContain('QZX');
    }
    expect(r).toEqual({ resourceType: 'Patient', id: 'r1' });
  });

  it('fails a path for another resource type', () => {
    expect(writeValue(rec('Patient'), 'Observation.status', 'final').ok).toBe(false);
  });

  it('fails a second pinned key on one single Reference and keeps the first', () => {
    const r = rec('ServiceRequest');
    expect(writeValue(r, 'ServiceRequest.requester?type=Practitioner', 'Dr Test')).toEqual({ ok: true });
    const res = writeValue(r, 'ServiceRequest.requester?type=Organization', 'QZX Clinic');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('only one');
      expect(res.reason).not.toContain('QZX');
    }
    expect(r.requester).toEqual({ display: 'Dr Test', type: 'Practitioner' });
  });

  it('lets the same pinned key write again', () => {
    const r = rec('ServiceRequest');
    writeValue(r, 'ServiceRequest.requester?type=Practitioner', 'Dr Test');
    expect(writeValue(r, 'ServiceRequest.requester?type=Practitioner', 'Dr Other')).toEqual({ ok: true });
    expect(r.requester).toEqual({ display: 'Dr Other', type: 'Practitioner' });
  });

  it('turns a number, a boolean or a coding into text for string and code leaves', () => {
    const r = rec('Patient');
    expect(writeValue(r, 'Patient.birthDate', 2026)).toEqual({ ok: true });
    expect(r.birthDate).toBe('2026');
    expect(writeValue(r, 'Patient.gender', { system: 'urn:test:sex', code: 'female' })).toEqual({ ok: true });
    expect(r.gender).toBe('female');
    expect(writeValue(r, 'Patient.name.family', true)).toEqual({ ok: true });
    expect(r.name).toEqual([{ family: 'true' }]);
  });

  it('fails a reference object for string and code leaves', () => {
    expect(writeValue(rec('Patient'), 'Patient.gender', { reference: 'Patient/QZX' }).ok).toBe(false);
  });

  it('converts true and false for a boolean leaf and fails anything else', () => {
    const r = rec('Patient');
    expect(writeValue(r, 'Patient.active', ' TRUE ')).toEqual({ ok: true });
    expect(r.active).toBe(true);
    expect(writeValue(r, 'Patient.active', 'false')).toEqual({ ok: true });
    expect(r.active).toBe(false);
    expect(writeValue(r, 'Patient.active', false)).toEqual({ ok: true });
    for (const v of ['QZX-yes', 1, { system: 'urn:test', code: 'y' }] as const) {
      const res = writeValue(rec('Patient'), 'Patient.active', v);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).not.toContain('QZX');
    }
  });

  it('fails a reference object for a Coding leaf', () => {
    expect(writeValue(rec('Observation'), 'Observation.code.coding', { reference: 'Patient/p1' }).ok).toBe(false);
  });

  it('fails a coding and a number for a Reference leaf', () => {
    expect(writeValue(rec('Observation'), 'Observation.subject', { system: 'urn:test', code: 'x' }).ok).toBe(false);
  });

  it('fails a reference object for a CodeableConcept leaf', () => {
    expect(writeValue(rec('Observation'), 'Observation.code', { reference: 'Patient/p1' }).ok).toBe(false);
  });

  it('fails a primitive or an object for another complex leaf, asking for a more specific path', () => {
    for (const [key, v] of [
      ['Patient.identifier', 'QZX-1'],
      ['Observation.valueQuantity', 4],
      ['Patient.name', { system: 'urn:test', code: 'x' }],
    ] as const) {
      const r = rec(key.split('.')[0]);
      const res = writeValue(r, key, v);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain(key);
        expect(res.reason).toContain('more specific');
        expect(res.reason).not.toContain('QZX');
      }
      expect(Object.keys(r)).toEqual(['resourceType', 'id']);
    }
  });

  it('fails a malformed key without throwing', () => {
    expect(writeValue(rec('Patient'), 'Patient.gender?use=%zz', 'female').ok).toBe(false);
  });

  it('fails a pinned value on a leaf that is not an object', () => {
    expect(writeValue(rec('Patient'), 'Patient.birthDate?use=official', '2026-01-01').ok).toBe(false);
  });
});

describe('canWriteFromCell', () => {
  it('says yes for a leaf the writer fills from one value', () => {
    for (const key of [
      'Patient.birthDate', 'Patient.gender', 'Patient.identifier.value', 'Patient.name.given?use=official',
      'Observation.valueQuantity.value', 'Observation.code', 'Observation.interpretation', 'ServiceRequest.requester?type=Practitioner',
      'ServiceRequest.note.0.text', 'Patient.active',
    ]) expect(canWriteFromCell(key), key).toBe(true);
  });

  it('says no for a complex leaf, an unknown path and a malformed key', () => {
    for (const key of [
      'ServiceRequest.extension?url=urn:test:ext', 'Patient.identifier', 'Specimen.collection', 'Patient.shoeSize', 'Patient.gender?use=%zz',
    ]) expect(canWriteFromCell(key), key).toBe(false);
  });

  it('agrees with the writer on every key it accepts or refuses', () => {
    for (const key of ['Patient.identifier.value', 'Patient.identifier', 'ServiceRequest.extension?url=urn:test:ext', 'Observation.valueString']) {
      const r = writeValue({ resourceType: key.split('.')[0] }, key, 'x');
      expect(r.ok, key).toBe(canWriteFromCell(key));
    }
  });
});

describe('pinnedListOf', () => {
  it('names the list whose entry takes the pinned values, and the pinned elements', () => {
    expect(pinnedListOf('Patient.identifier.value?system=urn:test:a')).toEqual({ list: 'Patient.identifier', els: ['system'] });
    expect(pinnedListOf('Patient.name.given?use=official')).toEqual({ list: 'Patient.name', els: ['use'] });
  });

  it('gives null for a key that pins nothing, and for a single pinned object', () => {
    expect(pinnedListOf('Patient.identifier.value')).toBeNull();
    expect(pinnedListOf('ServiceRequest.requester?type=Practitioner')).toBeNull();
  });
});

describe('a whole number too long to hold exactly', () => {
  it('is refused by a number field, never rounded', () => {
    const obs: Record<string, unknown> = { resourceType: 'Observation' };
    expect(writeValue(obs, 'Observation.valueQuantity.value', '4471200000000000123')).toEqual({
      ok: false,
      reason: 'Observation.valueQuantity.value has more digits than a number can hold exactly',
    });
    expect(obs.valueQuantity).toBeUndefined();
  });

  it('keeps every digit in a text field', () => {
    const sp: Record<string, unknown> = { resourceType: 'Specimen' };
    expect(writeValue(sp, 'Specimen.accessionIdentifier.value', '4471200000000000123')).toEqual({ ok: true });
    expect(sp).toEqual({ resourceType: 'Specimen', accessionIdentifier: { value: '4471200000000000123' } });
  });

  it('still writes a safe whole number and a decimal as numbers', () => {
    const obs: Record<string, unknown> = { resourceType: 'Observation' };
    expect(writeValue(obs, 'Observation.valueQuantity.value', '9007199254740991')).toEqual({ ok: true });
    expect((obs.valueQuantity as { value: number }).value).toBe(9007199254740991);
    const obs2: Record<string, unknown> = { resourceType: 'Observation' };
    expect(writeValue(obs2, 'Observation.valueQuantity.value', '12345678901234567.5')).toEqual({ ok: true });
  });
});
