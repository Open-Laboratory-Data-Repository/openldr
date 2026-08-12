import { describe, it, expect } from 'vitest';
import { saveFacilityValueMappings, FACILITY_VALUE_MAP_TYPE } from './facility-value-mappings';
import { observedFieldSystem } from './facility-controlled-fields';

const SYSTEM = 'urn:zm:mfl';

/**
 * Codes per value-set url, so a `status` entry validates against status codes rather than level's.
 * Each code also carries its OWN coding-system url (`system`) — distinct from the value-set url
 * itself, mirroring migrations 072/073: `terminology_concepts` rows are filed under
 * `urn:openldr:cs:facility-type` / `http://hl7.org/fhir/location-status` / `urn:iso:std:iso:3166`,
 * never under a `urn:openldr:valueset:*` url. `admin.valueSets.expand()` returns `ExpandedConcept`
 * (`packages/db/src/value-set-expander.ts:4`), which already carries this as `system`.
 */
const EXPANSIONS: Record<string, { system: string; code: string; display: string }[]> = {
  'urn:openldr:valueset:facility-type': [
    { system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' },
    { system: 'urn:openldr:cs:facility-type', code: 'health-post', display: 'Health Post' },
  ],
  'urn:openldr:valueset:location-status': [
    { system: 'http://hl7.org/fhir/location-status', code: 'active', display: 'Active' },
    { system: 'http://hl7.org/fhir/location-status', code: 'inactive', display: 'Inactive' },
  ],
  'urn:openldr:valueset:country': [
    { system: 'urn:iso:std:iso:3166', code: 'ZMB', display: 'Zambia' },
  ],
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

  it('writes the mapping under the CODE\'s own coding system, not the value-set url', async () => {
    // Regression guard: terminology_concepts rows for a target code are filed under a coding
    // system (e.g. `urn:openldr:cs:facility-type`), never under the value set that bounds it
    // (`urn:openldr:valueset:facility-type`). `saveExclusive`/`create` looks up
    // `(toSystem, toCode)` in `terminology_concepts` and mints a DRAFT concept on a miss
    // (`packages/db/src/terminology-admin-store.ts:724`) — passing the value-set url as
    // `toSystem` would miss on every call and pollute an invisible, unseeded "system".
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
      { field: 'status', rawValue: 'Functional', toCode: 'active' },
      { field: 'country', rawValue: 'ZAMBIA', toCode: 'ZMB' },
    ]);
    expect(admin.saved.map((m: any) => m.toSystem)).toEqual([
      'urn:openldr:cs:facility-type',
      'http://hl7.org/fhir/location-status',
      'urn:iso:std:iso:3166',
    ]);
    // None of them should be the value-set url.
    for (const m of admin.saved) {
      expect(m.toSystem).not.toMatch(/^urn:openldr:valueset:/);
    }
  });

  // Whole-branch review, M4: `expansions` (facility-value-mappings.ts) is a `Map<field, Map<code,
  // {display, system}>>` keyed by CODE ALONE. Safe today only because all three controlled value
  // sets (facility-type/location-status/country) each compose exactly one coding system, so no
  // expansion has ever actually carried one code under two systems — but nothing enforces that, and
  // it is the only thing standing between an expansion like that and the pinned `FACILITY_VALUE_MAP_TYPE`
  // ('SAME-AS') invariant this whole file's docblock is about: `saveExclusive` scopes exclusivity by
  // `(toSystem, mapType)`, so silently picking ONE of two systems for a code (whichever `expand`
  // happened to list last) could write a mapping under a system the operator never chose, with no
  // error anywhere.
  it('⛔ refuses to save when a value set\'s expansion carries one code under two systems', async () => {
    const admin = fakeAdmin();
    admin.valueSets.expand = async () => ({
      codes: [
        { system: 'urn:openldr:cs:facility-type', code: 'health-center', display: 'Health Center' },
        { system: 'urn:some:other:cs', code: 'health-center', display: 'Health Center (other)' },
      ],
    });

    await expect(saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
    ])).rejects.toThrow(/two different systems/);
    // Nothing partially written — the same "validate every entry before writing any" discipline
    // this file's other refusal (the not-in-value-set one above) already follows.
    expect(admin.saved).toEqual([]);
  });

  it('upserts the observed coding system once per FIELD, not once per entry', async () => {
    const admin = fakeAdmin();
    await saveFacilityValueMappings(admin, SYSTEM, [
      { field: 'level', rawValue: 'Health Centre', toCode: 'health-center' },
      { field: 'level', rawValue: 'Health Post', toCode: 'health-post' },
      { field: 'level', rawValue: 'Clinic', toCode: 'health-post' },
    ]);
    expect(admin.systems).toHaveLength(1);
    expect(admin.systems[0]).toMatchObject({ url: observedFieldSystem('level', SYSTEM) });
  });
});
