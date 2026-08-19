import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegistryStore, buildDistinctAdminValuesQuery } from './facility-registry-store';

async function store() {
  const db = await makeMigratedDb();
  return { db, s: createFacilityRegistryStore(db as never) };
}

const manual = { id: 'f1', facilityCode: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual' as const };

describe('createFacilityRegistryStore', () => {
  it('round-trips a hand-entered facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    expect(await s.get('f1')).toMatchObject({ id: 'f1', facilityCode: 'LAB01', name: 'Dodoma Regional Referral' });
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

    await s.upsert({ id: 'f9', name: 'Clinic', facilityCode: 'L9', source: 'manual' } as never);
    await s.remove('f9');

    expect(captured).toEqual([]);
  });

  it('round-trips extras through the store', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, extras: { catchmentPop: 42000, tier: 'referral' } });
    expect(await s.get('f1')).toMatchObject({ extras: { catchmentPop: 42000, tier: 'referral' } });
  });

  // Task 10 (B1, facility-canonical-identity): `register_state` (migration 081) was seeded and
  // written by the retirement path, but never READ back into a `FacilityRecord` — `toRecord()`
  // silently dropped the column every `SELECT` already carried. Surfacing it is what lets the
  // studio UI show/filter on registry membership at all.
  it("surfaces register_state on get()/upsert(), defaulting to 'not_registered' for a plain upsert", async () => {
    const { s } = await store();
    const created = await s.upsert(manual);
    expect(created.registerState).toBe('not_registered');
    expect((await s.get('f1'))?.registerState).toBe('not_registered');
  });

  it('filters the list by region and status', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, region: 'Dodoma Region', status: 'Operating' });
    await s.upsert({ id: 'f2', facilityCode: 'LAB02', name: 'Closed One', source: 'manual', region: 'Dodoma Region', status: 'Closed' });
    expect((await s.list({ region: 'Dodoma Region' })).rows).toHaveLength(2);
    expect((await s.list({ region: 'Dodoma Region', status: 'Operating' })).rows).toHaveLength(1);
  });

  it('caps list() at a default of 200 rows when no limit is given — a national register runs 10-15k', async () => {
    const { db, s } = await store();
    const rows = Array.from({ length: 205 }, (_, i) => ({
      id: `f${i}`, facility_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual',
    }));
    await db.insertInto('facility_registry' as never).values(rows as never).execute();
    expect((await s.list()).rows).toHaveLength(200);
    expect((await s.list({ limit: 5 })).rows).toHaveLength(5);
  });

  /** Seeds `n` facilities named "Facility 001".."Facility n", varying every column-backed filter
   *  dimension `FacilityListOptions` accepts (I1, whole-branch review) so filter and search tests
   *  have something to discriminate on for EACH of them independently, not just the four
   *  (nationalSystem/status/level/source) an earlier version of this fixture populated. Each
   *  dimension below uses its own modulus (2, 3, 4, 5-with-a-distinct-offset, 7) so no two
   *  dimensions are perfectly correlated across the fixture — a filter predicate accidentally wired
   *  to the WRONG column would still show up as a wrong count instead of hiding behind a coincidence
   *  of matching splits. Returns the store. */
  async function seedMany(n: number) {
    const { db, s } = await store();
    for (let i = 1; i <= n; i += 1) {
      const p = String(i).padStart(3, '0');
      await s.upsert({
        id: `f${p}`,
        name: `Facility ${p}`,
        // One code per facility now. It stays unique per row so the paging/filter assertions below
        // still distinguish 25 seeded facilities.
        facilityCode: `LC-${p}`,
        facilitySystem: i % 2 === 0 ? 'urn:hfr' : 'urn:mfl',
        region: i % 2 === 0 ? 'Dodoma' : 'Mwanza',
        status: i % 3 === 0 ? 'Closed' : 'Active',
        level: 'dispensary',
        source: 'manual' as const,
        country: i % 5 === 0 ? 'KE' : 'TZ',
        zone: i % 4 === 0 ? 'Eastern' : 'Western',
        district: i % 5 === 1 ? 'Kongwa' : 'Chamwino',
        council: i % 5 === 2 ? 'Bahi' : 'Kondoa',
        ownership: i % 7 === 0 ? 'faith-based' : 'public',
        // Left unset (⇒ null) on most rows, deliberately — `managedOrigin` distinguishes a
        // lab-local row (null) from a central-managed one, and a filter test for it needs both.
        managedOrigin: i % 5 === 3 ? 'central' : undefined,
      });
      // `register_state` (migration 081) is NOT one of `upsert()`'s own columns — see `toRow()`'s doc
      // comment — so a fixture that wants a non-default value has to write it directly. The real
      // writer is the IMPORT path (`importFacilities`, packages/bootstrap/src/facility-import.ts),
      // which likewise writes this column with its own direct UPDATEs rather than through `upsert()`:
      // 'in_register' for the rows a release carries and 'dropped' for the ones it retired. (An
      // earlier version of this comment said the fixture matched "the real retirement path" — that
      // path only ever writes 'dropped', so it could not have been the model for the 'in_register'
      // half below.) 5 rows land
      // 'dropped' (i%5===0: 5,10,15,20,25), 5 land 'in_register' (i%5===1: 1,6,11,16,21), and the
      // remaining 15 keep the column's own DEFAULT ('not_registered').
      if (i % 5 === 0) {
        await db.updateTable('facility_registry').set({ register_state: 'dropped' })
          .where('id', '=', `f${p}`).execute();
      } else if (i % 5 === 1) {
        await db.updateTable('facility_registry').set({ register_state: 'in_register' })
          .where('id', '=', `f${p}`).execute();
      }
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

  // I2 (whole-branch review): `list()` used to order ONLY by `name` — plain `text NOT NULL`, unique
  // on nothing (migration 070 puts uniqueness on `local_code` and `(national_system, national_code)`
  // only). Duplicate names are the norm in a national master facility list, and a SQL sort over a
  // non-unique column is not guaranteed stable across two independent query executions — a plain
  // `offset` page 1 and page 2 are exactly that: two separate executions, with no shared cursor or
  // snapshot between them. Without a unique tiebreaker, Postgres is free to order same-name rows
  // differently run to run (a different plan, parallel workers, or a different scan path), so a row
  // can land on two pages at once while another lands on none — reachable through NO concurrent
  // writes at all, purely from re-running the same query.
  //
  // This test seeds several facilities sharing one name, inserted in an order that does NOT match
  // `id`'s sort order (so an insertion-order coincidence can't accidentally cover for a missing
  // tiebreaker), then pages through them one row at a time and asserts the union of every page
  // contains each id EXACTLY once. See the report for whether removing the `id` tiebreaker actually
  // reproduces a failure under pg-mem (the in-memory Postgres this suite runs on) — pg-mem may
  // happen to be stable across repeated executions of an unchanged query even without the
  // tiebreaker, in which case this test cannot mutation-prove itself here; the fix is correct
  // regardless; only the reproduction is what may or may not hold under pg-mem specifically.
  it('I2: pages through rows sharing the same NON-UNIQUE name without duplicating or skipping any', async () => {
    const { s } = await store();
    // Deliberately unsorted relative to `id`'s own ordering, so this cannot pass by accident of
    // insertion order lining up with the tiebreaker's sort order.
    const ids = ['f-c', 'f-a', 'f-e', 'f-b', 'f-d'];
    for (const id of ids) {
      await s.upsert({ id, name: 'Bagamoyo Dispensary', facilityCode: `LC-${id}`, source: 'manual' as const });
    }

    const seen: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 1) {
      // Each iteration is its own independent `list()` call/query execution — exactly the page-1
      // vs page-2 scenario the finding describes, not one query sliced client-side.
      const page = await s.list({ limit: 1, offset });
      expect(page.rows).toHaveLength(1);
      seen.push(page.rows[0].id);
    }

    // No id shown twice, and every id shown exactly once — a duplicate here is one facility
    // appearing on two pages; a missing one is a facility unreachable through paging at all.
    expect(new Set(seen).size).toBe(ids.length);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('total reflects the filters, not the page size', async () => {
    const s = await seedMany(25);
    const dodoma = await s.list({ region: 'Dodoma', limit: 5 });
    expect(dodoma.total).toBe(12);
    expect(dodoma.rows).toHaveLength(5);
    expect(dodoma.rows.every((r) => r.region === 'Dodoma')).toBe(true);
  });

  it('searches name, facility code and admin area, case-insensitively', async () => {
    // Was "local code, national code" — one code column now (migration 088), so the or-group has one
    // code branch instead of two. `nc-009` no longer names anything; `lc-009` is the same facility.
    const s = await seedMany(25);
    expect((await s.list({ q: 'facility 007' })).total).toBe(1);
    expect((await s.list({ q: 'LC-008' })).total).toBe(1);
    expect((await s.list({ q: 'lc-009' })).total).toBe(1);
    expect((await s.list({ q: 'dodoma' })).total).toBe(12);
    expect((await s.list({ q: 'no such facility' })).total).toBe(0);
  });

  // I1 (whole-branch review): `q`'s or-group has six branches (name/local_code/national_code/
  // region/district/council) but the test above only ever exercised name/local_code/national_code/
  // region — a future refactor could drop the district or council branch entirely and every test in
  // this file would still pass. `district`/`council` in `seedMany` (Kongwa/Bahi) are not shared by
  // any other seeded column (name, local/national code, region, the other of the pair), so a match
  // here can only be coming from the branch under test.
  it('I1: searches district and council too, not just name/local code/national code/region', async () => {
    const s = await seedMany(25);
    expect((await s.list({ q: 'kongwa' })).total).toBe(5); // district-only match
    expect((await s.list({ q: 'bahi' })).total).toBe(5); // council-only match
  });

  // I1 (whole-branch review): this test used to assert 4 of the 11 filter dimensions its name
  // claimed (nationalSystem/status/level/source, plus one negative) — `seedMany` did not populate
  // country/zone/district/council/ownership/managedOrigin at all, so no test in this file COULD
  // discriminate on them; a future refactor deleting any of those six predicates from `applyFilters`
  // left every test here green. Now genuinely covers every column-backed dimension `list()` accepts
  // (region has its own dedicated test above/below and is not repeated here) — Task 10 added
  // `registerState` (migration 081's `register_state`) to that set.
  it('filters on every column-backed dimension', async () => {
    const s = await seedMany(25);
    expect((await s.list({ nationalSystem: 'urn:hfr' })).total).toBe(12);
    expect((await s.list({ status: 'Closed' })).total).toBe(8);
    expect((await s.list({ level: 'dispensary' })).total).toBe(25);
    expect((await s.list({ source: 'manual' })).total).toBe(25);
    expect((await s.list({ level: 'hospital' })).total).toBe(0);
    expect((await s.list({ country: 'KE' })).total).toBe(5);
    expect((await s.list({ zone: 'Eastern' })).total).toBe(6);
    expect((await s.list({ district: 'Kongwa' })).total).toBe(5);
    expect((await s.list({ council: 'Bahi' })).total).toBe(5);
    expect((await s.list({ ownership: 'faith-based' })).total).toBe(3);
    expect((await s.list({ managedOrigin: 'central' })).total).toBe(5);
    expect((await s.list({ registerState: 'in_register' })).total).toBe(5);
    expect((await s.list({ registerState: 'dropped' })).total).toBe(5);
    expect((await s.list({ registerState: 'not_registered' })).total).toBe(15);
  });

  it('combines search and filters conjunctively', async () => {
    const s = await seedMany(25);
    const r = await s.list({ q: 'dodoma', status: 'Closed' });
    expect(r.total).toBe(4);
    expect(r.rows.every((x) => x.region === 'Dodoma' && x.status === 'Closed')).toBe(true);
  });


  // --- Task 2: the shared table-query grammar --------------------------------------------------

  // `list()` now also accepts validated `filters`/`sorts` from `parseTableQuery`
  // (`@openldr/table-query`), ANDed with the fourteen named params above rather than replacing
  // them. Every column in `FACILITY_COLUMNS` is `text` or `enum`, and `applySorts` collates both,
  // so NO explicit-sort assertion can run here: pg-mem's parser rejects `COLLATE` outright. The
  // sort proofs live in `facility-registry-live.test.ts`. What CAN run offline is the filter
  // translation and the no-sort default, and both are below.
  describe('grammar filters and sorts', () => {
    it('applies a grammar filter that no named param sent', async () => {
      const s = await seedMany(25);
      // `country: 'KE'` is 5 of the 25 rows (i % 5 === 0). Deliberately a value that selects a
      // SUBSET: a filter that were silently dropped would return all 25 and fail this, whereas
      // filtering on `level = 'dispensary'` (all 25 rows) would pass either way.
      const r = await s.list({
        filters: [{ column: 'country', operator: 'eq', value: 'KE', combine: 'and' }],
        limit: 1000,
      });
      expect(r.total).toBe(5);
      expect(r.rows).toHaveLength(5);
      expect(r.rows.every((x) => x.country === 'KE')).toBe(true);
    });

    it('applies an operator the named params cannot express (like)', async () => {
      const s = await seedMany(25);
      // `q` searches five columns at once; the grammar can target ONE. 'Facility 01' matches
      // 010..019 — ten rows — and nothing else in the fixture.
      const r = await s.list({
        filters: [{ column: 'name', operator: 'like', value: 'Facility 01', combine: 'and' }],
        limit: 1000,
      });
      expect(r.total).toBe(10);
      expect(r.rows.every((x) => x.name.startsWith('Facility 01'))).toBe(true);
    });

    it('ANDs a grammar filter with the existing named params', async () => {
      const s = await seedMany(25);
      // Named `status: 'Active'` is 17 rows; grammar `country = 'KE'` is 5; the intersection is 4
      // (row 15 is the KE row that is also Closed). Every number here differs from every other, so
      // dropping either half of the conjunction changes the count.
      const r = await s.list({
        status: 'Active',
        filters: [{ column: 'country', operator: 'eq', value: 'KE', combine: 'and' }],
        limit: 1000,
      });
      expect(r.total).toBe(4);
      expect(r.rows.every((x) => x.status === 'Active' && x.country === 'KE')).toBe(true);
    });

    // Minor 7 (review remediation): the earlier tests above all use a single `eq` rule, so nothing
    // here pinned how a MULTI-rule grammar filter groups against a named param. `buildFilterExpression`
    // folds rule 0 and rule 1 together first (`country = 'KE' OR ownership = 'faith-based'`), and
    // `applyFilters` then ANDs that whole group onto the named `status = 'Active'` clause as one
    // `.where(callback)` call — Kysely parenthesizes the callback's result, giving
    // `status = 'Active' AND (country = 'KE' OR ownership = 'faith-based')`. The wrong grouping this
    // guards against is the OR leaking past the callback boundary, e.g. built as chained
    // `.where()`/`.orWhere()` calls instead: `(status = 'Active' AND country = 'KE') OR
    // ownership = 'faith-based'`.
    //
    // Fixture (seedMany, n=25): Active∩KE = {5,10,20,25} (4), Active∩faith-based = {7,14} (2, since
    // 21 is faith-based but Closed) — correct grouping is their union, 6 rows. The wrong grouping
    // adds every faith-based row regardless of status, including Closed row 21, for 7 rows. The two
    // groupings disagree (6 vs 7), so this fails if the grouping were ever flattened.
    it('groups a multi-rule OR grammar filter correctly against a named param, not flattened across it', async () => {
      const s = await seedMany(25);
      const r = await s.list({
        status: 'Active',
        filters: [
          { column: 'country', operator: 'eq', value: 'KE', combine: 'and' },
          { column: 'ownership', operator: 'eq', value: 'faith-based', combine: 'or' },
        ],
        limit: 1000,
      });
      expect(r.total).toBe(6);
      expect(r.rows.map((x) => x.id).sort()).toEqual(['f005', 'f007', 'f010', 'f014', 'f020', 'f025']);
    });

    it('counts with the same grammar filters as the page it describes', async () => {
      const s = await seedMany(25);
      // The rows query and the count query share ONE predicate builder. Asserting the VALUE (5),
      // not just `total === rows.length`, is what catches a count query that skipped the grammar:
      // that would report 25 against a 5-row page.
      const r = await s.list({
        filters: [{ column: 'country', operator: 'eq', value: 'KE', combine: 'and' }],
        limit: 1000,
      });
      expect(r.total).toBe(5);
      expect(r.total).toBe(r.rows.length);
    });

    it('keeps the registry alphabetical when the caller sends no sort', async () => {
      // The regression guard for the literal `orderBy(name, id)` pair. That default is deliberately
      // NOT routed through `applySorts` as `defaultSorts`: `name` is a text column, `applySorts`
      // collates text, and pg-mem cannot parse COLLATE — routing it there takes this whole file
      // (and two other packages) offline. Without this test someone could delete the literal
      // branch and only the live suite would notice.
      const { s } = await store();
      // Inserted in an order that is NOT alphabetical, so pg-mem's stable scan order cannot pass
      // this by accident if the ordering were dropped altogether. The ids ASCEND with insertion
      // order and therefore DISAGREE with the alphabetical order of the names — without that, the
      // `id` tiebreaker alone reproduces alphabetical order and seeding ids that agree with
      // alphabetical name order would make this test unable to fail even with `name` ordering
      // deleted.
      const seeded = [['f1', 'Zanzibar Clinic'], ['f2', 'Arusha Clinic'], ['f3', 'Mbeya Clinic']];
      for (const [id, name] of seeded) {
        await s.upsert({ id: id!, name: name!, facilityCode: `LC-${id}`, source: 'manual' as const });
      }
      const names = (await s.list({ limit: 1000 })).rows.map((r) => r.name);
      expect(names).toEqual(['Arusha Clinic', 'Mbeya Clinic', 'Zanzibar Clinic']);
    });

    // Important 1 (review remediation): `health` is a POST-join predicate (`joinHealth`, over
    // `facility_concept_projection`/`term_mappings`) and a grammar `filters` rule is a PRE-join
    // predicate (`applyFilters`, over `facility_registry` columns) — this task is what first put
    // both predicates on the same query. The existing health tests near the bottom of this file
    // (`filters by health, with a total that matches`) only ever send `health` alone; nothing sent
    // both together until this test. No sort needed, so it runs offline on pg-mem like the rest of
    // this describe block. Uses the same `project()` fixture helper as the health tests below.
    //
    // Fixture: four facilities split so health and the grammar filter each select an overlapping
    // but different subset — health=mapped is {a, c}, grammar country=KE is {a, b, d} — and only
    // their intersection, {a}, satisfies both. Dropping either predicate changes the count: health
    // alone gives 2, the grammar filter alone gives 3, only the combination gives 1.
    it('combines health (post-join) with a grammar filter (pre-join) on the same list() call', async () => {
      const { db, s } = await store();
      await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const, country: 'KE' });
      await s.upsert({ id: 'b', name: 'Beta', facilityCode: 'L-B', source: 'manual' as const, country: 'KE' });
      await s.upsert({ id: 'c', name: 'Gamma', facilityCode: 'L-C', source: 'manual' as const, country: 'TZ' });
      await s.upsert({ id: 'd', name: 'Delta', facilityCode: 'L-D', source: 'manual' as const, country: 'KE' });
      await project(db, 'a', 'L-A', 1); // mapped, country KE — the only row satisfying both
      await project(db, 'b', 'L-B', 0); // unmapped, country KE
      await project(db, 'c', 'L-C', 1); // mapped, country TZ
      // 'd' is never projected — unprojected, country KE

      const r = await s.list({
        health: 'mapped',
        filters: [{ column: 'country', operator: 'eq', value: 'KE', combine: 'and' }],
      });
      expect(r.total).toBe(1);
      expect(r.rows.map((x) => x.id)).toEqual(['a']);
    });
  });

  it('handles a realistically long facility name without truncating or erroring', async () => {
    const { s } = await store();
    const long = `Mwananyamala Regional Referral Hospital ${'and Community Outreach Annexe '.repeat(6)}`.trim();
    await s.upsert({ id: 'long', name: long, facilityCode: 'L', source: 'manual' as const });
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
        { id: 'f1', facility_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', facility_code: 'LAB2', name: 'B', source: 'manual', district: 'Dodoma' },
        { id: 'f3', facility_code: 'LAB3', name: 'C', source: 'manual', district: 'Dodoma' },
        { id: 'f4', facility_code: 'LAB4', name: 'D', source: 'manual', district: 'Kongwa' },
        { id: 'f5', facility_code: 'LAB5', name: 'E', source: 'manual', district: 'Chamwino' },
        { id: 'f6', facility_code: 'LAB6', name: 'F', source: 'manual', district: 'Chamwino' },
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
        { id: 'f1', facility_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', facility_code: 'LAB2', name: 'B', source: 'manual', region: 'Dodoma Region', district: 'Kongwa' },
        // Same district NAME, different region — must NOT bleed into the Dodoma-region result.
        { id: 'f3', facility_code: 'LAB3', name: 'C', source: 'manual', region: 'Mbeya Region', district: 'Dodoma' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      const result = await s.distinctAdminValues('district', { region: 'Dodoma Region' });
      expect(result.map((r) => r.value).sort()).toEqual(['Dodoma', 'Kongwa']);
      expect(result.find((r) => r.value === 'Dodoma')?.count).toBe(1);
    });

    it('an absent or blank scope value means unfiltered for that level, not "match empty string"', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', facility_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', facility_code: 'LAB2', name: 'B', source: 'manual', region: 'Mbeya Region', district: 'Mbeya' },
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
        { id: 'f1', facility_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', facility_code: 'LAB2', name: 'B', source: 'manual', district: null },
        { id: 'f3', facility_code: 'LAB3', name: 'C', source: 'manual', district: '' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      expect(await s.distinctAdminValues('district')).toEqual([{ value: 'Dodoma', count: 1 }]);
    });

    it('never treats a scope entry for the requested level itself as a filter', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', facility_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', facility_code: 'LAB2', name: 'B', source: 'manual', district: 'Kongwa' },
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
        id: `f${i}`, facility_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual', zone: `Zone ${i}`,
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
    await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', facilityCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', facilityCode: 'L-C', source: 'manual' as const });
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
    await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const });
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
    await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const });
    await project(db, 'a', 'L-A', 2);

    const r = await s.list({});
    expect(r.total).toBe(1);
  });

  it('an inactive or non-SAME-AS mapping does not make a facility read as mapped', async () => {
    const { db, s } = await store();
    await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const });
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
    await s.upsert({ id: 'a', name: 'Alpha', facilityCode: 'L-A', source: 'manual' as const });
    await s.upsert({ id: 'b', name: 'Beta', facilityCode: 'L-B', source: 'manual' as const });
    await s.upsert({ id: 'c', name: 'Gamma', facilityCode: 'L-C', source: 'manual' as const });
    await project(db, 'a', 'L-A', 1);
    await project(db, 'b', 'L-B', 0);

    const mapped = await s.list({ health: 'mapped' });
    expect(mapped.total).toBe(1);
    expect(mapped.rows.map((r) => r.id)).toEqual(['a']);
    expect((await s.list({ health: 'unmapped' })).total).toBe(1);
    expect((await s.list({ health: 'unprojected' })).total).toBe(1);
  });
});
