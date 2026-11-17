import { describe, it, expect } from 'vitest';
import { writeValue } from './write';

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
    expect(s.type).toEqual({ text: 'blood-x' });
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

  it('fails a pinned value on a leaf that is not an object', () => {
    expect(writeValue(rec('Patient'), 'Patient.birthDate?use=official', '2026-01-01').ok).toBe(false);
  });
});
