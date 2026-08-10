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
