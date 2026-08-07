import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_OBSERVED_FACILITY_SYSTEM, FACILITY_REGISTRY_SYSTEM, observedSystemForFeed } from '@openldr/db';
import { scanObservedFacilities, resolveObservedFacilities, publishFacilityMap, publishRegistryConcepts, projectRegistryRows, reprojectRegistryRows, captureObservedFacility, captureObservedFacilityFromProjection, assertResolvedFacilityInvariant } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers, seedRegistry, seedMapping, currentConceptCode } from './test-support/facility-reconcile-fixture';

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

  // Task 9b: `opts.system` (a caller-chosen DESTINATION) is gone — scan now derives a system per
  // row from `source_system` via `observedSystemForFeed`, so a second feed's own system is reached
  // by seeding a second `source_system`, not by passing a destination option. (Task 9b's own
  // describe block below has the fuller multi-feed coverage; this one pins the exact `systemCode`
  // string `systemCodeFor` derives, mirroring what this test asserted before Task 9b.)
  it('registers a non-default feed under its own coding_systems row, distinct from the default system', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]);
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-b' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const defaultCs = await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac');
    const feedBCs = await deps.admin.codingSystems.getByUrl('urn:openldr:fac_feed_b');
    expect(defaultCs).not.toBeNull();
    expect(feedBCs).not.toBeNull();
    expect(feedBCs!.systemCode).not.toBe(defaultCs!.systemCode);
    expect(defaultCs!.systemCode).toBe('DEFAULT_FAC');
    expect(feedBCs!.systemCode).toBe('URN_OPENLDR_FAC_FEED_B');
    expect(defaultCs!.active).toBe(true);
    expect(feedBCs!.active).toBe(true);
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

  // Task 11 (whole-branch review, Fix 1): before this fix, `urn:openldr:cs:facility-registry` only
  // got its `coding_systems` row from `publishFacilityMap` (via `publishRegistryConcepts`) — the ONE
  // caller. An operator who opens the Observed tab and presses Scan (never Publish) found no registry
  // system in `TermMappingDialog`'s dropdown, in either search or manual mode, because both build
  // their target list from `systems.filter((s) => s.active)`. This pins that a Scan alone must leave
  // the registry pickable, with one concept per `facility_registry` row.
  it('also publishes the registry projection so a Scan-only operator can pick a mapping target', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 5]]);
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['DOD', 'TZ-001']);
  });

  // ⚠ Gating regression guard: a dry-run scan must not have this side effect either.
  //
  // Migration 075 now seeds the `coding_systems` row unconditionally on a fresh install, so the row's
  // absence is no longer the right signal for "dry-run published nothing" — assert no CONCEPTS were
  // published instead.
  it('does NOT publish the registry projection on a dry-run scan', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 5]]);
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z' }); // apply omitted -> dry run

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows).toHaveLength(0);
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
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'DOD',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Dodoma Regional Referral Hospital');
    expect(row.resolvedVia).toBe('registry');
    expect(row.region).toBe('Dodoma');
    expect(row.targetMissing).toBe(false);
    // Operator request: the local code disambiguates two similarly-named facilities (e.g. "Dodoma
    // Regional Referral" vs "Dodoma Zonal Lab") — the name alone cannot.
    expect(row.localCode).toBe('DOD');
  });

  it('reports localCode as null for an unmapped code (no registry row to read it from)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Kibondo', 148]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.localCode).toBeNull();
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
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:openldr:cs:facility-registry', toCode: 'MMH' });

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
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'DOD', isActive: false,
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.resolvedVia).toBeNull();
  });

  // ⛔ THE bug report: an operator mapped BALAB to ITSELF (target system = the observed system,
  // same code) via TermMappingDialog. The old classification treated "anything that is not the
  // registry system" as automatically a national-register route — so this self-mapping was looked
  // up in `byNational` (built only from registry rows that actually carry a `national_system`),
  // found nothing, and reported `targetMissing`. That is a lie: nothing is missing, the target was
  // never a facility. `nonFacilityTarget` is the honest state — a mapping was authored, but it does
  // not resolve to a facility at all.
  it('reports a self-mapping (observed system as its own target) as nonFacilityTarget, not targetMissing', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 6]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'BALAB',
      toSystem: 'urn:openldr:default_fac', toCode: 'BALAB',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.targetMissing).toBe(false);
    expect(row.resolvedVia).toBeNull();
    expect(row.nonFacilityTarget).toBe(true);
  });

  // Same defect, different target: a mapping to LOINC (or any other unrelated ACTIVE coding
  // system — ICD-10, UCUM, LOCAL) is not a national facility register just because it fails the
  // one exclusion ("not the registry system"). Distinguishes `nonFacilityTarget` from `targetMissing`.
  it('reports a mapping to an unrelated active system (e.g. LOINC) as nonFacilityTarget, not targetMissing', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 6]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'BALAB',
      toSystem: 'http://loinc.org', toCode: '12345-6',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.targetMissing).toBe(false);
    expect(row.resolvedVia).toBeNull();
    expect(row.nonFacilityTarget).toBe(true);
  });

  // The flip side: a mapping to a system that genuinely IS a facility register (proven by a LIVE
  // `facility_registry` row carrying that `national_system`) but whose code matches no row must
  // still report `targetMissing` — that meaning must survive Fix 1's tighter classification.
  it('still flags targetMissing for a national-route mapping whose code matches no registry row', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Muhimbili', 1], ['Ghost', 1]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    // Establishes 'urn:tz:hfr' as a KNOWN national system (a live row actually carries it).
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });
    await seedMapping(deps, {
      fromSystem: 'urn:openldr:default_fac', fromCode: 'Ghost',
      toSystem: 'urn:tz:hfr', toCode: 'TZ-999', // no registry row carries this code
    });

    const rows = await resolveObservedFacilities(deps);
    const row = rows.find((r) => r.sourceCode === 'Ghost')!;

    expect(row.targetMissing).toBe(true);
    expect(row.nonFacilityTarget).toBe(false);
    expect(row.resolvedVia).toBeNull();
  });

  // Regression guard for Fix 1: the two real routes, and registry-beats-national precedence, must
  // be unaffected by the tighter national-route classification.
  it('still resolves a valid registry-route mapping, and registry still beats national, with nonFacilityTarget false', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Mnazi Mmoja', 182]]);
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-3', name: 'Mnazi Mmoja Hospital', localCode: 'MMH' });
    await seedRegistry(deps, { id: 'fac-4', name: 'Some Other Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:tz:hfr', toCode: 'TZ-999' });
    await seedMapping(deps, { fromSystem: 'urn:openldr:default_fac', fromCode: 'Mnazi Mmoja', toSystem: 'urn:openldr:cs:facility-registry', toCode: 'MMH' });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Mnazi Mmoja Hospital');
    expect(row.resolvedVia).toBe('registry');
    expect(row.targetMissing).toBe(false);
    expect(row.nonFacilityTarget).toBe(false);
  });
});

// The CDR toolchain now sends an `Organization` per testing facility alongside the report
// (`facility-reconcile.md`), carrying an `address` `projectFacility` (packages/db) projects into
// `facilities.region`/`facilities.district`. `resolveObservedFacilities` joins that onto an
// OBSERVED (pre-mapping) row — the entire point being that DISA's five facility codes sharing the
// display "Aga Khan" (BAMAA/BBFAF/CDABE/EAFAE/NDFAM) become distinguishable BEFORE an operator maps
// anything, not only after.
describe('resolveObservedFacilities: observed facility location (facilities table)', () => {
  it('joins facilities.region/district onto an unmapped row by (facility_code, source_system)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BAMAA', 12]], { performerDisplay: 'Aga Khan' });
    await deps.externalDb.insertInto('facilities').values({
      id: 'facility-BAMAA', facility_code: 'BAMAA', facility_name: 'Aga Khan',
      region: 'Dar es Salaam', district: 'Ilala', source_system: 'webhook-ingest',
    } as never).execute();

    const [row] = await resolveObservedFacilities(deps);

    expect(row.sourceCode).toBe('BAMAA');
    expect(row.resolvedVia).toBeNull(); // still unmapped — location is known independent of mapping
    expect(row.sourceRegion).toBe('Dar es Salaam');
    expect(row.sourceDistrict).toBe('Ilala');
  });

  it('leaves sourceRegion/sourceDistrict null when no facilities row matches the code (the common case)', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Kibondo', 148]]);

    const [row] = await resolveObservedFacilities(deps);

    expect(row.sourceRegion).toBeNull();
    expect(row.sourceDistrict).toBeNull();
  });

  // The disambiguation case: two of DISA's five identically-displayed "Aga Khan" codes, each
  // carrying its OWN Organization/address, must resolve to their OWN, distinct locations.
  it('distinguishes two facilities sharing a display but differing in district', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BAMAA', 12]], { performerDisplay: 'Aga Khan' });
    await seedPerformers(deps, [['BBFAF', 5]], { performerDisplay: 'Aga Khan' });
    await deps.externalDb.insertInto('facilities').values([
      { id: 'facility-BAMAA', facility_code: 'BAMAA', facility_name: 'Aga Khan', region: 'Dar es Salaam', district: 'Ilala', source_system: 'webhook-ingest' },
      { id: 'facility-BBFAF', facility_code: 'BBFAF', facility_name: 'Aga Khan', region: 'Dar es Salaam', district: 'Kinondoni', source_system: 'webhook-ingest' },
    ] as never).execute();

    const rows = await resolveObservedFacilities(deps);
    const bamaa = rows.find((r) => r.sourceCode === 'BAMAA')!;
    const bbfaf = rows.find((r) => r.sourceCode === 'BBFAF')!;

    expect(bamaa.sourceDistrict).toBe('Ilala');
    expect(bbfaf.sourceDistrict).toBe('Kinondoni');
    expect(bamaa.sourceDistrict).not.toBe(bbfaf.sourceDistrict);
  });

  // ⛔ The join is scoped by (facility_code, source_system) TOGETHER, "within the same source
  // system" — a `facilities` row belonging to one feed must never be attributed to another feed's
  // report just because the bare code matches. Two feeds independently reporting a code named
  // "BAMAA" are not necessarily the same facility.
  it('does not leak a facilities row into a different feed reporting the same code', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BAMAA', 12]], { sourceSystem: 'webhook-ingest', performerDisplay: 'Aga Khan' });
    await seedPerformers(deps, [['BAMAA', 3]], { sourceSystem: 'cdr-import', performerDisplay: 'Aga Khan' });
    // Only the webhook-ingest feed has a facilities row for BAMAA.
    await deps.externalDb.insertInto('facilities').values({
      id: 'facility-BAMAA', facility_code: 'BAMAA', facility_name: 'Aga Khan',
      region: 'Dar es Salaam', district: 'Ilala', source_system: 'webhook-ingest',
    } as never).execute();

    const rows = await resolveObservedFacilities(deps);
    const webhookRow = rows.find((r) => r.sourceCode === 'BAMAA' && r.sourceSystem === 'webhook-ingest')!;
    const cdrRow = rows.find((r) => r.sourceCode === 'BAMAA' && r.sourceSystem === 'cdr-import')!;

    expect(webhookRow.sourceDistrict).toBe('Ilala');
    expect(cdrRow.sourceDistrict).toBeNull();
  });
});

// Code-review finding (Fix 2, facility-mapping-targets round 1): `nonFacilityTarget`'s exclusivity
// with `resolvedVia`/`targetMissing` holds inside `resolveObservedFacilities` today only because of
// how the three fields happen to be derived together — nothing stops a future edit (or a hand-built
// fixture) from emitting a contradictory row (e.g. `nonFacilityTarget: true` alongside
// `resolvedVia: 'registry'`), which is meaningless by the field's own doc comment. A full status
// union was judged too wide a refactor for this branch; this pins the cheap alternative — the
// producer asserts the invariant itself, so a future break fails loudly instead of silently
// emitting nonsense.
describe('assertResolvedFacilityInvariant', () => {
  it('throws when nonFacilityTarget is claimed alongside a resolved facility route', () => {
    expect(() => assertResolvedFacilityInvariant({
      resolvedVia: 'registry',
      targetMissing: false,
      nonFacilityTarget: true,
    })).toThrow();
  });

  it('throws when nonFacilityTarget is claimed alongside targetMissing', () => {
    expect(() => assertResolvedFacilityInvariant({
      resolvedVia: null,
      targetMissing: true,
      nonFacilityTarget: true,
    })).toThrow();
  });

  it('does not throw for the real, mutually-exclusive combinations', () => {
    expect(() => assertResolvedFacilityInvariant({ resolvedVia: 'registry', targetMissing: false, nonFacilityTarget: false })).not.toThrow();
    expect(() => assertResolvedFacilityInvariant({ resolvedVia: null, targetMissing: true, nonFacilityTarget: false })).not.toThrow();
    expect(() => assertResolvedFacilityInvariant({ resolvedVia: null, targetMissing: false, nonFacilityTarget: true })).not.toThrow();
    expect(() => assertResolvedFacilityInvariant({ resolvedVia: null, targetMissing: false, nonFacilityTarget: false })).not.toThrow();
  });
});

// Task 9b: the design says "one coding system per feed", but nothing bound a feed to a system —
// `scanObservedFacilities` grouped by `performer` alone (no `source_system` split) and
// `resolveObservedFacilities` looked up mappings with a single `from_system`, so two feeds sending
// the SAME observed code resolved through the same mapping. See the task brief's concrete example:
// two LIS feeds both send `NHL-01` meaning different laboratories.
describe('Task 9b: feed-aware scan/resolve', () => {
  it('resolves the same observed code from two different feeds to two different facilities', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-a' });
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-b' });
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    await seedRegistry(deps, { id: 'fac-a', name: 'Alpha Laboratory', localCode: 'ALPHA' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Beta Laboratory', localCode: 'BETA' });
    await seedMapping(deps, {
      fromSystem: observedSystemForFeed('feed-a'), fromCode: 'NHL-01',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'ALPHA',
    });
    await seedMapping(deps, {
      fromSystem: observedSystemForFeed('feed-b'), fromCode: 'NHL-01',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'BETA',
    });

    const resolved = await resolveObservedFacilities(deps);

    const rowA = resolved.find((r) => r.sourceSystem === 'feed-a');
    const rowB = resolved.find((r) => r.sourceSystem === 'feed-b');
    expect(rowA?.name).toBe('Alpha Laboratory');
    expect(rowB?.name).toBe('Beta Laboratory');
  });

  // No regression for today's live data: the one existing feed (`webhook-ingest`) must keep
  // resolving through `urn:openldr:default_fac` exactly as it did before Task 9b — the 23 concepts
  // and 2 mappings already live under that system depend on this.
  it('the default feed (webhook-ingest) still resolves through urn:openldr:default_fac', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]); // default sourceSystem: 'webhook-ingest'
    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, {
      fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'Dodoma',
      toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'DOD',
    });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Dodoma Regional Referral Hospital');
    expect(row.resolvedVia).toBe('registry');
  });

  it('scan registers a distinct coding_systems row per distinct feed, plus the default', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]); // default feed: webhook-ingest
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-a' });
    await seedPerformers(deps, [['NHL-01', 1]], { sourceSystem: 'feed-b' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const defaultCs = await deps.admin.codingSystems.getByUrl(DEFAULT_OBSERVED_FACILITY_SYSTEM);
    const feedACs = await deps.admin.codingSystems.getByUrl(observedSystemForFeed('feed-a'));
    const feedBCs = await deps.admin.codingSystems.getByUrl(observedSystemForFeed('feed-b'));
    expect(defaultCs).not.toBeNull();
    expect(feedACs).not.toBeNull();
    expect(feedBCs).not.toBeNull();
    expect(feedACs!.systemCode).not.toBe(feedBCs!.systemCode);
    expect(feedACs!.systemCode).not.toBe(defaultCs!.systemCode);
    expect(defaultCs!.active).toBe(true);
    expect(feedACs!.active).toBe(true);
    expect(feedBCs!.active).toBe(true);

    // Each feed's concept lives under ITS OWN system, not lumped into the default.
    const { rows: feedARows } = await deps.admin.terms.search(observedSystemForFeed('feed-a'), { limit: 10, offset: 0 });
    const { rows: feedBRows } = await deps.admin.terms.search(observedSystemForFeed('feed-b'), { limit: 10, offset: 0 });
    expect(feedARows.map((r) => r.code)).toEqual(['NHL-01']);
    expect(feedBRows.map((r) => r.code)).toEqual(['NHL-01']);
  });
});

// `DisaGlobal.dbo.LOCNDIC4` holds five distinct facility codes (BAMAA/BBFAF/CDABE/EAFAE/NDFAM)
// whose DESCRIPTION is all exactly 'Aga Khan'. The wire now carries the code on
// `performer[0].identifier.value` (projected onto `diagnostic_reports.performer`, the match key)
// and the shared name on `performer[0].display` (projected onto `performer_display`). Scan/resolve
// must key everything off `performer` (already distinct per code) and use `performer_display` only
// as a LABEL — never let it collapse two codes into one concept.
describe('facility identifier: performer_display and performer_system', () => {
  it('two facility codes sharing the same performer_display produce two distinct, separately-mappable concepts', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BAMAA', 3]], { performerDisplay: 'Aga Khan' });
    await seedPerformers(deps, [['CDABE', 2]], { performerDisplay: 'Aga Khan' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const { rows } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 50, offset: 0 });
    const bamaa = rows.find((r) => r.code === 'BAMAA');
    const cdabe = rows.find((r) => r.code === 'CDABE');
    expect(bamaa).toBeDefined();
    expect(cdabe).toBeDefined();
    expect(bamaa!.display).toBe('Aga Khan');
    expect(cdabe!.display).toBe('Aga Khan');

    // Map each code to its OWN facility — this is the entire point: the shared display must not
    // stop the two codes from resolving to two different places.
    await seedRegistry(deps, { id: 'fac-dar', name: 'Aga Khan Hospital, Dar es Salaam', localCode: 'BAMAA' });
    await seedRegistry(deps, { id: 'fac-dodoma', name: 'Aga Khan Hospital, Dodoma', localCode: 'CDABE' });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BAMAA', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'BAMAA' });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'CDABE', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'CDABE' });

    const resolved = await resolveObservedFacilities(deps);
    const rowBamaa = resolved.find((r) => r.sourceCode === 'BAMAA');
    const rowCdabe = resolved.find((r) => r.sourceCode === 'CDABE');
    expect(rowBamaa?.name).toBe('Aga Khan Hospital, Dar es Salaam');
    expect(rowCdabe?.name).toBe('Aga Khan Hospital, Dodoma');
    expect(rowBamaa?.name).not.toBe(rowCdabe?.name);
  });

  it('scan seeds a new concept from performer_display, not the bare code', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BAMAA', 1]], { performerDisplay: 'Aga Khan' });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const { rows } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('BAMAA');
    expect(rows[0].display).toBe('Aga Khan');
  });

  it('scan falls back to the bare code as display when performer_display is absent', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]); // no performerDisplay

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const { rows } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 10, offset: 0 });
    expect(rows[0].display).toBe('Dodoma');
  });

  // The wire is more authoritative than our own source_system-based inference — a sender that
  // supplies `identifier.system` gets its concept registered under THAT system, not the one
  // `observedSystemForFeed(source_system)` would have derived.
  it('scan prefers the wire-supplied performer_system over the source_system-derived default', async () => {
    const deps = await makeReconcileDeps();
    const wireSystem = 'urn:openldr:cdr:LOCNDIC4';
    await seedPerformers(deps, [['BAMAA', 1]], { sourceSystem: 'webhook-ingest', performerSystem: wireSystem });

    await scanObservedFacilities(deps, { now: '2026-08-05T00:00:00.000Z', apply: true });

    const wireCs = await deps.admin.codingSystems.getByUrl(wireSystem);
    expect(wireCs).not.toBeNull();
    expect(wireCs!.active).toBe(true);
    const { rows: wireRows } = await deps.admin.terms.search(wireSystem, { limit: 10, offset: 0 });
    expect(wireRows.map((r) => r.code)).toEqual(['BAMAA']);
    // Must NOT have landed under the source_system-derived default instead.
    const { rows: defaultRows } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 10, offset: 0 });
    expect(defaultRows).toHaveLength(0);
  });

  // resolveObservedFacilities must derive its lookup system the SAME way scan derived the registration
  // system, or a mapping authored under the wire's system is never found.
  it('resolveObservedFacilities looks up a mapping under the wire-supplied performer_system', async () => {
    const deps = await makeReconcileDeps();
    const wireSystem = 'urn:openldr:cdr:LOCNDIC4';
    await seedPerformers(deps, [['BAMAA', 1]], { performerSystem: wireSystem });
    await seedRegistry(deps, { id: 'fac-1', name: 'Aga Khan Hospital, Dar es Salaam', localCode: 'BAMAA' });
    await seedMapping(deps, { fromSystem: wireSystem, fromCode: 'BAMAA', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'BAMAA' });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Aga Khan Hospital, Dar es Salaam');
    expect(row.resolvedVia).toBe('registry');
  });

  it('falls back to observedSystemForFeed(source_system) when performer_system is absent', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['Dodoma', 1]]); // no performerSystem -> default feed system
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'Dodoma', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'DOD' });

    const [row] = await resolveObservedFacilities(deps);

    expect(row.name).toBe('Dodoma Regional Referral Hospital');
  });
});

// Review finding (whole-branch review): `resolveObservedFacilities` groups its warehouse SQL by all
// FOUR of (performer, performer_display, performer_system, source_system), then used to return one
// `ResolvedFacility` per raw SQL group — so a `(performer, source_system)` pair that ever reported
// with a differing `performer_display` or `performer_system` produced MULTIPLE rows for the same
// logical facility code. Reachable, not theoretical: a mid-rollout CDR identifier-fix cutover, or a
// corrected `LOCNDIC4.DESCRIPTION`, both produce exactly this shape. Fixed by folding the raw groups
// down to one row per (resolved system, code) — mirroring `scanObservedFacilities`'s `bySystem`/
// `displayByKey` fold.
describe('resolveObservedFacilities dedupes multiple raw groups for the same logical facility', () => {
  it('two rows sharing (performer, source_system) but disagreeing on performer_display fold to ONE row, with the representative display backed by the most reports', async () => {
    const deps = await makeReconcileDeps();
    // Same performer + same (default) source_system, differing ONLY in performer_display — the
    // renamed-facility case. The second call carries more reports, so it must win the display.
    await seedPerformers(deps, [['BAMAA', 3]], { performerDisplay: 'Aga Khan (old)' });
    await seedPerformers(deps, [['BAMAA', 5]], { performerDisplay: 'Aga Khan (new)' });

    const resolved = await resolveObservedFacilities(deps);

    const rows = resolved.filter((r) => r.sourceCode === 'BAMAA');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceDisplay).toBe('Aga Khan (new)');
  });

  it('two rows sharing (performer, source_system) but with genuinely different performer_system stay as TWO separate rows', async () => {
    const deps = await makeReconcileDeps();
    // Same performer code and same source_system, but a different WIRE-supplied coding system on
    // each — these are different facilities under Task 9b's per-feed system model, and folding them
    // together would silently re-merge exactly what that work exists to keep apart.
    await seedPerformers(deps, [['BAMAA', 1]], { performerSystem: 'urn:openldr:cdr:LOCNDIC4-a' });
    await seedPerformers(deps, [['BAMAA', 1]], { performerSystem: 'urn:openldr:cdr:LOCNDIC4-b' });

    const resolved = await resolveObservedFacilities(deps);

    const rows = resolved.filter((r) => r.sourceCode === 'BAMAA');
    expect(rows).toHaveLength(2);
  });

  // Task 11 (whole-branch review round 2, Fix 1): two feeds can share the SAME wire-supplied
  // `performer_system` while differing in `source_system` — the same facility namespace ingested
  // through two feeds (e.g. a webhook feed and a CDR-import feed both sending LOCNDIC4 identifiers).
  // These fold into ONE `ResolvedFacility` (same resolved system, same code), and that folded row
  // must report the SUM of every raw group's reports, not merely the winning representative's count
  // — the representative-display rule (above) picks a WINNER for `sourceDisplay`/`sourceSystem`, but
  // `reportCount` is a warehouse aggregate that must never drop a feed's contribution just because
  // that feed's row lost the display tiebreak.
  it('two feeds sharing a wire performer_system but differing source_system report the SUMMED count, not just the winning representative\'s', async () => {
    const deps = await makeReconcileDeps();
    const wireSystem = 'urn:openldr:cdr:LOCNDIC4';
    await seedPerformers(deps, [['NHL-01', 3]], { sourceSystem: 'feed-a', performerSystem: wireSystem });
    await seedPerformers(deps, [['NHL-01', 5]], { sourceSystem: 'feed-b', performerSystem: wireSystem });

    const resolved = await resolveObservedFacilities(deps);

    const rows = resolved.filter((r) => r.sourceCode === 'NHL-01');
    expect(rows).toHaveLength(1); // same wire system -> same (system, code) fold key -> ONE row
    expect(rows[0].reportCount).toBe(8); // 3 + 5 summed, not just feed-b's winning 5
  });
});

// Task 11 (whole-branch review round 2, Fix 2): the representative-display rule's FIRST tier (a
// non-null display always beats a null one, regardless of report count) had no dedicated test — every
// existing case in the block above varies count and "has a display" together, so a mutation flipping
// `replace = candidateHasDisplay` to `replace = !candidateHasDisplay` passed unnoticed. This isolates
// the first tier: the row WITH a display must win even though it backs FEWER reports.
describe('resolveObservedFacilities representative-display rule: non-null beats null regardless of report count', () => {
  it('a row with a display wins over a sibling with more reports but no display', async () => {
    const deps = await makeReconcileDeps();
    // Same performer + same (default) source_system + same (default, absent performer_system)
    // resolved system, so both fold into one key. The row WITH a display backs FEWER reports (1)
    // than the row WITHOUT one (10) — if the display-priority tier were broken (or removed, falling
    // through to the report-count tier), the no-display row would win instead.
    await seedPerformers(deps, [['BAMAAX', 1]], { performerDisplay: 'Aga Khan Hospital' });
    await seedPerformers(deps, [['BAMAAX', 10]]);

    const resolved = await resolveObservedFacilities(deps);

    const rows = resolved.filter((r) => r.sourceCode === 'BAMAAX');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceDisplay).toBe('Aga Khan Hospital');
    expect(rows[0].reportCount).toBe(11); // both rows' reports still summed regardless of who wins display
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
      toSystem: 'urn:openldr:cs:facility-registry', toCode: 'DOD',
    });

    const first = await publishFacilityMap(deps, { apply: true });
    const second = await publishFacilityMap(deps, { apply: true });

    expect(first).toMatchObject({ resolved: 1, unmapped: 1, written: 2 });
    expect(second).toEqual(first);
    const rows = await deps.externalDb.selectFrom('facility_map').selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source_code === 'Dodoma')!.name).toBe('Dodoma Regional Referral Hospital');
    expect(rows.find((r) => r.source_code === 'Dodoma')!.local_code).toBe('DOD');
    expect(rows.find((r) => r.source_code === 'Kibondo')!.name).toBeNull();
    expect(rows.find((r) => r.source_code === 'Kibondo')!.local_code).toBeNull();
  });

  // Task 11 (whole-branch review, Fix 3): `scanObservedFacilities` folds `(performer, source_system)`
  // groups that derive the SAME coding system into one `(system, code)` total. Originally
  // `resolveObservedFacilities` (and therefore this function) mapped 1:1 over the raw groups instead,
  // so a warehouse holding BOTH a NULL and an empty-string `source_system` for the same performer
  // produced two resolved rows with an identical `facilityMapId` (both normalise `sourceSystem` to
  // `''`) — before that fix, the delete-then-insert transaction below aborted on the primary key.
  //
  // Whole-branch review fix round 1: `resolveObservedFacilities` itself now folds its raw SQL groups
  // down to one row per (resolved system, code) — see its doc comment — so NULL and `''`
  // `source_system` (both deriving the SAME default system, since neither carries a `performer_system`
  // here) are folded together BEFORE `publishFacilityMap` ever sees them. `result.written` therefore
  // drops from 2 to 1: the PK collision this test guards against is now structurally prevented one
  // layer up, not merely tolerated. Fix 3's dedupe-by-id below is retained regardless (see its own
  // comment) — it remains the only defense against a DIFFERENT collision shape: two rows that resolve
  // to genuinely different systems (so `resolveObservedFacilities` correctly keeps them separate) but
  // happen to share the same raw `sourceSystem`/`sourceCode` pair `facilityMapId` is built from.
  it('does not crash on a PK collision from a NULL and empty-string source_system for the same performer', async () => {
    const deps = await makeReconcileDeps();
    await deps.externalDb.insertInto('diagnostic_reports')
      .values([
        { id: 'dr-null-1', performer: 'Dodoma', source_system: null },
        { id: 'dr-empty-1', performer: 'Dodoma', source_system: '' },
      ] as never)
      .execute();

    const result = await publishFacilityMap(deps, { apply: true });

    expect(result.written).toBe(1);
    const rows = await deps.externalDb.selectFrom('facility_map').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].source_code).toBe('Dodoma');
    expect(rows[0].source_system).toBe('');
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
    // Operator-facing codes, not the rows' opaque ids: local_code when present, else national_code.
    expect(rows.map((r) => ({ code: r.code, display: r.display })).sort((a, b) => a.code.localeCompare(b.code)))
      .toEqual([
        { code: 'DOD', display: 'Dodoma Regional Referral Hospital' },
        { code: 'TZ-001', display: 'Muhimbili National Hospital' },
      ]);
  });

  // ⛔ THE load-bearing collision test at this level: local_code is globally unique and
  // (national_system, national_code) is only unique as a pair, so nothing stops row A's local_code
  // equalling row B's national_code. publishRegistryConcepts sees the WHOLE registry in one call, so
  // it must catch this itself (no DB lookup needed — see registryConceptRows' doc comment).
  it('falls back to id for a colliding pair, so the two stay distinct concepts', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-collide-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-collide-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });

    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-collide-a', 'fac-collide-b']);
  });

  // Task 8: Publish now runs the reprojection, so its result is the ONE operator-facing summary the
  // reprojection outcome reaches. A moved code is a real event (an operator's mapping was silently
  // repointed underneath them), and `carryOverSkipped` is the case where the repair was deliberately
  // REFUSED — both must be countable, not just logged.
  //
  // ⚠ `carryOverSkipped` is 0 BY CONSTRUCTION from this path, and that is worth stating rather than
  // mistaking for coverage: the guard fires only when the old code is linked by a facility OUTSIDE
  // the batch, and this path's batch IS the whole registry (`facility_concept_projection.registry_id`
  // is an ON DELETE CASCADE foreign key, so an orphaned link cannot outlive its facility either).
  // Only the given-rows path can reach a non-zero value. It is still reported here so that a future
  // change narrowing this path's batch cannot silently drop the signal.
  it('reports how many facility codes moved, and how many mapping carry-overs were skipped', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Alpha', localCode: 'OLD-1' });

    const first = await publishRegistryConcepts(deps, { apply: true });
    expect(first).toEqual({ concepts: 1, systemRegistered: true, codeChanges: 0, carryOverSkipped: 0 });

    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-1').execute();
    const second = await publishRegistryConcepts(deps, { apply: true });

    expect(second).toEqual({ concepts: 1, systemRegistered: true, codeChanges: 1, carryOverSkipped: 0 });
    expect(await currentConceptCode(deps, 'fac-1')).toBe('NEW-1');
  });

  it('registers an ACTIVE coding_systems row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishRegistryConcepts(deps, { apply: true });

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  // ⛔ PINS `publishRegistryConcepts`' OWN `ensureRegistrySystemActive` CALL, which looks redundant
  // (the delegation to `reprojectRegistryRows` calls it too) and is not: `reprojectRegistryRows`
  // returns early on an EMPTY batch, so an empty registry never reaches it. A fresh install with no
  // facilities yet must still end up with a pickable registry system, because `TermMappingDialog`
  // builds its target-system dropdown from `coding_systems`. Deleting the call left every other test
  // in this file green, so this one exists specifically so the next reader does not remove it.
  //
  // The seeded row (migration 075) is dropped first: with it in place ANY assertion about the system
  // existing passes without this path writing anything at all, which is exactly the vacuous test this
  // is not allowed to be. Dropping it also covers the real pre-075 install that never got the seed.
  it('registers the coding system on an EMPTY registry, which the delegation never reaches', async () => {
    const deps = await makeReconcileDeps();
    await deps.internalDb.deleteFrom('coding_systems').where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM)).toBeNull();

    const result = await publishRegistryConcepts(deps, { apply: true });

    expect(result.concepts).toBe(0);
    const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
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
    // Migration 075 seeds the coding_systems row unconditionally now, so its presence is no longer
    // evidence that publishRegistryConcepts ran — assert it is UNCHANGED rather than absent.
    const before = await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry');

    await publishRegistryConcepts(deps, {});

    const { rows } = await deps.admin.terms.search('urn:openldr:cs:facility-registry', { limit: 10, offset: 0 });
    expect(rows).toHaveLength(0);
    expect(await deps.admin.codingSystems.getByUrl('urn:openldr:cs:facility-registry')).toEqual(before);
  });

  // The defect commit 0518e7d3 introduced: it moved the concept key off `facility_registry.id` onto
  // the operator-facing code, but projection is upsert-only, so a concept written under the OLD
  // id-keyed scheme is left behind — the same facility shows twice in the mapping picker. Simulates
  // that pre-existing legacy state directly (importRows, not publish, since publish never wrote the
  // id-keyed shape to begin with), then proves a re-publish leaves exactly ONE concept, keyed on the
  // preferred code — a count-only assertion would pass if the wrong one survived.
  it('drops a superseded id-keyed concept on re-publish, leaving exactly one concept keyed on the preferred code', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    // The legacy projection this facility would have had before 0518e7d3.
    await deps.admin.terms.importRows([
      { system: FACILITY_REGISTRY_SYSTEM, code: 'fac-1', display: 'National Public Health Laboratory', status: 'ACTIVE', properties: null },
    ]);

    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('111317-4');
  });

  // The collision-fallback case: fac-a's local_code collides with fac-b's national_code, so BOTH
  // rows' preferred code legitimately falls back to their own id (the CHECK constraint makes "both
  // code columns null" impossible for a real row, so this is the only way a row's live concept is
  // genuinely id-keyed). Re-publishing must not delete that id-keyed concept — it is the row's ONLY
  // concept, not a superseded leftover.
  it('keeps an id-keyed concept that legitimately IS the preferred code (collision fallback)', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });
    await publishRegistryConcepts(deps, { apply: true });

    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
  });

  // A genuinely deleted facility (no `facility_registry` row at all, not merely absent from this
  // call's visibility) must keep its concept — this is the existing "never prune" behaviour and it
  // must stay unchanged. `publishRegistryConcepts` only ever considers deleting a concept keyed on a
  // row it is CURRENTLY projecting; a row that no longer exists is never in that set.
  it('does not delete a concept for a facility no longer in facility_registry', async () => {
    const deps = await makeReconcileDeps();
    await deps.admin.terms.importRows([
      { system: FACILITY_REGISTRY_SYSTEM, code: 'fac-ghost', display: 'Deleted Facility', status: 'ACTIVE', properties: null },
    ]);
    await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

    await publishRegistryConcepts(deps, { apply: true });

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['DOD', 'fac-ghost']);
  });

  // Migration 075 seeds the row directly, ahead of any scan/publish — fixes the fresh-install defect
  // where `TermMappingDialog`'s target-system dropdown had nothing to pick until an operator ran a
  // publish. Asserted here (not just in `packages/db`) because it is `publishRegistryConcepts`'s
  // downstream idempotency with that seed that this slice is really about.
  describe('fresh-install seed (migration 075)', () => {
    it('is present and ACTIVE before any scan/publish has ever run', async () => {
      const deps = await makeReconcileDeps();

      const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
      expect(cs).not.toBeNull();
      expect(cs!.active).toBe(true);
    });

    it('does NOT seed the observed facility dictionary (urn:openldr:default_fac)', async () => {
      const deps = await makeReconcileDeps();

      expect(await deps.admin.codingSystems.getByUrl(DEFAULT_OBSERVED_FACILITY_SYSTEM)).toBeNull();
    });

    it('publishRegistryConcepts afterwards does not duplicate the seeded row or fight with it', async () => {
      const deps = await makeReconcileDeps();
      const seeded = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
      await seedRegistry(deps, { id: 'fac-1', name: 'Dodoma Regional Referral Hospital', localCode: 'DOD' });

      await publishRegistryConcepts(deps, { apply: true });

      const all = await deps.internalDb.selectFrom('coding_systems')
        .selectAll().where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
      expect(all).toHaveLength(1);
      const after = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
      expect(after!.id).toBe(seeded!.id);
      expect(after!.active).toBe(true);
    });
  });
});

// Fix 1 (mapping-ux report): registering a facility must make it mappable IMMEDIATELY — no operator
// publish step. `publishRegistryConcepts` reprojects the WHOLE registry (fine for an explicit
// operator repair/backfill, unacceptable per-write at 14k-row national-register scale), so the
// create/update/import write paths instead call this given-rows path, which touches only the rows
// handed to it.
describe('projectRegistryRows', () => {
  it('makes the given row pickable as a mapping target, without touching any other registry row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    await seedRegistry(deps, { id: 'fac-2', name: 'Muhimbili National Hospital', nationalSystem: 'urn:tz:hfr', nationalCode: 'TZ-001' });

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    // Only fac-1 was handed in — fac-2 must NOT have been reprojected as a side effect. The code is
    // fac-1's local_code (111317-4), the operator-facing code, not its opaque id — this is exactly
    // the "single-row projection path" case: `rows` supplied only {id, name}, so the function had to
    // go look up fac-1's own local_code itself before it could compute this.
    expect(rows.map((r) => r.code)).toEqual(['111317-4']);
    expect(rows[0].display).toBe('National Public Health Laboratory');
  });

  // THE BATCH WIDENING, which is now the whole of the single-row path's collision protection: `rows`
  // here carries only fac-a's {id, name}, yet the pre-existing fac-b (seeded separately, never
  // mentioned in this call) already claims the SAME candidate code via its national_code.
  // `widenToCollidingRows` pulls fac-b into the batch, and `registryConceptRows`' in-batch check —
  // the ONE collision implementation left — then forces both onto their ids. Remove the widening and
  // this fails outright: fac-a would project as 'X' and MERGE into fac-b's concept.
  //
  // ⚠ Not the "DB-lookup collision guard" it once described. That guard (`collidingRegistryIds`) is
  // gone; it computed a `forceOwnIdFor` set that, once the batch is widened, is always a subset of
  // what the in-batch check already catches, at the cost of running the same full-table query twice.
  // BOTH sides are projected here, and that is the point: leaving fac-b on the shared human code is
  // exactly the disagreement between the two paths that this slice closes.
  it('a single-row call still detects a collision against a DIFFERENT, unmentioned registry row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });

    await projectRegistryRows(deps, [{ id: 'fac-a', name: 'Facility A' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
    expect(await currentConceptCode(deps, 'fac-a')).toBe('fac-a');
  });

  // The symmetric case: projecting fac-b (the LATER-seeded row) alone must also widen to, and force,
  // the earlier, unmentioned fac-a. Same mechanism as above — the widening plus the in-batch check,
  // not a separate lookup.
  it('detects the same collision from the other row\'s side of a single-row call', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });

    await projectRegistryRows(deps, [{ id: 'fac-b', name: 'Facility B' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
    expect(await currentConceptCode(deps, 'fac-b')).toBe('fac-b');
  });

  // A CSV import batch calls this with MULTIPLE just-written rows at once — the given-rows path must
  // catch a collision between two rows in the SAME call too, not only against pre-existing rows.
  it('a multi-row call detects a collision between two rows in the SAME batch', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });

    await projectRegistryRows(deps, [
      { id: 'fac-a', name: 'Facility A' },
      { id: 'fac-b', name: 'Facility B' },
    ]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
  });

  // ⛔ THE TASK-8 EQUIVALENCE TEST. The two projection paths used to disagree about the SAME row:
  // the given-rows path forced only ITS OWN batch onto `id`, leaving the pre-existing colliding
  // facility on the shared human code, while the next full reprojection forced BOTH. So fac-A's code
  // moved as a consequence of a write to fac-B — orphaning anything authored against it, with no
  // record of the move. Asserting the two agree is NOT enough on its own (both paths agreeing on
  // "never projected" would satisfy it vacuously), so the incremental answer is pinned outright first.
  it('the create/update path and the full reprojection agree on a colliding row\'s code', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: '111317-4' });
    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: '111317-4' });
    // The POST /api/facilities call for fac-B ONLY — fac-A is never mentioned by this caller.
    await projectRegistryRows(deps, [{ id: 'fac-B', name: 'Beta' }]);

    const afterIncremental = await currentConceptCode(deps, 'fac-A');
    const conceptsAfterIncremental = (await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 }))
      .rows.map((r) => r.code).sort();
    expect(afterIncremental).toBe('fac-A');
    // No orphaned '111317-4' concept left selectable in the picker either.
    expect(conceptsAfterIncremental).toEqual(['fac-A', 'fac-B']);

    await publishRegistryConcepts(deps, { apply: true });

    expect(await currentConceptCode(deps, 'fac-A')).toBe(afterIncremental);
    expect((await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 }))
      .rows.map((r) => r.code).sort()).toEqual(conceptsAfterIncremental);
  });

  // The operator-visible payoff of widening: the INCUMBENT's mapping has to be carried across the
  // move its neighbour's write caused. Without the widening, fac-A is simply not in the batch, so
  // nothing migrates its mapping — and because `resolveObservedFacilities` re-derives the preferred
  // code over the WHOLE registry, fac-A resolves through 'fac-A' (the collision fallback) the instant
  // fac-B exists, while the mapping still names '111317-4'. The mapping breaks with nobody touching it.
  it('carries an incumbent facility\'s mapping across when a NEW colliding facility is written', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 2]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: '111317-4' });
    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: '111317-4' });

    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: '111317-4' });
    await projectRegistryRows(deps, [{ id: 'fac-B', name: 'Beta' }]);

    const row = (await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!;
    expect(row.registryId).toBe('fac-A');
    expect(row.targetMissing).toBe(false);
  });

  // ⛔ THE OTHER HALF OF THE ACCEPTANCE CRITERION, and the one the first widening missed: a batch row
  // RELEASING a contested code. Alpha and Beta collide on 'X', so BOTH are parked on their ids and
  // the operator's mapping is authored against Beta's id. Renaming ONLY Alpha frees 'X' — Beta is now
  // its sole claimant, so `resolveObservedFacilities` (which re-derives preferred codes over the
  // whole registry) starts resolving Beta through 'X' immediately, while the mapping still names
  // 'fac-B'. Nothing in the acquire-side widening reprojects Beta, so the mapping breaks the moment
  // an UNRELATED facility is edited and stays broken until somebody presses Scan — this task's own
  // failure mode in mirror image.
  //
  // ⚠ Beta cannot be reached from Alpha's new candidate ('Y') NOR from Alpha's previous projected
  // code (which is 'fac-A', the collision fallback — the string 'X' Alpha used to contest is recorded
  // nowhere). The signal that works is that Alpha was PARKED on its own id, i.e. its projection was
  // decided by some other row's code; see `widenToCollidingRows`.
  it('carries an incumbent facility\'s mapping across when the batch RELEASES a contested code', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 2]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });
    await publishRegistryConcepts(deps, { apply: true });
    expect(await currentConceptCode(deps, 'fac-B')).toBe('fac-B');
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'fac-B' });
    // The operator's mapping resolves BEFORE the unrelated edit — otherwise the assertions below
    // would pass vacuously against a mapping that never worked.
    expect((await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!.registryId).toBe('fac-B');

    // PUT /api/facilities/fac-A: only Alpha is renamed, and only Alpha is handed to the projection.
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'Y' }).where('id', '=', 'fac-A').execute();
    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    // Beta followed the freed code at the moment the release actually happened, not on a later Scan.
    expect(await currentConceptCode(deps, 'fac-A')).toBe('Y');
    expect(await currentConceptCode(deps, 'fac-B')).toBe('X');
    const row = (await resolveObservedFacilities(deps)).find((r) => r.sourceCode === 'BALAB')!;
    expect(row.registryId).toBe('fac-B');
    expect(row.targetMissing).toBe(false);
  });

  // The limit of the widening, and the reason it re-asks `registryPreferredCode` in memory instead of
  // widening on the SQL prefilter directly. fac-B carries 'X' in its national_code but PROJECTS as
  // 'Y' (its local_code wins), so it does not collide with fac-A at all. Widening on the loose
  // either-column predicate would drag it into the batch — and, since the widened batch is what the
  // in-batch collision check now reads, that would force BOTH rows onto their UUIDs over a collision
  // that does not exist. `projectRegistryRows` must touch nothing but the rows that genuinely share a
  // projected code.
  it('does not widen to a row that merely carries the code in a NON-preferred column', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', localCode: 'Y', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });

    await projectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['X']);
    expect(await currentConceptCode(deps, 'fac-B')).toBeNull();
  });

  it('registers an ACTIVE coding_systems row', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const cs = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  // Mirrors publishRegistryConcepts's own re-activation regression guard above.
  it('re-activates a coding_systems row an operator (or an earlier bug) left inactive', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    await deps.internalDb.updateTable('coding_systems').set({ active: false })
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    expect((await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM))!.active).toBe(true);
  });

  // Same defect as `publishRegistryConcepts`'s equivalent test above, exercised through the
  // given-rows write-time path instead of the full reprojection — the two paths must not drift on
  // this behaviour. A count-only assertion would pass if the wrong concept survived, so this also
  // pins the code.
  it('drops a superseded id-keyed concept, leaving exactly one concept keyed on the preferred code', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    await deps.admin.terms.importRows([
      { system: FACILITY_REGISTRY_SYSTEM, code: 'fac-1', display: 'National Public Health Laboratory', status: 'ACTIVE', properties: null },
    ]);

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('111317-4');
  });

  // The whole point of the `RETURNING code`-gated fix: `registryRowIdsWithSupersededIdConcept` names
  // fac-1 as a candidate on EVERY call (its preferred code, `111317-4`, is permanently different from
  // its own id) even once there is no legacy id-keyed concept left to delete — this is steady state,
  // i.e. every facility save after the first. `deleteSupersededIdConcepts` must not pay for the
  // `term_mappings` lookup on a `DELETE` that matched zero rows. Spies on `selectFrom` rather than on
  // a specific store method because `term_mappings` is queried with a raw Kysely builder, not through
  // `admin` — a table-name assertion is the only vantage point that would actually fail if the
  // gating regressed back to running unconditionally.
  it('does not query term_mappings when the delete matches nothing (steady-state hot path)', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    // First save: fac-1 has never had an id-keyed concept, so this already exercises the zero-rows
    // delete path once and establishes steady state.
    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const selectFromSpy = vi.spyOn(deps.internalDb, 'selectFrom');

    // Second save (e.g. an operator edits the facility's name) — the hot path this finding is about.
    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const queriedTables = selectFromSpy.mock.calls.map((args) => args[0]);
    expect(queriedTables).not.toContain('term_mappings');
  });

  // The other side of the same fix: when the delete DOES remove a real legacy id-keyed concept, the
  // `term_mappings` lookup must still run and warn about a mapping authored against the code being
  // removed — the gate must skip the zero-rows case without silencing the genuine one.
  it('still warns about a term_mappings row referencing a concept the delete actually removed', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });
    await deps.admin.terms.importRows([
      { system: FACILITY_REGISTRY_SYSTEM, code: 'fac-1', display: 'National Public Health Laboratory', status: 'ACTIVE', properties: null },
    ]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'NPHL', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'fac-1' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain(`(${DEFAULT_OBSERVED_FACILITY_SYSTEM}, NPHL) -> ${FACILITY_REGISTRY_SYSTEM}/fac-1`);
    // Reworded per code review: the delete surfaces a pre-existing break, it does not cause one.
    expect(message).not.toMatch(/will resolve as target missing/);
    warnSpy.mockRestore();
  });

  // The collision-fallback case, through the given-rows path: fac-a and fac-b collide (fac-a's
  // local_code equals fac-b's national_code), so both legitimately keep an id-keyed concept. Project
  // fac-a alone (mirroring a single facility's own create/update write) and confirm fac-b's
  // unrelated, already-id-keyed concept is untouched.
  it('keeps an id-keyed concept that legitimately IS the preferred code (collision fallback)', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-a', name: 'Facility A', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-b', name: 'Facility B', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });
    await projectRegistryRows(deps, [{ id: 'fac-a', name: 'Facility A' }, { id: 'fac-b', name: 'Facility B' }]);

    await projectRegistryRows(deps, [{ id: 'fac-a', name: 'Facility A' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['fac-a', 'fac-b']);
  });

  // A genuinely deleted facility keeps its concept — `projectRegistryRows` only ever considers
  // deleting a concept keyed on a row it was actually HANDED, never anything outside `rows`.
  it('does not delete a concept for a facility no longer in facility_registry', async () => {
    const deps = await makeReconcileDeps();
    await deps.admin.terms.importRows([
      { system: FACILITY_REGISTRY_SYSTEM, code: 'fac-ghost', display: 'Deleted Facility', status: 'ACTIVE', properties: null },
    ]);
    await seedRegistry(deps, { id: 'fac-1', name: 'National Public Health Laboratory', localCode: '111317-4' });

    await projectRegistryRows(deps, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]);

    const { rows } = await deps.admin.terms.search(FACILITY_REGISTRY_SYSTEM, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['111317-4', 'fac-ghost']);
  });

  it('is a no-op for an empty rows array', async () => {
    const deps = await makeReconcileDeps();
    const before = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);

    await projectRegistryRows(deps, []);

    expect(await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM)).toEqual(before);
  });

  // ⛔ Must NEVER throw: a facility save (or a CSV import) must succeed even when the projection
  // fails, mirroring `registerObservedSystem`'s containment on the ingest hot path.
  it('swallows a projection failure instead of throwing', async () => {
    const deps = await makeReconcileDeps();
    const failingAdmin = {
      ...deps.admin,
      terms: {
        ...deps.admin.terms,
        importRows: async () => { throw new Error('simulated terminology store failure'); },
      },
    };

    await expect(
      projectRegistryRows({ ...deps, admin: failingAdmin }, [{ id: 'fac-1', name: 'National Public Health Laboratory' }]),
    ).resolves.toBeUndefined();
  });
});

// The mapping-migration layer. A facility's concept code is DERIVED (local_code, else
// national_code, else its own id on a collision), so it can move without anyone editing that
// facility — and `term_mappings` rows an operator authored against the old code have to be carried
// across the move or they silently stop resolving.
describe('reprojectRegistryRows', () => {
  // ⛔ THE ANCHOR. The audit's FAC-P0-04, sharpened: nobody edits Alpha, yet importing an unrelated
  // facility whose national_code happens to equal Alpha's local_code makes BOTH rows fall back to
  // their UUIDs on the next full reprojection — so Alpha's concept code moves off '111317-4', the
  // mapping authored against '111317-4' points at nothing, and (because the concept write is
  // upsert-only) the orphaned '111317-4' concept stays selectable in the picker.
  //
  // Driven through `publishRegistryConcepts` — the operator pressing Publish — because Task 8 routes
  // that path through `reprojectRegistryRows`. (Before Task 8 it could not be: Publish exercised the
  // old, non-migrating projection, so this test drove `reprojectRegistryRows` directly as a
  // stand-in.) Driving the real entry point is what makes the anchor pin the operator's journey
  // rather than an internal function's contract.
  it('ANCHOR: an unrelated facility colliding on a code does not orphan an existing mapping', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 3]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: '111317-4' });
    await publishRegistryConcepts(deps, { apply: true });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: '111317-4' });

    // The unrelated import. Alpha is untouched; Beta merely claims the same string as a NATIONAL
    // code, which is legal (local_code and (national_system, national_code) are separately unique).
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta Clinic', nationalSystem: 'urn:tz:hfr', nationalCode: '111317-4' });
    await publishRegistryConcepts(deps, { apply: true });

    const resolved = await resolveObservedFacilities(deps);
    const row = resolved.find((r) => r.sourceCode === 'BALAB')!;
    expect(row.registryId).toBe('fac-A');
    expect(row.targetMissing).toBe(false);
  });

  it('follows a local_code rename on a facility that already has a mapping', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OLD-1' });

    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    expect(r.codeChanges).toEqual([{ registryId: 'fac-A', from: 'OLD-1', to: 'NEW-1', mappingsMigrated: 1, carryOverSkipped: false }]);
    const resolved = await resolveObservedFacilities(deps);
    expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
  });

  // The upsert-only write is what leaves the ghost: nothing removes the concept a facility USED to
  // project as, so it stays in the mapping picker, selectable, pointing at a code no facility
  // resolves through any more.
  it('leaves no ghost concept behind after a code change', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    const codes = await deps.internalDb.selectFrom('terminology_concepts')
      .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(codes.map((c) => c.code)).toEqual(['NEW-1']);
  });

  // ⛔ Proves the rewrite went through `admin.termMappings.update` and not a raw
  // `UPDATE term_mappings`. `term_mappings` is authoritative and `concept_map_elements` is its
  // mirror; a direct UPDATE would leave this mirror row still pointing at 'OLD-1' (and would skip
  // `reference_change_log` capture), which no assertion on `term_mappings` alone would catch.
  it('mirrors the migrated mapping into concept_map_elements', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OLD-1' });

    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    const mirror = await deps.internalDb.selectFrom('concept_map_elements')
      .select(['target_code']).where('target_system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(mirror.map((m) => m.target_code)).toEqual(['NEW-1']);
  });

  // The move runs BOTH ways. Deleting the colliding facility releases the human code, so the
  // survivor stops falling back to its UUID — and the mapping authored against that UUID has to
  // follow it back, or resolving an operator's collision silently breaks their mapping.
  //
  // Also driven through `publishRegistryConcepts`, for the same reason as the anchor above: deleting
  // a facility is not itself a projection event, so the real journey is "operator deletes the
  // duplicate, then presses Publish".
  it('follows the code back when a collision is resolved by deleting the other facility', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: '111317-4' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', nationalSystem: 'urn:tz:hfr', nationalCode: '111317-4' });
    await publishRegistryConcepts(deps, { apply: true });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'fac-A' });

    await deps.internalDb.deleteFrom('facility_registry').where('id', '=', 'fac-B').execute();
    await publishRegistryConcepts(deps, { apply: true });

    expect(await currentConceptCode(deps, 'fac-A')).toBe('111317-4');
    const resolved = await resolveObservedFacilities(deps);
    expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
  });

  // ⛔ The delete of the OLD concept must never remove a code some OTHER row is projecting as RIGHT
  // NOW. An operator renaming Alpha and handing its old code to a brand-new facility in the same
  // import is the realistic version: an unguarded "delete whatever `from` was" would wipe the
  // concept `importRows` had just written for Beta, making a live facility unpickable.
  it('does not delete an old code another facility in the same batch has just taken over', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'X' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'X' });

    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'Y' }).where('id', '=', 'fac-A').execute();
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', localCode: 'X' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);

    const codes = await deps.internalDb.selectFrom('terminology_concepts')
      .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(codes.map((c) => c.code).sort()).toEqual(['X', 'Y']);
    // And the mapping still followed ALPHA, not the code — it was authored when 'X' meant Alpha.
    const resolved = await resolveObservedFacilities(deps);
    expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
  });

  // ⛔ `facility_concept_projection.registry_id` is a FOREIGN KEY, and `rows` is whatever the caller
  // handed in — a facility deleted between the caller's own read and this call is not hypothetical
  // (the CSV importer and the delete route both write before projecting). Linking a row that no
  // longer exists would throw and lose the projection for every legitimate row in the same batch.
  it('projects a batch containing a facility that no longer exists without failing the whole batch', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'A-1' });

    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-gone', name: 'Deleted' }]);

    expect(r.projected).toBe(2);
    expect(await currentConceptCode(deps, 'fac-A')).toBe('A-1');
    expect(await currentConceptCode(deps, 'fac-gone')).toBeNull();
  });

  it('is a no-op for an empty rows array', async () => {
    const deps = await makeReconcileDeps();
    const before = await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM);

    expect(await reprojectRegistryRows(deps, [])).toEqual({ projected: 0, codeChanges: [] });

    expect(await deps.admin.codingSystems.getByUrl(FACILITY_REGISTRY_SYSTEM)).toEqual(before);
    expect(await deps.internalDb.selectFrom('facility_concept_projection').selectAll().execute()).toEqual([]);
  });

  // ⛔ COLLISION IS ABOUT PREFERRED CODES, NOT ABOUT STRINGS APPEARING SOMEWHERE. A row projects as
  // `local_code`, else `national_code` — nothing else. Beta below carries 'X' as its NATIONAL code
  // but projects as its LOCAL code 'Y', so it never claims the concept 'X' and Alpha must keep it.
  // An either-column reading of "claims this code" — which the batch widening deliberately narrows
  // with `registryPreferredCode` in memory — invents a collision here, forcing BOTH rows onto their
  // UUIDs: a ghost 'X' concept left behind, Alpha's
  // mapping migrated onto 'fac-A' — a code `resolveObservedFacilities` (which derives preferred
  // codes) can never resolve — and no facility touched by the operator at all.
  it('does not force a row onto its id when another row merely carries its code in a NON-preferred column', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'X' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'X' });

    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', localCode: 'Y', nationalSystem: 'urn:tz:hfr', nationalCode: 'X' });
    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);

    // Nothing moved, because nothing collided.
    expect(r.codeChanges).toEqual([]);
    expect(await currentConceptCode(deps, 'fac-A')).toBe('X');
    expect(await currentConceptCode(deps, 'fac-B')).toBe('Y');
    const codes = await deps.internalDb.selectFrom('terminology_concepts')
      .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(codes.map((c) => c.code).sort()).toEqual(['X', 'Y']);
    // The operator-visible outcome, and the one that would break: resolution derives preferred
    // codes, so a projection that forced UUIDs here would resolve to nothing.
    const resolved = await resolveObservedFacilities(deps);
    expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
  });

  // ⛔ PINS THE ORDERING CONTRACT (write new concept -> rewrite mappings -> delete old concept). The
  // three steps are NOT one transaction (see the function's doc comment for why they cannot cheaply
  // be), so the ORDER is the entire safety argument, and until this test existed the argument was
  // prose: moving the concept delete ahead of the mapping rewrite passed every other test in the
  // file. A mid-rewrite failure must leave BOTH concepts alive, so every mapping — migrated or not —
  // still points at something that resolves.
  it('leaves the old concept in place when the mapping rewrite fails', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'OLD-1' });
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-1' }).where('id', '=', 'fac-A').execute();

    // Same technique as `projectRegistryRows`' "swallows a projection failure" test: a spread over
    // `deps` with one store method replaced.
    const failingAdmin = {
      ...deps.admin,
      termMappings: {
        ...deps.admin.termMappings,
        update: async () => { throw new Error('simulated term_mappings failure'); },
      },
    };

    await expect(
      reprojectRegistryRows({ ...deps, admin: failingAdmin }, [{ id: 'fac-A', name: 'Alpha' }]),
    ).rejects.toThrow('simulated term_mappings failure');

    const codes = (await deps.internalDb.selectFrom('terminology_concepts')
      .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute()).map((c) => c.code);
    expect(codes).toContain('NEW-1'); // (a) the new concept was written FIRST
    expect(codes).toContain('OLD-1'); // (b) the old one is NOT deleted before the rewrite succeeds
    // (c) and therefore no mapping is left pointing at a concept that no longer exists.
    const mappings = await deps.internalDb.selectFrom('term_mappings')
      .select(['to_code']).where('to_system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(mappings.length).toBeGreaterThan(0);
    for (const m of mappings) expect(codes).toContain(m.to_code);
  });

  // ⛔ PINS THE `linkedElsewhere` GUARD. A link row can name a code some OTHER facility durably
  // projects as (migration 077's backfill has no ORDER BY), and then the mappings on that code are
  // that other facility's: migrating them would re-point an operator's mapping at the wrong lab, and
  // deleting the concept would take a LIVE facility out of the picker. Neutering the guard to
  // `if (true)` used to pass every test in this file.
  it('does not migrate or delete a code still linked by a facility outside the batch', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'SHARED' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'SHARED' });

    // Charlie is NOT in the batch below, and its link durably names 'SHARED' — the disagreeing-link
    // shape the backfill can produce. Seeded through the registry store first because
    // `facility_concept_projection.registry_id` is a foreign key.
    await seedRegistry(deps, { id: 'fac-C', name: 'Charlie', localCode: 'CCC' });
    await deps.internalDb.insertInto('facility_concept_projection')
      .values({ registry_id: 'fac-C', concept_code: 'SHARED', updated_at: new Date() }).execute();

    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'NEW-A' }).where('id', '=', 'fac-A').execute();
    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    // THE SUBSTANTIVE HALF FIRST, so neutering the guard fails on the damage and not merely on the
    // reporting flag: the mapping is left strictly alone, and the concept it points at survives.
    const mappings = await deps.internalDb.selectFrom('term_mappings')
      .select(['to_code']).where('to_system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(mappings.map((m) => m.to_code)).toEqual(['SHARED']);
    // Only Alpha's two codes: Charlie was given a LINK row, not a projection run, because the link
    // is the guard's whole input — the guard deliberately does NOT re-derive it from live concepts.
    const codes = await deps.internalDb.selectFrom('terminology_concepts')
      .select('code').where('system', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(codes.map((c) => c.code).sort()).toEqual(['NEW-A', 'SHARED']);
    // The row still ADVANCES — only the carry-over is skipped — and the skip is TELLABLE APART from
    // "there was nothing to carry": both report `mappingsMigrated: 0`.
    expect(await currentConceptCode(deps, 'fac-A')).toBe('NEW-A');
    expect(r.codeChanges).toEqual([{ registryId: 'fac-A', from: 'SHARED', to: 'NEW-A', mappingsMigrated: 0, carryOverSkipped: true }]);
  });

  // ⛔ PINS THE SNAPSHOT-ONCE INVARIANT: the stale mappings are read ONCE, BEFORE any rewrite, so the
  // loop can never see its own writes. Two rows exchanging codes is the directly constructible case —
  // re-reading `term_mappings` inside the loop lets Alpha's freshly-rewritten mapping be picked up
  // again as Beta's "stale" one and rewritten a SECOND time, landing Alpha's observed code on Beta.
  // Re-reading per row used to pass every other test in the file.
  it('handles two facilities swapping codes in one batch without rewriting a mapping twice', async () => {
    const deps = await makeReconcileDeps();
    await seedPerformers(deps, [['BALAB', 1], ['CDLAB', 1]]);
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'X' });
    await seedRegistry(deps, { id: 'fac-B', name: 'Beta', localCode: 'Y' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'BALAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'X' });
    await seedMapping(deps, { fromSystem: DEFAULT_OBSERVED_FACILITY_SYSTEM, fromCode: 'CDLAB', toSystem: FACILITY_REGISTRY_SYSTEM, toCode: 'Y' });

    // Three hops, not two: `local_code` is unique on its own, so A cannot take 'Y' while B still
    // holds it.
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'TMP' }).where('id', '=', 'fac-A').execute();
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'X' }).where('id', '=', 'fac-B').execute();
    await deps.internalDb.updateTable('facility_registry').set({ local_code: 'Y' }).where('id', '=', 'fac-A').execute();

    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }, { id: 'fac-B', name: 'Beta' }]);

    // The operator-visible outcome first: each observed code followed its OWN facility across the
    // swap. A loop that sees its own writes lands BALAB on Beta.
    const resolved = await resolveObservedFacilities(deps);
    expect(resolved.find((x) => x.sourceCode === 'BALAB')!.registryId).toBe('fac-A');
    expect(resolved.find((x) => x.sourceCode === 'CDLAB')!.registryId).toBe('fac-B');
    // Exactly ONE mapping migrated per row — a second pass over an already-rewritten row would
    // report 2 here.
    expect([...r.codeChanges].sort((a, b) => a.registryId.localeCompare(b.registryId))).toEqual([
      { registryId: 'fac-A', from: 'X', to: 'Y', mappingsMigrated: 1, carryOverSkipped: false },
      { registryId: 'fac-B', from: 'Y', to: 'X', mappingsMigrated: 1, carryOverSkipped: false },
    ]);
  });

  // Steady state — every facility save after the first, and every re-Publish over an unchanged
  // registry. Nothing moved, so no mapping lookup and no concept delete may run at all. Spies on
  // `selectFrom` (not on a store method) because `term_mappings` is read with a raw Kysely builder;
  // a table-name assertion is the only vantage point that would fail if the gating regressed.
  it('does not touch term_mappings when nothing moved', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha', localCode: 'OLD-1' });
    await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    const selectFromSpy = vi.spyOn(deps.internalDb, 'selectFrom');
    const r = await reprojectRegistryRows(deps, [{ id: 'fac-A', name: 'Alpha' }]);

    expect(r.codeChanges).toEqual([]);
    expect(selectFromSpy.mock.calls.map((args) => args[0])).not.toContain('term_mappings');
    selectFromSpy.mockRestore();
  });
});

describe('captureObservedFacility', () => {
  it('creates a concept for a newly seen performer', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['Namansi']);
  });

  // `total === 1` alone cannot distinguish "skipped" from "re-imported": `importRows` upserts on
  // `(system, code)`, so the count stays 1 either way — even if the `if (existing) return;` guard
  // were deleted entirely. `firstSeen` is the only observable that tells the two apart: a re-import
  // re-derives it from `now` (see `observedFacilityConceptRow`, called with no `existing`), while a
  // skip leaves the original untouched. Capture at two DIFFERENT timestamps and assert `firstSeen`
  // did not move to the second one.
  it('is idempotent for a performer already captured (firstSeen does not advance on a repeat capture)', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-06T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(1);
    const raw = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Namansi')
      .executeTakeFirstOrThrow();
    const props = (typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties) as { firstSeen: string };
    expect(props.firstSeen).toBe('2026-08-05T00:00:00.000Z');
  });

  it('keeps the string byte-for-byte', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows[0].code).toBe('Aga Khan');
  });

  // ⚠ `terms.search` with a `query` does a substring match — a performer whose code is a SUBSTRING
  // of an already-captured one (or vice versa) must still create its own, distinct concept. At this
  // call order ('Aga Khan Hospital' first, then 'Aga Khan') the second capture's exact-match filter
  // trivially returns undefined regardless of lookup strategy, because 'Aga Khan' does not exist
  // yet — this does NOT exercise the shadowing trap Fix 1 addresses.
  it('creates a distinct concept even when the code is a substring of an existing one', async () => {
    const deps = await makeReconcileDeps();
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan Hospital', '2026-08-05T00:00:00.000Z');

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code).sort()).toEqual(['Aga Khan', 'Aga Khan Hospital']);
  });

  // ⛔ THE actual shadowing trap. `terms.search(system, { query: 'Aga Khan', limit: 1, offset: 0 })`
  // orders matches by `code` ASCENDING. Because 'Aga Khan' is a strict PREFIX of 'Aga Khan Hospital',
  // 'Aga Khan' always sorts BEFORE any string that merely appends to it — a superstring extension can
  // never shadow it out of a `limit: 1` page. The shadowing code must instead contain 'Aga Khan' as a
  // substring WITHOUT it being a prefix, and sort lexicographically earlier: e.g. 'AA Aga Khan Annex'
  // ('AA ' < 'Aga' because 'A' < 'g' at the second character) still matches the substring query
  // `lower(code) LIKE '%aga khan%'`, but sorts before the exact match. A single-row page ordered by
  // `code` then returns 'AA Aga Khan Annex' instead of 'Aga Khan', so an exact-match filter applied
  // to that one-row page finds nothing — even though 'Aga Khan' exists, curated. The old
  // `terms.search`-based lookup would treat it as unknown and `importRows`'s upsert would overwrite
  // its curated display and reset `firstSeen`. The exact-query lookup (Fix 1) must find the exact row
  // directly, regardless of what else exists or sorts first.
  it('preserves a curated display and firstSeen when a lexicographically earlier concept contains the code as a substring', async () => {
    const deps = await makeReconcileDeps();
    // Seed the exact-match concept FIRST, with a curated display and a known firstSeen — via
    // `importRows` directly (the same shape `observedFacilityConceptRow` produces), not
    // `captureObservedFacility`, so the setup is independent of the function under test.
    await deps.admin.terms.importRows([{
      system: 'urn:openldr:default_fac',
      code: 'Aga Khan',
      display: 'Aga Khan Hospital, Dar es Salaam',
      status: 'ACTIVE',
      properties: { firstSeen: '2026-08-01T00:00:00.000Z', lastSeen: '2026-08-01T00:00:00.000Z', reportCount: 5 },
    }]);

    // Capture a lexicographically EARLIER concept that contains 'Aga Khan' as a substring without
    // it being a prefix (see comment above for why a prefix extension cannot shadow).
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'AA Aga Khan Annex', '2026-08-03T00:00:00.000Z');

    // Re-capture the exact code that already exists — must be recognized as already known, not
    // shadowed by 'AA Aga Khan Annex' filling a `limit: 1` page ordered by `code`.
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Aga Khan', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    const agaKhan = rows.find((r) => r.code === 'Aga Khan');
    expect(agaKhan).toBeDefined();
    expect(agaKhan!.display).toBe('Aga Khan Hospital, Dar es Salaam');

    const raw = await deps.internalDb
      .selectFrom('terminology_concepts')
      .select(['properties'])
      .where('system', '=', 'urn:openldr:default_fac')
      .where('code', '=', 'Aga Khan')
      .executeTakeFirstOrThrow();
    const props = (typeof raw.properties === 'string' ? JSON.parse(raw.properties) : raw.properties) as { firstSeen: string };
    expect(props.firstSeen).toBe('2026-08-01T00:00:00.000Z');
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

  // Companion to `scanObservedFacilities`'s "registers an ACTIVE coding_systems row" test — the
  // ingest-time capture path must leave the mapping UI able to see a brand-new feed's system too,
  // not only a manually-triggered scan. Before this fix, `captureObservedFacility` called
  // `admin.terms.importRows` directly and never touched `coding_systems` at all, so a facility
  // captured only through ingest was invisible in `TermMappingDialog`'s system dropdown
  // (`systems.filter((s) => s.active)`) until an operator ran a scan.
  //
  // ⛔ THE trap. Must fail if `active` is false, not merely if the row is absent — `upsertByUrl`
  // inserts `active: true` on a fresh row, so "row exists" alone cannot catch a re-activation bug.
  it('registers an ACTIVE coding_systems row for a system first seen through capture', async () => {
    const deps = await makeReconcileDeps();

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    const cs = await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac');
    expect(cs).not.toBeNull();
    expect(cs!.active).toBe(true);
  });

  // Regression guard mirroring `scanObservedFacilities`'s equivalent test: `upsertByUrl`'s
  // `onConflict` never re-activates a row that already exists with `active = false`, so capture
  // must repair that explicitly, exactly like the scan path does.
  it('re-activates a coding_systems row an operator (or an earlier bug) left inactive', async () => {
    const deps = await makeReconcileDeps();
    await deps.admin.codingSystems.upsertByUrl({
      url: 'urn:openldr:default_fac',
      systemCode: 'DEFAULT_FAC',
      systemName: 'Observed facilities',
      publisherId: null,
    });
    await deps.internalDb.updateTable('coding_systems').set({ active: false })
      .where('url', '=', 'urn:openldr:default_fac').execute();
    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac'))!.active).toBe(false);

    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');

    expect((await deps.admin.codingSystems.getByUrl('urn:openldr:default_fac'))!.active).toBe(true);
  });

  // The hot-path guard this fix exists for: capturing a code that is ALREADY a known concept must
  // not perform a redundant `coding_systems` registration write. Ingest calls this once per
  // projected DiagnosticReport, so a naive "register on every call" would add one write per report
  // even for a code seen a thousand times before — the function's own existing-concept early return
  // is what this test pins as the thing that must also gate the new registration call.
  it('does not perform a redundant coding_systems registration write for an already-known code', async () => {
    const deps = await makeReconcileDeps();
    const upsertSpy = vi.spyOn(deps.admin.codingSystems, 'upsertByUrl');

    // First capture: the concept is genuinely new, so registration is expected exactly once.
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-05T00:00:00.000Z');
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    // Second capture of the SAME code: `captureObservedFacility` already early-returns here (the
    // concept exists), and that early return must also gate registration — the call count must NOT
    // advance to 2.
    await captureObservedFacility(deps, 'urn:openldr:default_fac', 'Namansi', '2026-08-06T00:00:00.000Z');
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});

// Fix 4: exercises the real `onProjected` wiring closure (extracted from `index.ts`'s
// `createProjectionRunner({...})` call into `captureObservedFacilityFromProjection` specifically so
// it is reachable here without booting the full `AppContext`). Nothing previously tested the
// resourceType filter, the empty-performer guard, or the call into `captureObservedFacility`
// together — `cycle.test.ts` only exercises the generic `onProjected` contract with a mock, and the
// tests above call `captureObservedFacility` directly with hand-picked arguments. A typo in the
// resourceType string, or a broken `performer` extraction, would have passed the whole suite.
describe('captureObservedFacilityFromProjection', () => {
  it('creates a concept from a projected DiagnosticReport with a performer', async () => {
    const deps = await makeReconcileDeps();
    const resource = {
      resourceType: 'DiagnosticReport',
      id: 'dr-1',
      performer: [{ display: 'Muhimbili National Hospital' }],
    };

    await captureObservedFacilityFromProjection(deps, 'DiagnosticReport', resource, 'webhook-ingest', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['Muhimbili National Hospital']);
  });

  it('does nothing for a non-DiagnosticReport resource, even one with a performer-shaped field', async () => {
    const deps = await makeReconcileDeps();
    const resource = {
      resourceType: 'Patient',
      id: 'p-1',
      performer: [{ display: 'Muhimbili National Hospital' }],
    };

    await captureObservedFacilityFromProjection(deps, 'Patient', resource, 'webhook-ingest', '2026-08-05T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  it('is a no-op for a DiagnosticReport with no performer', async () => {
    const deps = await makeReconcileDeps();
    const resource = { resourceType: 'DiagnosticReport', id: 'dr-2' };

    await captureObservedFacilityFromProjection(deps, 'DiagnosticReport', resource, 'webhook-ingest', '2026-08-05T00:00:00.000Z');

    const { total } = await deps.admin.terms.search('urn:openldr:default_fac', { limit: 10, offset: 0 });
    expect(total).toBe(0);
  });

  // Gap 1 (Task 9b fix round 1): a resource projected from a NON-default feed must capture its
  // concept into THAT feed's coding system, not the default one — the whole point of Task 9b's
  // "one coding system per feed" design. Before this fix, `sourceSystem` was never threaded through
  // this call at all, so every live-ingest capture landed under `DEFAULT_OBSERVED_FACILITY_SYSTEM`
  // regardless of which feed produced the resource, until the next `scanObservedFacilities` scan
  // corrected it.
  it("captures a projected DiagnosticReport's performer into ITS OWN feed's system, not the default", async () => {
    const deps = await makeReconcileDeps();
    const resource = {
      resourceType: 'DiagnosticReport',
      id: 'dr-cdr-1',
      performer: [{ display: 'NHL-01' }],
    };

    await captureObservedFacilityFromProjection(deps, 'DiagnosticReport', resource, 'cdr-import', '2026-08-05T00:00:00.000Z');

    const cdrSystem = observedSystemForFeed('cdr-import');
    expect(cdrSystem).not.toBe(DEFAULT_OBSERVED_FACILITY_SYSTEM);
    const { rows } = await deps.admin.terms.search(cdrSystem, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['NHL-01']);

    // Must NOT have landed in the default system.
    const { total: defaultTotal } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 10, offset: 0 });
    expect(defaultTotal).toBe(0);
  });

  // Same system preference as scan/resolve: a resource carrying `performer[0].identifier.system`
  // must capture under THAT system, not `observedSystemForFeed(sourceSystem)` — otherwise the
  // ingest-time capture and a later full scan would file the SAME code under two different
  // systems until reconciled.
  it("prefers the wire's identifier.system over observedSystemForFeed(sourceSystem)", async () => {
    const deps = await makeReconcileDeps();
    const wireSystem = 'urn:openldr:cdr:LOCNDIC4';
    const resource = {
      resourceType: 'DiagnosticReport',
      id: 'dr-cdr-2',
      performer: [{ identifier: { system: wireSystem, value: 'BAMAA' }, display: 'Aga Khan' }],
    };

    await captureObservedFacilityFromProjection(deps, 'DiagnosticReport', resource, 'webhook-ingest', '2026-08-05T00:00:00.000Z');

    const { rows } = await deps.admin.terms.search(wireSystem, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.code)).toEqual(['BAMAA']);
    // Must NOT have landed under the source_system-derived default.
    const { total: defaultTotal } = await deps.admin.terms.search(DEFAULT_OBSERVED_FACILITY_SYSTEM, { limit: 10, offset: 0 });
    expect(defaultTotal).toBe(0);
  });
});
