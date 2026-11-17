import { describe, it, expect } from 'vitest';
import type { StarterPackEntry } from '../starter-pack';
import { seededStarterPacks } from '../samples/starter-packs';
import { buildTarget, parseTargetPath, targetPathKey } from './target';

function entry(ord: number, fhirPath: string | null, label: string, extra: Partial<StarterPackEntry> = {}): StarterPackEntry {
  return {
    ord,
    fhirPath,
    label,
    apiProperty: null,
    fieldType: 'text',
    fhirValueField: null,
    required: false,
    locked: false,
    defaultOn: true,
    boundValueSet: null,
    referenceTarget: null,
    referenceMultiple: false,
    rationale: 'test',
    ...extra,
  };
}

const opts = {
  links: [{ from: 'Observation', path: 'Observation.subject', to: 'Patient' }],
  defaults: [{ path: 'Observation.status', value: 'final' }],
};

describe('targetPathKey and parseTargetPath', () => {
  it('gives the plain path when nothing is pinned', () => {
    expect(targetPathKey('Patient.birthDate', {})).toBe('Patient.birthDate');
    expect(parseTargetPath('Patient.birthDate')).toEqual({ path: 'Patient.birthDate', where: {} });
  });

  it('sorts pinned keys', () => {
    expect(targetPathKey('Patient.name.given', { use: 'official', b: 'x' })).toBe('Patient.name.given?b=x&use=official');
  });

  it('round-trips values holding the separators', () => {
    const where = { system: 'urn:test:a?b=c&d%e' };
    const key = targetPathKey('Patient.identifier.value', where);
    expect(parseTargetPath(key)).toEqual({ path: 'Patient.identifier.value', where });
  });
});

describe('parseTargetPath on a malformed key', () => {
  it('gives null for a bad escape, a pair with no value sign, an empty pair and a repeated element', () => {
    for (const key of ['Patient.gender?use=%zz', 'Patient.gender?use', 'Patient.gender?', 'Patient.gender?a=1&&b=2', 'Patient.gender?a=1&a=2', 'Patient.gender?=x']) {
      expect(parseTargetPath(key)).toBeNull();
    }
  });
});

describe('buildTarget', () => {
  const patient = { id: 'pack-p', resourceType: 'Patient' };
  const observation = { id: 'pack-o', resourceType: 'Observation' };

  it('keys a field by path and pinned discriminator, and carries the record facts', () => {
    const t = buildTarget('t1', 'Test target', [
      {
        pack: patient,
        entries: [
          entry(0, 'Patient.name.given', 'First name', { discriminator: { use: 'official' }, required: true }),
          entry(1, 'Patient.gender', 'Sex', { boundValueSet: 'urn:test:vs' }),
        ],
      },
      { pack: observation, entries: [entry(0, 'Observation.valueString', 'Result')], repeats: true },
    ], opts);
    expect(t).toEqual({
      id: 't1',
      name: 'Test target',
      records: [
        { type: 'Patient', packId: 'pack-p', repeats: false },
        { type: 'Observation', packId: 'pack-o', repeats: true },
      ],
      links: opts.links,
      defaults: opts.defaults,
      fields: [
        { path: 'Patient.name.given?use=official', label: 'First name', required: true, repeats: false, valueSet: null },
        { path: 'Patient.gender', label: 'Sex', required: false, repeats: false, valueSet: 'urn:test:vs' },
        { path: 'Observation.valueString', label: 'Result', required: false, repeats: true, valueSet: null },
      ],
    });
  });

  it('pins an all-of equals rule', () => {
    const t = buildTarget('t', 'T', [{
      pack: patient,
      entries: [entry(0, 'Patient.identifier.value', 'Number', {
        discriminator: { join: 'all', conds: [{ el: 'system', op: 'equals', val: 'urn:test:pat' }] },
      })],
    }], opts);
    expect(t.fields.map((f) => f.path)).toEqual(['Patient.identifier.value?system=urn:test:pat']);
  });

  it('leaves out a null path, a link path, and a discriminator that does not pin', () => {
    const t = buildTarget('t', 'T', [
      {
        pack: patient,
        entries: [
          entry(0, null, 'No path'),
          entry(1, 'Patient.identifier.value', 'Any of', {
            discriminator: { join: 'any', conds: [{ el: 'system', op: 'equals', val: 'urn:a' }, { el: 'system', op: 'equals', val: 'urn:b' }] },
          }),
          entry(2, 'Patient.identifier.value', 'Starts with', {
            discriminator: { join: 'all', conds: [{ el: 'system', op: 'starts with', val: 'urn:' }] },
          }),
          entry(3, 'Patient.birthDate', 'Date of birth'),
        ],
      },
      { pack: observation, entries: [entry(0, 'Observation.subject', 'Patient')] },
    ], opts);
    expect(t.fields.map((f) => f.path)).toEqual(['Patient.birthDate']);
  });

  it('throws on two entries with one key, naming the key', () => {
    expect(() => buildTarget('t', 'T', [{
      pack: patient,
      entries: [entry(0, 'Patient.gender', 'Sex'), entry(1, 'Patient.gender', 'Sex again')],
    }], opts)).toThrow('Patient.gender');
  });

  it('throws on two packs for one record type', () => {
    expect(() => buildTarget('t', 'T', [
      { pack: patient, entries: [] },
      { pack: { id: 'pack-p2', resourceType: 'Patient' }, entries: [] },
    ], opts)).toThrow('Patient');
  });

  it('builds from the seeded patient and order packs without a clash', () => {
    const packs = seededStarterPacks().filter((p) => p.id === 'pack-patient' || p.id === 'pack-service-request');
    const t = buildTarget('t', 'T', packs.map((p) => ({ pack: p, entries: p.entries })), {
      links: [{ from: 'ServiceRequest', path: 'ServiceRequest.subject', to: 'Patient' }],
      defaults: [],
    });
    const paths = t.fields.map((f) => f.path);
    expect(paths).toContain('Patient.name.given?use=official');
    expect(paths).toContain('ServiceRequest.requester?type=Practitioner');
    expect(paths).toContain('ServiceRequest.requester?type=Organization');
    expect(paths).toContain('ServiceRequest.note.0.text');
    expect(paths).not.toContain('ServiceRequest.subject');
  });
});
