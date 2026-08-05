import { describe, it, expect } from 'vitest';
import { scanObservedFacilities } from './facility-reconcile';
import { makeReconcileDeps, seedPerformers } from './test-support/facility-reconcile-fixture';

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
