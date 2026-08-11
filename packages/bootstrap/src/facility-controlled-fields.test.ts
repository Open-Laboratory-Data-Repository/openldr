import { describe, it, expect } from 'vitest';
import { resolveControlledFields, applyControlledFields, observedFieldSystem } from './facility-controlled-fields';
import type { FacilityRecord } from '@openldr/db';

const rec = (over: Partial<FacilityRecord>): FacilityRecord =>
  ({ id: 'fac-1', name: 'A', source: 'import', ...over } as FacilityRecord);

function fakeAdmin(opts: {
  valueSets?: Record<string, string[]>;
  mappings?: Record<string, { toCode: string; isActive: boolean }[]>;
}) {
  return {
    valueSets: {
      async getByUrl(url: string) { return opts.valueSets?.[url] ? { id: url } : null; },
      async expand(id: string) {
        return { codes: (opts.valueSets?.[id] ?? []).map((code) => ({ code })), total: 0 };
      },
    },
    termMappings: {
      async listOutgoing(system: string, code: string) {
        return (opts.mappings?.[`${system}|${code}`] ?? []).map((m) => ({ ...m, toSystem: '', fromSystem: system, fromCode: code }));
      },
    },
  } as never;
}

describe('resolveControlledFields', () => {
  it('reports a value already canonical as neither mapped nor unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['dispensary'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'dispensary' })]);
    expect(res.unmapped.level).toEqual([]);
    expect(res.mapped.level.size).toBe(0);
  });

  it('reports a value with no canonical code and no mapping as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('resolves a mapped source value to its canonical code', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.mapped.level.get('health_center')).toBe('health-center');
    expect(res.unmapped.level).toEqual([]);
  });

  it('ignores a DEACTIVATED mapping', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: false }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    expect(res.unmapped.level).toEqual(['health_center']);
  });

  it('reports a field whose value set is absent as notValidated, and never as unmapped', async () => {
    const admin = fakeAdmin({ valueSets: {} });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'anything' })]);
    expect(res.notValidated).toContain('level');
    expect(res.unmapped.level).toEqual([]);
  });
});

describe('applyControlledFields', () => {
  it('writes the canonical code and preserves the raw source value', async () => {
    const from = observedFieldSystem('level', 'urn:tz:hfr');
    const admin = fakeAdmin({
      valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] },
      mappings: { [`${from}|health_center`]: [{ toCode: 'health-center', isActive: true }] },
    });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health-center');
    expect(out.extras?.__source).toEqual({ level: 'health_center' });
  });

  it('leaves an UNMAPPED value exactly as it is rather than blanking it', async () => {
    const admin = fakeAdmin({ valueSets: { 'urn:openldr:valueset:facility-type': ['health-center'] } });
    const res = await resolveControlledFields(admin, 'urn:tz:hfr', [rec({ level: 'health_center' })]);
    const out = applyControlledFields(rec({ level: 'health_center' }), res);
    expect(out.level).toBe('health_center');
  });
});

// --- B1 Task 3: the first argument is a REGISTER'S CANONICAL URI ---------------------------------
//
// ⚠ The brief proposed `expect(observedFieldSystem('level','urn:tz:hfr')).toBe(observedFieldSystem(
// 'level','urn:tz:hfr'))` here. That assertion is INERT — identical arguments to a pure function are
// equal no matter what the body does, so it cannot fail and pins nothing. What is actually worth
// pinning is the two properties this function must keep now that its input is a URI: the suffix stays
// URL-SAFE (a URI carries `:` and `/`), and two DIFFERENT registers keep two DIFFERENT namespaces.
describe('observedFieldSystem under canonical-URI input', () => {
  it('⛔ slugifies the URI into a URL-safe suffix rather than embedding it raw', () => {
    expect(observedFieldSystem('level', 'urn:tz:hfr')).toBe('urn:openldr:cs:facility-level:urn_tz_hfr');
    // The `:` separators of the URI itself must not survive into the system url — deleting the
    // slugification (the brief's own ⛔) would leave `…:facility-level:urn:tz:hfr`.
    expect(observedFieldSystem('level', 'urn:tz:hfr').split(':').length).toBe(5);
  });

  it('⛔ keeps two different registers in two different namespaces', () => {
    expect(observedFieldSystem('level', 'urn:tz:mfl')).not.toBe(observedFieldSystem('level', 'urn:tz:hfr'));
  });

  it('⛔ still namespaces per FIELD, so one register\'s level and status never share mappings', () => {
    expect(observedFieldSystem('status', 'urn:tz:hfr')).not.toBe(observedFieldSystem('level', 'urn:tz:hfr'));
  });
});
