import { describe, expect, it } from 'vitest';
import { seededStarterPacks } from './starter-packs';
import { sampleForms } from './forms';

const packs = seededStarterPacks();
const pack = (id: string) => packs.find((p) => p.id === id)!;
const entry = (id: string, label: string) => pack(id).entries.find((e) => e.label === label);

describe('seeded starter packs', () => {
  it('ships one pack per resource type the sample forms cover', () => {
    expect(packs.map((p) => [p.id, p.resourceType, p.name])).toEqual([
      ['pack-location', 'Location', 'Facility'],
      ['pack-practitioner', 'Practitioner', 'Users'],
      ['pack-patient', 'Patient', 'Patient'],
      ['pack-service-request', 'ServiceRequest', 'Lab order'],
    ]);
  });

  it('gives every entry a rationale and numbers the entries from 0', () => {
    for (const p of packs) {
      expect(p.entries.map((e) => e.ord)).toEqual(p.entries.map((_, i) => i));
      for (const e of p.entries) expect(e.rationale.trim(), `${p.id}: ${e.label}`).not.toBe('');
    }
  });

  it('locks what the Facilities and Users pages cannot save without, and nothing else', () => {
    const locked = (id: string) => pack(id).entries.filter((e) => e.locked).map((e) => e.apiProperty);
    expect(locked('pack-location')).toEqual(['facilitySystem', 'facilityCode', 'name']);
    expect(locked('pack-practitioner')).toEqual(['firstName', 'lastName', 'email']);
    expect(locked('pack-patient')).toEqual([]);
    expect(locked('pack-service-request')).toEqual([]);
  });

  it('ships every entry checked', () => {
    for (const p of packs) expect(p.entries.every((e) => e.defaultOn), p.id).toBe(true);
  });

  it('writes every path with its resource, the bare Users paths included', () => {
    expect(entry('pack-practitioner', 'First name')?.fhirPath).toBe('Practitioner.name.given');
  });

  it('keeps the Facility code discriminator and the fields with no FHIR path', () => {
    expect(entry('pack-location', 'Facility code')?.discriminator).toEqual({ system: 'urn:openldr:facility:national' });
    expect(entry('pack-location', 'Zone')).toMatchObject({ fhirPath: null, apiProperty: 'zone' });
  });

  it('carries the Lab order reference sources and several tests', () => {
    expect(entry('pack-service-request', 'Patient')).toMatchObject({ referenceTarget: 'Patient', referenceMultiple: false });
    expect(entry('pack-service-request', 'Tests')).toMatchObject({
      boundValueSet: 'urn:openldr:valueset:lab-tests', referenceTarget: null, referenceMultiple: true,
    });
    expect(entry('pack-location', 'Status')?.boundValueSet).toBe('urn:openldr:valueset:location-status');
  });

  it('leaves Ward / Department out, because its codes are local', () => {
    expect(entry('pack-service-request', 'Ward / Department')).toBeUndefined();
  });

  it('holds every other field of each source form', () => {
    const size = (id: string) => sampleForms.find((f) => f.id === id)!.fields.length;
    expect(packs.map((p) => p.entries.length)).toEqual([
      size('sample-facility'), size('sample-users'), size('sample-patient'), size('sample-order') - 1,
    ]);
  });
});
