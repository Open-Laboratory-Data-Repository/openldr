import { describe, it, expect } from 'vitest';
import { saveFacilityValueMappings, FACILITY_VALUE_MAP_TYPE } from './facility-value-mappings';
import { observedFieldSystem } from './facility-controlled-fields';

const SYSTEM = 'urn:zm:mfl';

/** Codes per value-set url, so a `status` entry validates against status codes rather than level's. */
const EXPANSIONS: Record<string, { code: string; display: string }[]> = {
  'urn:openldr:valueset:facility-type': [
    { code: 'health-center', display: 'Health Center' },
    { code: 'health-post', display: 'Health Post' },
  ],
  'urn:openldr:valueset:location-status': [
    { code: 'active', display: 'Active' },
    { code: 'inactive', display: 'Inactive' },
  ],
  'urn:openldr:valueset:country': [{ code: 'ZMB', display: 'Zambia' }],
};

function fakeAdmin() {
  const saved: any[] = [];
  const systems: any[] = [];
  const createdTerms: any[] = [];
  return {
    saved, systems, createdTerms,
    valueSets: {
      getByUrl: async (url: string) => ({ id: url }),
      expand: async (id: string) => ({ codes: EXPANSIONS[id] ?? [] }),
    },
    codingSystems: { upsertByUrl: async (i: any) => { systems.push(i); } },
    terms: { create: async (i: any) => { createdTerms.push(i); } },
    termMappings: {
      saveExclusive: async (i: any) => { saved.push(i); return { mapping: i, draftCreated: false, superseded: [] }; },
    },
  } as any;
}

describe('saveFacilityValueMappings', () => {
  it('writes one exclusive mapping per raw value, under the derived source system', async () => {
    const admin = fakeAdmin();
    const res = await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
    ]);
    expect(res.written).toBe(1);
    expect(admin.saved[0]).toMatchObject({
      fromSystem: observedFieldSystem('level', SYSTEM),
      fromCode: 'Health Centre',
      toCode: 'health-center',
      mapType: FACILITY_VALUE_MAP_TYPE,
      isActive: true,
    });
  });

  it('uses the SAME map type for every field, so exclusivity and resolution agree', async () => {
    // Not an assertion about the constant's literal value — that would prove nothing. This asserts
    // the property that matters: two mappings written for DIFFERENT fields still share one map type,
    // which is what makes saveExclusive's (toSystem, mapType) scope line up with
    // resolveControlledFields' toSystem-blind lookup. Vary the type per field and the two disagree.
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
      { field: 'status', rawValue: 'Functional', toCode: 'active' },
    ]);
    expect(new Set(admin.saved.map((m: any) => m.mapType)).size).toBe(1);
  });

  it('creates the source coding system and its concept, so the mapping is editable afterwards', async () => {
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'status', rawValue: 'Functional', toCode: 'active' },
    ]);
    expect(admin.systems[0]).toMatchObject({ url: observedFieldSystem('status', SYSTEM) });
    expect(admin.createdTerms[0]).toMatchObject({ code: 'Functional' });
  });

  it('refuses a target that is not in the field value set, rather than minting a draft', async () => {
    const admin = fakeAdmin();
    await expect(saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Hospice', toCode: 'not-a-real-code' },
    ])).rejects.toThrow(/not in the .* value set/);
    expect(admin.saved).toEqual([]);
  });
});
