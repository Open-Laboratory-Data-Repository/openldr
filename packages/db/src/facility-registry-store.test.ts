import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegistryStore, buildDistinctAdminValuesQuery } from './facility-registry-store';

async function store() {
  const db = await makeMigratedDb();
  return { db, s: createFacilityRegistryStore(db as never) };
}

const manual = { id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual' as const };

describe('createFacilityRegistryStore', () => {
  it('round-trips a hand-entered facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    expect(await s.get('f1')).toMatchObject({ id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral' });
  });

  it('upsert updates a record in place, keyed on id (re-upsert is an in-place rename, not a new row)', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.upsert({ ...manual, name: 'Dodoma Regional Referral Hospital' });
    expect(await s.get('f1')).toMatchObject({ name: 'Dodoma Regional Referral Hospital' });
  });

  // Task 1: facility_registry was registered on the reference-data bus with change capture live but
  // no serve/apply support — a logged upsert got served to labs as a bogus delete. This test used to
  // assert the OPPOSITE (that upsert/remove DO land reference_change_log rows); that pinned the
  // defective behaviour. Capture is now suspended at the source, see SUSPENDED_REFERENCE_ENTITY_TYPES
  // in reference-change-log.ts.
  it('does not capture facility_registry into reference_change_log (sync suspended)', async () => {
    const { db } = await store();
    const captured: { entityType: string; entityId: string; op: string }[] = [];
    const s = createFacilityRegistryStore(db as never, {
      record: async (_trx, entityType, entityId, op) => { captured.push({ entityType, entityId, op }); },
    });

    await s.upsert({ id: 'f9', name: 'Clinic', localCode: 'L9', source: 'manual' } as never);
    await s.remove('f9');

    expect(captured).toEqual([]);
  });

  it('round-trips extras through the store', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, extras: { catchmentPop: 42000, tier: 'referral' } });
    expect(await s.get('f1')).toMatchObject({ extras: { catchmentPop: 42000, tier: 'referral' } });
  });

  it('filters the list by region and status', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, region: 'Dodoma Region', status: 'Operating' });
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Closed One', source: 'manual', region: 'Dodoma Region', status: 'Closed' });
    expect((await s.list({ region: 'Dodoma Region' })).rows).toHaveLength(2);
    expect((await s.list({ region: 'Dodoma Region', status: 'Operating' })).rows).toHaveLength(1);
  });

  it('caps list() at a default of 200 rows when no limit is given — a national register runs 10-15k', async () => {
    const { db, s } = await store();
    const rows = Array.from({ length: 205 }, (_, i) => ({
      id: `f${i}`, local_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual',
    }));
    await db.insertInto('facility_registry' as never).values(rows as never).execute();
    expect((await s.list()).rows).toHaveLength(200);
    expect((await s.list({ limit: 5 })).rows).toHaveLength(5);
  });

  /** Seeds `n` facilities named "Facility 001".."Facility n", alternating region/status so filter
   *  and search tests have something to discriminate. Returns the store. */
  async function seedMany(n: number) {
    const { s } = await store();
    for (let i = 1; i <= n; i += 1) {
      const p = String(i).padStart(3, '0');
      await s.upsert({
        id: `f${p}`,
        name: `Facility ${p}`,
        localCode: `LC-${p}`,
        nationalSystem: i % 2 === 0 ? 'urn:hfr' : 'urn:mfl',
        nationalCode: `NC-${p}`,
        region: i % 2 === 0 ? 'Dodoma' : 'Mwanza',
        status: i % 3 === 0 ? 'Closed' : 'Active',
        level: 'dispensary',
        source: 'manual' as const,
      });
    }
    return s;
  }

  it('pages with an exact total that is independent of the page size', async () => {
    const s = await seedMany(25);
    const first = await s.list({ limit: 10, offset: 0 });
    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.rows[0].name).toBe('Facility 001');

    const last = await s.list({ limit: 10, offset: 20 });
    expect(last.rows).toHaveLength(5);
    expect(last.total).toBe(25);
    expect(last.rows[0].name).toBe('Facility 021');
  });

  it('returns an empty page rather than erroring when offset runs past the end', async () => {
    const s = await seedMany(5);
    const past = await s.list({ limit: 10, offset: 500 });
    expect(past.rows).toEqual([]);
    expect(past.total).toBe(5);
  });

  it('total reflects the filters, not the page size', async () => {
    const s = await seedMany(25);
    const dodoma = await s.list({ region: 'Dodoma', limit: 5 });
    expect(dodoma.total).toBe(12);
    expect(dodoma.rows).toHaveLength(5);
    expect(dodoma.rows.every((r) => r.region === 'Dodoma')).toBe(true);
  });

  it('searches name, local code, national code and admin area, case-insensitively', async () => {
    const s = await seedMany(25);
    expect((await s.list({ q: 'facility 007' })).total).toBe(1);
    expect((await s.list({ q: 'LC-008' })).total).toBe(1);
    expect((await s.list({ q: 'nc-009' })).total).toBe(1);
    expect((await s.list({ q: 'dodoma' })).total).toBe(12);
    expect((await s.list({ q: 'no such facility' })).total).toBe(0);
  });

  it('filters on every column-backed dimension', async () => {
    const s = await seedMany(25);
    expect((await s.list({ nationalSystem: 'urn:hfr' })).total).toBe(12);
    expect((await s.list({ status: 'Closed' })).total).toBe(8);
    expect((await s.list({ level: 'dispensary' })).total).toBe(25);
    expect((await s.list({ source: 'manual' })).total).toBe(25);
    expect((await s.list({ level: 'hospital' })).total).toBe(0);
  });

  it('combines search and filters conjunctively', async () => {
    const s = await seedMany(25);
    const r = await s.list({ q: 'dodoma', status: 'Closed' });
    expect(r.total).toBe(4);
    expect(r.rows.every((x) => x.region === 'Dodoma' && x.status === 'Closed')).toBe(true);
  });

  it('handles a realistically long facility name without truncating or erroring', async () => {
    const { s } = await store();
    const long = `Mwananyamala Regional Referral Hospital ${'and Community Outreach Annexe '.repeat(6)}`.trim();
    await s.upsert({ id: 'long', name: long, localCode: 'L', source: 'manual' as const });
    const r = await s.list({ q: 'Outreach' });
    expect(r.total).toBe(1);
    expect(r.rows[0].name).toBe(long);
  });

  // --- Task 3: distinctAdminValues ------------------------------------------------------------

  describe('distinctAdminValues', () => {
    it('ranks distinct values by frequency (commonest first), with counts', async () => {
      const { db, s } = await store();
      // Dodoma x3, Kongwa x1, Chamwino x2 — the ranking must be Dodoma(3), Chamwino(2), Kongwa(1),
      // NOT insertion order and NOT alphabetical.
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: 'Dodoma' },
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', district: 'Dodoma' },
        { id: 'f4', local_code: 'LAB4', name: 'D', source: 'manual', district: 'Kongwa' },
        { id: 'f5', local_code: 'LAB5', name: 'E', source: 'manual', district: 'Chamwino' },
        { id: 'f6', local_code: 'LAB6', name: 'F', source: 'manual', district: 'Chamwino' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      expect(await s.distinctAdminValues('district')).toEqual([
        { value: 'Dodoma', count: 3 },
        { value: 'Chamwino', count: 2 },
        { value: 'Kongwa', count: 1 },
      ]);
    });

    it('scopes by the parent level already chosen (e.g. districts filtered by region)', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', region: 'Dodoma Region', district: 'Kongwa' },
        // Same district NAME, different region — must NOT bleed into the Dodoma-region result.
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', region: 'Mbeya Region', district: 'Dodoma' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      const result = await s.distinctAdminValues('district', { region: 'Dodoma Region' });
      expect(result.map((r) => r.value).sort()).toEqual(['Dodoma', 'Kongwa']);
      expect(result.find((r) => r.value === 'Dodoma')?.count).toBe(1);
    });

    it('an absent or blank scope value means unfiltered for that level, not "match empty string"', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', region: 'Mbeya Region', district: 'Mbeya' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      // No scope at all.
      expect((await s.distinctAdminValues('district')).map((r) => r.value).sort()).toEqual(['Dodoma', 'Mbeya']);
      // Explicit but blank scope value — must behave the same as omitting it, never match `region = ''`.
      expect((await s.distinctAdminValues('district', { region: '' })).map((r) => r.value).sort()).toEqual(['Dodoma', 'Mbeya']);
    });

    it('excludes NULL and blank values — they are not suggestions', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: null },
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', district: '' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      expect(await s.distinctAdminValues('district')).toEqual([{ value: 'Dodoma', count: 1 }]);
    });

    it('never treats a scope entry for the requested level itself as a filter', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: 'Kongwa' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      // scope.district is nonsensical when level === 'district'; it must be ignored, not applied
      // as `WHERE district = 'Dodoma'` (which would silently collapse the result to one row).
      const result = await s.distinctAdminValues('district', { district: 'Dodoma' } as never);
      expect(result.map((r) => r.value).sort()).toEqual(['Dodoma', 'Kongwa']);
    });

    it('caps the number of distinct values returned', async () => {
      const { db, s } = await store();
      // 1005 rows, each with its OWN distinct zone value — 1005 distinct values on offer, strictly
      // more than MAX_ADMIN_VALUES (1000), so the cap is the only thing that can be limiting the
      // result. `toBe(1000)`, not a `<=`/`>` range: a range passes for any cap from 1 through 1000,
      // including an accidentally-much-smaller one (e.g. a stray off-by-a-lot slicing bug) — it
      // does not actually pin the documented cap.
      const rows = Array.from({ length: 1005 }, (_, i) => ({
        id: `f${i}`, local_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual', zone: `Zone ${i}`,
      }));
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      const result = await s.distinctAdminValues('zone');
      expect(result.length).toBe(1000);
    });
  });

  // --- Task 3 code review remediation: distinctAdminValues' NULL/blank exclusion guarantee -------
  //
  // The behavioural test above ("excludes NULL and blank values") executes the real query against
  // pg-mem, the in-memory Postgres this suite runs on — and pg-mem is NOT a trustworthy oracle for
  // this particular predicate (see the long comment on `buildDistinctAdminValuesQuery` in
  // facility-registry-store.ts for the measured details: it mis-evaluates an `IS NOT NULL`
  // predicate chained with another `.where()` depending on which one comes first, independent of
  // `GROUP BY`). A row-output test alone proves pg-mem did something on that run, not that the
  // SQL sent to a real Postgres is actually NULL/blank-safe. This block pins the guarantee a second,
  // independent way — on the COMPILED SQL text, which `buildDistinctAdminValuesQuery` exposes
  // without executing anything — so the guarantee does not rest on pg-mem's row output alone.
  describe('distinctAdminValues — compiled-SQL guarantee (not just pg-mem row output)', () => {
    it('compiles a single NULL-safe predicate that excludes both NULL and blank for the requested column', async () => {
      const { db } = await store();
      const { sql } = buildDistinctAdminValuesQuery(db, 'district').compile();
      // Both guarantees present in ONE predicate, not two separately-ordered `.where()` clauses —
      // there is nothing left to reorder, so this assertion does not care about clause order.
      expect(sql).toContain(`coalesce("district", '') != ''`);
    });

    it('compiles the same NULL-safe predicate for every admin level, scoped or not', async () => {
      const { db } = await store();
      const { sql } = buildDistinctAdminValuesQuery(db, 'zone', { region: 'Dodoma Region' }).compile();
      expect(sql).toContain(`coalesce("zone", '') != ''`);
    });
  });

  // --- Task 2: mapping/projection health --------------------------------------------------------

  /** Projects a facility (making it selectable as a mapping target) and optionally points `n`
   *  active SAME-AS mappings at it — the many-observed-codes-to-one-facility case. */
  async function project(db: any, registryId: string, conceptCode: string, mappings = 0) {
    await db.insertInto('facility_concept_projection')
      .values({ registry_id: registryId, concept_code: conceptCode }).execute();
    for (let i = 0; i < mappings; i += 1) {
      await db.insertInto('term_mappings').values({
        id: `${registryId}-m${i}`, from_system: 'urn:openldr:default_fac', from_code: `OBS-${registryId}-${i}`,
        to_system: 'urn:openldr:cs:facility-registry', to_code: conceptCode, to_display: null,
        map_type: 'SAME-AS', relationship: null, owner: null, is_active: true,
      }).execute();
    }
  }

  it('reports unprojected, unmapped and mapped health', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', localCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', localCode: 'L-C', source: 'manual' as const });
    await project(db, 'a', 'L-A', 1);
    await project(db, 'b', 'L-B', 0);
    // 'c' is never projected — it cannot be picked as a mapping target at all.

    const { rows } = await s.list({});
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.a.health).toBe('mapped');
    expect(byId.b.health).toBe('unmapped');
    expect(byId.c.health).toBe('unprojected');
  });

  it('⭐ a facility targeted by TWO mappings appears ONCE and does not inflate the total', async () => {
    // The fan-out guard. term_mappings permits many observed codes to resolve to one facility, so a
    // plain left join would return this facility twice and report total 2.
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await project(db, 'a', 'L-A', 2);

    const r = await s.list({});
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(1);
    expect(r.rows[0].mappingCount).toBe(2);
  });

  // Split deliberately from the test above, not merged into it: `expect(r.rows).toHaveLength(1)`
  // throws immediately under the plain-join mutation, so a combined assertion never reaches
  // `total` at all — the row-duplication half of the guard would fail loudly, but the
  // total-inflation half (the more dangerous one, because it corrupts a number the rendered page
  // shows with no visible duplicate row to tip anyone off) would go unexercised by that failure.
  // This test asserts ONLY `total`, against the identical fixture, so that half is independently
  // observable and cannot hide behind the other assertion's throw.
  it('⭐ a facility targeted by TWO mappings does not inflate the total', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await project(db, 'a', 'L-A', 2);

    const r = await s.list({});
    expect(r.total).toBe(1);
  });

  it('an inactive or non-SAME-AS mapping does not make a facility read as mapped', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await db.insertInto('facility_concept_projection')
      .values({ registry_id: 'a', concept_code: 'L-A' }).execute();
    await db.insertInto('term_mappings').values([
      { id: 'm-inactive', from_system: 'urn:openldr:default_fac', from_code: 'O1',
        to_system: 'urn:openldr:cs:facility-registry', to_code: 'L-A', to_display: null,
        map_type: 'SAME-AS', relationship: null, owner: null, is_active: false },
      { id: 'm-narrower', from_system: 'urn:openldr:default_fac', from_code: 'O2',
        to_system: 'urn:openldr:cs:facility-registry', to_code: 'L-A', to_display: null,
        map_type: 'NARROWER-THAN', relationship: null, owner: null, is_active: true },
    ]).execute();

    const { rows } = await s.list({});
    expect(rows[0].health).toBe('unmapped');
    expect(rows[0].mappingCount).toBe(0);
  });

  it('filters by health, with a total that matches', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', localCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', localCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', localCode: 'L-C', source: 'manual' as const });
    await project(db, 'a', 'L-A', 1);
    await project(db, 'b', 'L-B', 0);

    const mapped = await s.list({ health: 'mapped' });
    expect(mapped.total).toBe(1);
    expect(mapped.rows.map((r) => r.id)).toEqual(['a']);
    expect((await s.list({ health: 'unmapped' })).total).toBe(1);
    expect((await s.list({ health: 'unprojected' })).total).toBe(1);
  });
});
