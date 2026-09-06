import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createInternalDb, type InternalDb } from './internal-db';
import { createFacilityRegistryStore } from './facility-registry-store';

// Both proofs below need real Postgres and are skipped cleanly without it — a skipped run is not a
// pass. Gated the same way as table-query-pagination.live.test.ts, whose guard and connection
// helper this file copies.
//
// Why neither can run on pg-mem:
//  - The collation proof emits `collate "en-US-x-icu"`, which pg-mem's parser rejects outright
//    (`Unexpected kw_collate token`) — a hard syntax error, not a semantic gap.
//  - The paging proof needs ORDER BY tie non-determinism, which pg-mem's stable scan order can
//    never produce: it passes with or without the tiebreaker, so only real Postgres can make it a
//    test that is able to fail.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

// This file writes into the REAL `facility_registry` table (the store is bound to it by name; there
// is no scratch-table option the way there is for table-query-pagination.live.test.ts). Every row
// it inserts carries one of these markers in `facility_system`, and each block deletes its own
// marker before and after itself, so a run that dies mid-way and is later re-run gets cleaned up by
// that re-run's own `beforeAll` delete.
//
// Same shared-table property as table-query-pagination.live.test.ts, with the same two costs, not
// redesigned here:
//  - A concurrent run of this file breaks both tests below. One run's `beforeAll` marker delete can
//    wipe a peer run's fixture mid-flight, and the exact-count assertions here (`toEqual([...])`,
//    `seen.length`) would then see the peer run's rows mixed in or missing.
//  - A run that dies and is never repeated leaves its marker-scoped rows sitting in
//    `facility_registry` — nothing else ever deletes them — and they stay visible in the studio
//    Facilities list until this file runs again or someone removes them by hand.
const COLLATE_MARKER = 'urn:openldr:test:facility-live-collate';
const PAGE_MARKER = 'urn:openldr:test:facility-live-page';
const BULK_MARKER = 'urn:openldr:test:facility-live-bulk';

live('facility list ordering (live Postgres — pg-mem cannot parse COLLATE)', () => {
  let internal: InternalDb;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    await sql`delete from facility_registry where facility_system = ${COLLATE_MARKER}`.execute(internal.db);
    await internal.db
      .insertInto('facility_registry')
      .values([
        // Deliberately inserted in an order that is neither alphabetical nor byte order, so a
        // dropped ORDER BY cannot pass this by coincidence of insertion order.
        { id: 'live-c-2', name: 'BETA Clinic', facility_code: 'LC-C2', facility_system: COLLATE_MARKER, source: 'manual' },
        { id: 'live-c-1', name: '', facility_code: 'LC-C1', facility_system: COLLATE_MARKER, source: 'manual' },
        { id: 'live-c-4', name: 'epsilon Clinic', facility_code: 'LC-C4', facility_system: COLLATE_MARKER, source: 'manual' },
        { id: 'live-c-3', name: 'alpha Clinic', facility_code: 'LC-C3', facility_system: COLLATE_MARKER, source: 'manual' },
      ] as never)
      .execute();
  });

  afterAll(async () => {
    if (!internal) return;
    await sql`delete from facility_registry where facility_system = ${COLLATE_MARKER}`
      .execute(internal.db)
      .catch(() => undefined);
    await internal.close().catch(() => undefined);
  });

  it('sorts names by ICU collation, not the database\'s own byte order', async () => {
    const s = createFacilityRegistryStore(internal.db);
    const { rows } = await s.list({
      // The named param scopes this to the four rows above without going through the grammar
      // filter path — the assertion is about ORDER, and entangling it with the filter translation
      // would let a filter bug masquerade as a sort bug.
      nationalSystem: COLLATE_MARKER,
      // EXPLICIT sort. The no-sort default is the literal `orderBy` pair the store has always had
      // and does NOT collate; only this branch reaches `applySorts`, so a live test that sent no
      // sort would prove nothing about the new code.
      sorts: [{ column: 'name', ascending: true }],
      limit: 100,
    });
    // ICU order. postgres:16-alpine is musl-based, so its own `en_US.utf8` falls back to byte
    // order, which would put 'BETA Clinic' BEFORE 'alpha Clinic' (uppercase B is 0x42, lowercase a
    // is 0x61). The explicit COLLATE is what makes this a property of the query rather than of the
    // image the operator happens to run.
    expect(rows.map((r) => r.name)).toEqual(['', 'alpha Clinic', 'BETA Clinic', 'epsilon Clinic']);
  });
});

live('facility paging over duplicate names (live Postgres — pg-mem has a stable scan order)', () => {
  let internal: InternalDb;
  // Sharing a name is the NORM in a national master facility list, not an edge case: `name` is
  // plain `text NOT NULL` and uniqueness lives on `facility_code` and `(facility_system,
  // facility_code)` only.
  const SHARED_NAME = 'Same Name (facility live paging fixture)';

  beforeAll(async () => {
    internal = createInternalDb(url!);
    await sql`delete from facility_registry where facility_system = ${PAGE_MARKER}`.execute(internal.db);
    await internal.db
      .insertInto('facility_registry')
      .values(
        Array.from({ length: 40 }, (_, i) => ({
          id: `live-p-${String(i).padStart(3, '0')}`,
          name: SHARED_NAME,
          facility_code: `LC-P${String(i).padStart(3, '0')}`,
          facility_system: PAGE_MARKER,
          source: 'manual',
        })) as never,
      )
      .execute();
  });

  afterAll(async () => {
    if (!internal) return;
    await sql`delete from facility_registry where facility_system = ${PAGE_MARKER}`
      .execute(internal.db)
      .catch(() => undefined);
    await internal.close().catch(() => undefined);
  });

  it('walks every row exactly once across pages, even when a tied row is rewritten mid-pagination', async () => {
    const s = createFacilityRegistryStore(internal.db);
    // Scoped through the GRAMMAR filter on `name`, not the `nationalSystem` named param, and that
    // is load-bearing for the mutation check rather than incidental. `nationalSystem` renders as
    // `facility_system = $1`, which the partial unique index on `(facility_system, facility_code)`
    // serves — the rows would then arrive at the sort already in `facility_code` order and the
    // perturbation below could not disturb them, the exact "rode an index the mutation could not
    // reach" failure this repo has shipped before. The grammar's `eq` renders as
    // `coalesce(name::text, '') = $1`, which no index can serve, so the scan is over the heap and
    // physical row order is what feeds the sort.
    const fetchPage = (offset: number) =>
      s
        .list({
          filters: [{ column: 'name', operator: 'eq', value: SHARED_NAME, combine: 'and' }],
          sorts: [{ column: 'name', ascending: true }],
          limit: 10,
          offset,
        })
        .then((r) => r.rows.map((row) => row.id));

    const seen: string[] = [];
    seen.push(...(await fetchPage(0)));

    // A row already shown on page 0 is rewritten (delete + insert, as a keyed upsert commonly
    // does) before page 1 is fetched: same id, same tied name, new physical position. This is what
    // an ordinary correction to an already-paginated row looks like on a live table. Every sort key
    // here is identical, so the tiebreaker is the only thing standing between that write and a
    // facility that appears on two pages while another appears on none.
    const movedId = seen[3]!;
    await internal.db.deleteFrom('facility_registry').where('id', '=', movedId).execute();
    await internal.db
      .insertInto('facility_registry')
      .values({
        id: movedId,
        name: SHARED_NAME,
        facility_code: `LC-P-moved`,
        facility_system: PAGE_MARKER,
        source: 'manual',
      } as never)
      .execute();

    for (const offset of [10, 20, 30]) {
      seen.push(...(await fetchPage(offset)));
    }

    expect(seen.length).toBe(40);
    expect(new Set(seen).size).toBe(40); // no facility on two pages, none unreachable
  });
});


// ⛔ THE GAP THIS CLOSES, named in the table-query arc's own post-mortem: "no test anywhere runs a
// filter the UI can build, through the route, to real Postgres. Task tests stop at pg-mem, a fake
// context, or a mocked api client." Both slices that shipped on this grammar shipped a filter
// returning ZERO rows for every value a user could pick, and both were caught by review rather than
// by a test.
//
// A read that quietly matches nothing is a bad afternoon. A DELETE scoped by the same predicate is
// a destroyed register — in either direction, since a predicate that silently drops its clause
// matches EVERYTHING. So the bulk-delete selection is proven here, on real Postgres, against values
// shaped like the ones the toolbar actually emits.
//
// pg-mem cannot stand in: `applyFilters` puts `like`/`ilike` and enum/text comparisons over the
// same columns the collation block above proves pg-mem mishandles, and the store tests can only
// show `list` and `idsMatching` agreeing with each other, not that either is right about Postgres.
live('facility bulk-delete selection (live Postgres — the filter that scopes a DELETE)', () => {
  let internal: InternalDb;
  let store: ReturnType<typeof createFacilityRegistryStore>;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    store = createFacilityRegistryStore(internal.db as never);
    await sql`delete from facility_registry where facility_system = ${BULK_MARKER}`.execute(internal.db);
    await internal.db
      .insertInto('facility_registry')
      .values([
        { id: 'live-b-1', name: 'Kalabo Rural Health Centre', facility_code: 'LB-1', facility_system: BULK_MARKER, source: 'import', district: 'Kalabo', status: 'Functional' },
        { id: 'live-b-2', name: 'Kalabo Urban Clinic', facility_code: 'LB-2', facility_system: BULK_MARKER, source: 'import', district: 'Kalabo', status: 'Functional' },
        { id: 'live-b-3', name: 'Lusaka Central Hospital', facility_code: 'LB-3', facility_system: BULK_MARKER, source: 'import', district: 'Lusaka', status: 'Functional' },
        { id: 'live-b-4', name: 'Lusaka Annex', facility_code: 'LB-4', facility_system: BULK_MARKER, source: 'manual', district: 'Lusaka', status: 'Non-Functional' },
      ] as never)
      .execute();
  });

  afterAll(async () => {
    if (!internal) return;
    await sql`delete from facility_registry where facility_system = ${BULK_MARKER}`
      .execute(internal.db)
      .catch(() => undefined);
    await internal.close().catch(() => undefined);
  });

  /** Every case runs the SAME options through both paths and demands they agree AND that the set is
   *  the expected one. Agreement alone would pass if both were wrong together, which is precisely
   *  how the Status-picker defect survived: the page and its count agreed on zero. */
  async function bothWays(opts: Parameters<typeof store.list>[0]) {
    const listed = await store.list({ ...opts, limit: 1000 });
    const ids = await store.idsMatching(opts);
    expect(ids.map((r) => r.id).sort()).toEqual(listed.rows.map((r) => r.id).sort());
    return ids.map((r) => r.id).sort();
  }

  it('a status value as the REGISTER stores it, not as the value set spells it', async () => {
    // The exact defect from slice C: the picker offered `active` while imports store `Functional`,
    // so the filter matched nothing. Both spellings are asserted, so a fix that merely swapped one
    // hardcoded value for another cannot pass.
    expect(await bothWays({ nationalSystem: BULK_MARKER, status: 'Functional' }))
      .toEqual(['live-b-1', 'live-b-2', 'live-b-3']);
    expect(await bothWays({ nationalSystem: BULK_MARKER, status: 'active' })).toEqual([]);
  });

  it('a grammar filter over an admin column, as the toolbar emits it', async () => {
    expect(await bothWays({
      nationalSystem: BULK_MARKER,
      filters: [{ column: 'district', operator: 'eq', value: 'Kalabo', combine: 'and' }],
    } as never)).toEqual(['live-b-1', 'live-b-2']);
  });

  it('a `like` filter, which pg-mem and Postgres do not treat identically', async () => {
    expect(await bothWays({
      nationalSystem: BULK_MARKER,
      filters: [{ column: 'name', operator: 'like', value: 'Lusaka', combine: 'and' }],
    } as never)).toEqual(['live-b-3', 'live-b-4']);
  });

  it('named and grammar filters AND together, narrowing rather than widening', async () => {
    // ⛔ The fail-OPEN direction. A predicate that dropped one of the two clauses would return a
    // superset here, and for a DELETE a superset is the whole point of the test.
    expect(await bothWays({
      nationalSystem: BULK_MARKER,
      source: 'import',
      filters: [{ column: 'district', operator: 'eq', value: 'Lusaka', combine: 'and' }],
    } as never)).toEqual(['live-b-3']);
  });

  it('a filter matching nothing selects nothing, and never everything', async () => {
    expect(await bothWays({
      nationalSystem: BULK_MARKER,
      filters: [{ column: 'district', operator: 'eq', value: 'Nowhere', combine: 'and' }],
    } as never)).toEqual([]);
  });

  it('removeMany deletes exactly the resolved set and nothing beside it', async () => {
    const doomed = await store.idsMatching({
      nationalSystem: BULK_MARKER,
      filters: [{ column: 'district', operator: 'eq', value: 'Kalabo', combine: 'and' }],
    } as never);
    expect(doomed).toHaveLength(2);

    expect(await store.removeMany(doomed.map((r) => r.id))).toBe(2);

    const left = await store.idsMatching({ nationalSystem: BULK_MARKER });
    expect(left.map((r) => r.id).sort()).toEqual(['live-b-3', 'live-b-4']);
  });
});
