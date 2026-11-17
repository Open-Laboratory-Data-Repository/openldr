import { describe, it, expect } from 'vitest';
import type { StarterPackEntry } from '../starter-pack';
import { seededStarterPacks } from '../samples/starter-packs';
import { buildTarget, parseTargetPath, targetPathKey, type MapTarget } from './target';

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
    ], { ...opts, identity: [
      { record: 'Patient', parts: [{ field: 'Patient.name.given?use=official' }] },
      { record: 'Observation', parts: [{ record: 'Patient' }, { field: 'Observation.valueString', optional: true }] },
    ] });
    expect(t).toEqual({
      id: 't1',
      name: 'Test target',
      records: [
        { type: 'Patient', packId: 'pack-p', repeats: false },
        { type: 'Observation', packId: 'pack-o', repeats: true },
      ],
      links: opts.links,
      defaults: opts.defaults,
      identity: [
        { record: 'Patient', parts: [{ field: 'Patient.name.given?use=official' }] },
        { record: 'Observation', parts: [{ record: 'Patient' }, { field: 'Observation.valueString', optional: true }] },
      ],
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
    }], { ...opts, identity: [{ record: 'Patient', parts: [{ field: 'Patient.identifier.value?system=urn:test:pat' }] }] });
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
    ], { ...opts, identity: [
      { record: 'Patient', parts: [{ field: 'Patient.birthDate' }] },
      { record: 'Observation', parts: [{ record: 'Patient' }] },
    ] });
    expect(t.fields.map((f) => f.path)).toEqual(['Patient.birthDate']);
  });

  it('throws on two entries with one key, naming the key', () => {
    expect(() => buildTarget('t', 'T', [{
      pack: patient,
      entries: [entry(0, 'Patient.gender', 'Sex'), entry(1, 'Patient.gender', 'Sex again')],
    }], { ...opts, identity: [{ record: 'Patient', parts: [{ field: 'Patient.gender' }] }] })).toThrow('Patient.gender');
  });

  it('throws on two packs for one record type', () => {
    expect(() => buildTarget('t', 'T', [
      { pack: patient, entries: [] },
      { pack: { id: 'pack-p2', resourceType: 'Patient' }, entries: [] },
    ], { ...opts, identity: [] })).toThrow('Patient');
  });

  it('puts extra fields first among their own record, and refuses a clash or an unknown record', () => {
    const extraField = { path: 'Patient.identifier.value', label: 'Patient ID', required: false, repeats: false, valueSet: null };
    const packs = [
      { pack: patient, entries: [entry(0, 'Patient.gender', 'Sex')] },
      { pack: observation, entries: [entry(0, 'Observation.valueString', 'Result')], repeats: true },
    ];
    const xo = { ...opts, identity: [
      { record: 'Patient', parts: [{ field: 'Patient.gender' }] },
      { record: 'Observation', parts: [{ record: 'Patient' }] },
    ] };
    const t = buildTarget('t', 'T', packs, { ...xo, extra: [extraField] });
    expect(t.fields.map((f) => f.path)).toEqual(['Patient.identifier.value', 'Patient.gender', 'Observation.valueString']);
    expect(t.fields[0]).toEqual(extraField);
    expect(() => buildTarget('t', 'T', packs, { ...xo, extra: [{ ...extraField, path: 'Patient.gender' }] })).toThrow('Patient.gender');
    expect(() => buildTarget('t', 'T', packs, { ...xo, extra: [{ ...extraField, path: 'Specimen.type' }] })).toThrow('Specimen');
    expect(() => buildTarget('t', 'T', packs, { ...xo, extra: [{ ...extraField, path: 'Observation.subject' }] })).toThrow('Observation.subject');
  });

  it('builds from the seeded patient and order packs without a clash', () => {
    const packs = seededStarterPacks().filter((p) => p.id === 'pack-patient' || p.id === 'pack-service-request');
    const t = buildTarget('t', 'T', packs.map((p) => ({ pack: p, entries: p.entries })), {
      links: [{ from: 'ServiceRequest', path: 'ServiceRequest.subject', to: 'Patient' }],
      defaults: [],
      identity: [
        { record: 'Patient', parts: [{ field: 'Patient.birthDate' }] },
        { record: 'ServiceRequest', parts: [{ record: 'Patient' }, { field: 'ServiceRequest.code' }] },
      ],
    });
    const paths = t.fields.map((f) => f.path);
    expect(paths).toContain('Patient.name.given?use=official');
    expect(paths).toContain('ServiceRequest.requester?type=Practitioner');
    expect(paths).toContain('ServiceRequest.requester?type=Organization');
    expect(paths).toContain('ServiceRequest.note.0.text');
    expect(paths).not.toContain('ServiceRequest.subject');
    // Order rejection is an Extension, which no single cell fills.
    expect(paths).not.toContain('ServiceRequest.extension?url=urn:openldr:ext:rejection');
  });

  it('leaves out an entry no single cell can fill, and throws naming it when it is required', () => {
    const ident = { ...opts, identity: [{ record: 'Patient', parts: [{ field: 'Patient.gender' }] }] };
    const t = buildTarget('t', 'T', [{
      pack: patient,
      entries: [entry(0, 'Patient.gender', 'Sex'), entry(1, 'Patient.identifier', 'Whole identifier')],
    }], ident);
    expect(t.fields.map((f) => f.path)).toEqual(['Patient.gender']);
    expect(() => buildTarget('t', 'T', [{
      pack: patient,
      entries: [entry(0, 'Patient.gender', 'Sex'), entry(1, 'Patient.identifier', 'Whole identifier', { required: true })],
    }], ident)).toThrow('Patient.identifier');
    expect(() => buildTarget('t', 'T', [{ pack: patient, entries: [entry(0, 'Patient.gender', 'Sex')] }], {
      ...ident, extra: [{ path: 'Patient.identifier', label: 'X', required: false, repeats: false, valueSet: null }],
    })).toThrow('Patient.identifier');
  });

  it('lets the target set the required list, and refuses a listed key that is not a field', () => {
    const o = { ...opts, identity: [{ record: 'Patient', parts: [{ field: 'Patient.gender' }] }] };
    const packs = [{ pack: patient, entries: [entry(0, 'Patient.gender', 'Sex', { required: true }), entry(1, 'Patient.birthDate', 'Date of birth')] }];
    expect(buildTarget('t', 'T', packs, o).fields.map((f) => f.required)).toEqual([true, false]);
    expect(buildTarget('t', 'T', packs, { ...o, required: ['Patient.birthDate'] }).fields.map((f) => f.required)).toEqual([false, true]);
    expect(buildTarget('t', 'T', packs, { ...o, required: [] }).fields.map((f) => f.required)).toEqual([false, false]);
    expect(() => buildTarget('t', 'T', packs, { ...o, required: ['Patient.deceasedBoolean'] })).toThrow('Patient.deceasedBoolean');
  });

  describe('identity', () => {
    const specimen = { id: 'pack-s', resourceType: 'Specimen' };
    const packs = [
      { pack: patient, entries: [entry(0, 'Patient.gender', 'Sex')] },
      { pack: specimen, entries: [entry(0, 'Specimen.type', 'Type')] },
      { pack: observation, entries: [entry(0, 'Observation.valueString', 'Result')], repeats: true },
    ];
    const good: MapTarget['identity'] = [
      { record: 'Patient', parts: [{ field: 'Patient.gender' }] },
      { record: 'Specimen', parts: [{ record: 'Patient' }, { field: 'Specimen.type' }], fallback: [{ record: 'Patient' }] },
      { record: 'Observation', parts: [{ record: 'Specimen' }, { field: 'Observation.valueString' }] },
    ];
    const build = (identity: MapTarget['identity']) => buildTarget('t', 'T', packs, { ...opts, identity });

    it('carries the identity it is given', () => {
      expect(build(good).identity).toEqual(good);
    });

    it('refuses a record with no identity, naming it', () => {
      expect(() => build(good.filter((i) => i.record !== 'Specimen'))).toThrow('Specimen');
    });

    it('refuses an identity for a record the target lacks, and two for one record', () => {
      expect(() => build([...good, { record: 'Location', parts: [{ field: 'Patient.gender' }] }])).toThrow('Location');
      expect(() => build([...good, good[0]])).toThrow('Patient');
    });

    it('refuses an unknown field or record part, naming it', () => {
      expect(() => build([{ record: 'Patient', parts: [{ field: 'Patient.birthDate' }] }, ...good.slice(1)])).toThrow('Patient.birthDate');
      expect(() => build([good[0], { record: 'Specimen', parts: [{ record: 'Device' }] }, good[2]])).toThrow('Device');
      expect(() => build([good[0], { ...good[1], fallback: [{ field: 'Specimen.receivedTime' }] }, good[2]])).toThrow('Specimen.receivedTime');
    });

    it('refuses a record part that points at a repeating record', () => {
      expect(() => build([good[0], { record: 'Specimen', parts: [{ record: 'Observation' }] }, good[2]])).toThrow('Observation');
    });

    it('refuses a single record whose identity reads a repeating field', () => {
      expect(() => build([good[0], { record: 'Specimen', parts: [{ field: 'Observation.valueString' }] }, good[2]])).toThrow('Observation.valueString');
    });

    it('refuses a cycle, naming the records in it', () => {
      expect(() => build([
        { record: 'Patient', parts: [{ record: 'Specimen' }] },
        { record: 'Specimen', parts: [{ record: 'Patient' }, { field: 'Specimen.type' }] },
        good[2],
      ])).toThrow(/cycle.*Patient.*Specimen|cycle.*Specimen.*Patient/);
      expect(() => build([{ record: 'Patient', parts: [{ record: 'Patient' }] }, ...good.slice(1)])).toThrow(/cycle/);
    });

    it('refuses an identity with no parts', () => {
      expect(() => build([{ record: 'Patient', parts: [] }, ...good.slice(1)])).toThrow('Patient');
    });
  });
});
