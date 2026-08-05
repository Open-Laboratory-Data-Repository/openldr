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
