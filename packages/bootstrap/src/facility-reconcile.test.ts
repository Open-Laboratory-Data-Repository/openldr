import { describe, it, expect } from 'vitest';
import { scanObservedFacilities, resolveObservedFacilities, publishFacilityMap, publishRegistryConcepts, captureObservedFacility } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers, seedRegistry, seedMapping } from './test-support/facility-reconcile-fixture';

describe('scanObservedFacilities', () => {
  it('discovers distinct performers and creates concepts', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247], ['HYDOH', 99]]);

    const result = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    expect(result).toMatchObject({ discovered: 2, created: 2, updated: 0 });
    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['Dodoma', 'HYDOH']);
  });

  // ⛔ THE trap. Must fail if `active` is false, not merely if the row is absent.
  it('registers an ACTIVE coding_systems row so the mapping UI can see the system', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  // Regression guard for the ⚠ note: `upsertByUrl` inserts `active: true` but its `onConflict`
  // update never re-activates a row that already exists with `active = false`. Force that state by
  // deactivating the row directly, then confirm a re-scan repairs it.
  it('re-activates a coding_systems row an operator (or an earlier bug) left inactive', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    await deps.internalDb.updateTable('coding_systems').set({ active: false }).where('url', '=', 'urn:openldr:default_fac').execute();
    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac'))!.active).toBe(false);

    await scanObservedFacilities(deps, { now: '2026-08-06T00:00:00.000Z', apply: true });

    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac'))!.active).toBe(true);
  });

  it('is idempotent and preserves a curated display on re-scan', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['HYDOH', 99]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    await deps.admin.terms.update('urn:openldr:default_fac', 'HYDOH', {
      system: 'urn:openldr:default_fac',
      code: 'HYDOH',
      display: 'Hydom Lutheran Hospital',
      status: 'ACTIVE',
    });
    await seedPerformers(deps, [['HYDOH', 104]]);

    const second = await scanObservedFacilities(deps, { now: '2026-08-06T00:00:00.000Z', apply: true });

    expect(second).toMatchObject({ discovered: 1, created: 0, updated: 1 });
    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].display).toBe('Hydom Lutheran Hospital');
  });

  // Decision (task brief, resolved explicitly): `firstSeen` is read from the RAW `terminology_concepts`
  // row, not through `admin.terms.search` (whose `Term` shape drops the firstSeen/lastSeen/reportCount
  // blob entirely). A re-scan must carry `firstSeen` forward rather than re-stamping it — otherwise the
  // field is meaningless. Proven here by reaching into the raw row rather than the unpacked `Term`.
  it('does not advance firstSeen on a re-scan', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 10]]);
    await scanObservedFacilities(deps, { now: '2026-08-01T00:00:00.000Z', apply: true });

    const rawAfterFirst = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Dodoma')
      .executeTakeFirstOrThrow();
    const propsAfterFirst = (typeof rawAfterFirst.properties === 'string' ? JSON.parse(rawAfterFirst.properties) : rawAfterFirst.properties) as {
      firstSeen: string;
      lastSeen: string;
      reportCount: number;
    };
    expect(propsAfterFirst.firstSeen).toBe('2026-08-01T00:00:00.000Z');

    await seedPerformers(deps, [['Dodoma', 5]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const rawAfterSecond = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Dodoma')
      .executeTakeFirstOrThrow();
    const propsAfterSecond = (typeof rawAfterSecond.properties === 'string' ? JSON.parse(rawAfterSecond.properties) : rawAfterSecond.properties) as {
      firstSeen: string;
      lastSeen: string;
      reportCount: number;
    };
    expect(propsAfterSecond.firstSeen).toBe('2026-08-01T00:00:00.000Z');
    expect(propsAfterSecond.lastSeen).toBe('2026-08-05T00:00:00.000Z');
    expect(propsAfterSecond.reportCount).toBe(15);
  });

  // ⛔ PINS THE BUG, does not endorse it. `admin.terms.update()` (`terminology-admin-store.ts`
  // `packProps`/`update`, lines 185-193 and 520-528) overwrites `properties` wholesale — an operator
  // curating a facility's display through `/terminology` wipes `firstSeen`/`lastSeen`/`reportCount`.
  // This test asserts the CONCRETE observed value (not merely "it is a string") so it breaks the
  // moment that upstream bug is fixed, forcing whoever fixes it to find and update this test
  // deliberately rather than leaving a stale doc comment behind.
  it('firstSeen resets if an operator edits the term in /terminology (see terms.update properties loss)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-01T00:00:00.000Z', apply: true });

    // Operator curates the display in /terminology. `terms.update` packs only shortName/class/
    // unit/replacedBy/metadata — none supplied here — so `packProps` returns null and `update`
    // writes `properties: null`, destroying the firstSeen/lastSeen/reportCount blob.
    await deps.admin.terms.update('urn:openldr:default_fac', 'Dodoma', {
      system: 'urn:openldr:default_fac',
      code: 'Dodoma',
      display: 'Dodoma Regional Hospital',
      status: 'ACTIVE',
    });

    await seedPerformers(deps, [['Dodoma', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-10T00:00:00.000Z', apply: true });

    const raw = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Dodoma')
      .executeTakeFirstOrThrow();
    const props = (typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties) as {
      firstSeen: string;
      lastSeen: string;
      reportCount: number;
    };
    // The ACTUAL observed behaviour: firstSeen is NOT '2026-08-01...' (the original scan) — the
    // operator edit wiped it, so the re-scan re-stamps it to its own `now`.
    expect(props.firstSeen).toBe('2026-08-10T00:00:00.000Z');
    expect(props.lastSeen).toBe('2026-08-10T00:00:00.000Z');
    expect(props.reportCount).toBe(2);
  });

  it('registers a non-default opts.system under its own coding_systems row, distinct from the default system', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await scanObservedFacilities(deps, {
      now: '2026-08-05T00:00:00.000Z',
      apply: true,
      system: 'urn:openldr:feed-b',
    });

    const defaultCs = await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac');
    const feedBCs = await deps.admin.codingSystems.getByUrl('urn:openldr:feed-b');
    expect(defaultCs).not.toBeNull();
    expect(feedBCs).not.toBeNull();
    expect(feedBCs!.systemCode).not.toBe(defaultCs!.systemCode);
    expect(defaultCs!.systemCode).toBe('DEFAULT_FAC');
    expect(feedBCs!.systemCode).toBe('URN_OPENLDR_FEED_B');
    expect(defaultCs!.active).toBe(true);
    expect(feedBCs!.active).toBe(true);
  });

  it('a system url that slugifies to empty still gets a code distinct from DEFAULT_SYSTEM_CODE', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true, system: '///' });

    const cs = await deps.admin.codingSystems.getByUrl('///');
    expect(cs).not.toBeNull();
    expect(cs!.systemCode).not.toBe('DEFAULT_FAC');
    expect(cs!.systemCode.startsWith('SYS_')).toBe(true);
  });

  it('writes nothing when apply is falsy but still reports what it found', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);

    const dry = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z' });

    expect(dry).toMatchObject({ discovered: 1, created: 1 });
    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  it('ignores null performers', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1], [null, 5]]);

    const result = await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    expect(result.discovered).toBe(1);
  });
});

describe('resolveObservedFacilities', () => {
  it('resolves a registry-route mapping to the canonical name', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD', region: 'Dodoma' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Dodoma Regional Referral Hospital');
    expect(row.resolvedVia).toBe('registry');
    expect(row.region).toBe('Dodoma');
    expect(row.targetMissing).toBe(false);
  });

  it('resolves a national-route mapping through (national_system, national_code)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Muhimbili', 82]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Muhimbili',
      toSystem: 'urn:tz:hfr', toCode: 'TZ-001',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Muhimbili National Hospital');
    expect(row.resolvedVia).toBe('national');
  });

  // ⛔ The operator chose "both targets allowed"; this pins the tiebreak so it can never be a coin flip.
  it('prefers the registry route when both mappings exist', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Mnazi Mmoja', 182]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-3', name: 'Mnazi Mmoja Hospital', localCode: 'MMH' });
    await seedRegistry(deps, { id: 'fac-4', name: 'Some Other Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:tz:hfr', toCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-3' });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Mnazi Mmoja Hospital');
    expect(row.resolvedVia).toBe('registry');
  });

  it('reports an unmapped code as null, not blank', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Kibondo', 148]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBeNull();
    expect(row.resolvedVia).toBeNull();
    expect(row.targetMissing).toBe(false);
    expect(row.sourceCode).toBe('Kibondo');
  });

  it('flags targetMissing when the mapped facility was deleted', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Ocean Road Cancer Institute (O', 6]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Ocean Road Cancer Institute (O',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-deleted',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.targetMissing).toBe(true);
    expect(row.name).toBeNull();
  });

  it('ignores an inactive mapping', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1', isActive: false,
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.resolvedVia).toBeNull();
  });
});

describe('publishFacilityMap', () => {
  it('writes resolved rows to the warehouse and re-publishes without duplicating', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 247], ['Kibondo', 148]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Dodoma',
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'fac-1',
    });

    const first = await publishFacilityMap(deps, { apply: true });
    const second = await publishFacilityMap(deps, { apply: true });

    expect(first).toMatchObject({ resolved: 1, unmapped: 1, written: 2 });
    expect(second).toEqual(first);
    const rows = await deps.externalDb.selectFrom('facility_map').selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source_code === 'Dodoma')!.name).toBe('Dodoma Regional Referral Hospital');
    expect(rows.find((r) => r.source_code === 'Kibondo')!.name).toBeNull();
  });
});

describe('publishRegistryConcepts', () => {
  // The assertion is the OPERATOR-VISIBLE outcome — what the picker will search — not that some
  // internal function was called.
  it('makes every registry row pickable as a mapping target', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });

    const result = await publishRegistryConcepts(deps, { apply: true });

    expect(result).toMatchObject({ concepts: 2, systemRegistered: true });
    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 50, offset: 0 });
    expect(rows.map((r) => ({ code: r.code, display: r.display })).sort((a, b) => a.code.localeCompare(b.code)))
      .toEqual([
        { code: 'fac-1', display: 'Dodoma Regional Referral Hospital' },
        { code: 'fac-2', display: 'Muhimbili National Hospital' },
      ]);
  });

  it('registers an ACTIVE coding_systems row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishRegistryConcepts(deps, { apply: true });

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  it('tracks a renamed facility on re-publish', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Hospital', localCode: 'DOD' });
    await publishRegistryConcepts(deps, { apply: true });

    await deps.internalDb.updateTable('facility_registry')
      .set({ name: 'Dodoma Regional Referral Hospital' }).where('id', '=', 'fac-1').execute();
    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].display).toBe('Dodoma Regional Referral Hospital');
  });

  it('is called by publishFacilityMap', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishFacilityMap(deps, { apply: true });

    const { total } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(total).toBe(1);
  });

  // Regression guard, mirroring `scanObservedFacilities`'s equivalent test above: `upsertByUrl`'s
  // `onConflict` update never touches `active`, so a row left inactive (operator, or an earlier bug)
  // must be repaired explicitly. Force that state by deactivating the row directly, then confirm a
  // re-publish repairs it.
  it('re-activates a coding_systems row an operator (or an earlier bug) left inactive', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await publishRegistryConcepts(deps, { apply: true });

    await deps.internalDb.updateTable('coding_systems').set({ active: false })
      .where('url', '=', 'urn:openldr:cs:facility-registry').execute();
    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry'))!.active).toBe(false);

    await publishRegistryConcepts(deps, { apply: true });

    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry'))!.active).toBe(true);
  });

  it('writes nothing when apply is falsy', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishRegistryConcepts(deps, {});

    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(0);
    expect(await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry')).toBeNull();
  });
});

describe('captureObservedFacility', () => {
  it('creates a concept for a newly seen performer', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['Namansi']);
  });

  it('is idempotent for a performer already captured', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-06T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(1);
  });

  it('keeps the string byte-for-byte', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows[0].code).toBe('Aga Khan');
  });

  // ⚠ `terms.search` with a `query` does a substring match — a performer whose code is a SUBSTRING
  // of an already-captured one (or vice versa) must still create its own, distinct concept.
  it('creates a distinct concept even when the code is a substring of an existing one', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan Hospital', '2026-08-05T00:00:00.000Z');

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['Aga Khan', 'Aga Khan Hospital']);
  });

  it('does nothing for an empty code', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', '', '2026-08-05T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  it('records reportCount 0 for a code first seen through this path', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    const raw = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Namansi')
      .executeTakeFirstOrThrow();
    const props = (typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties) as {
      firstSeen: string;
      lastSeen: string;
      reportCount: number;
    };
    expect(props.reportCount).toBe(0);
    expect(props.firstSeen).toBe('2026-08-05T00:00:00.000Z');
  });
});
