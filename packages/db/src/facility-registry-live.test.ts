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
// marker before and after itself, so a run that dies mid-way cannot poison the next one or leave
// rows behind in a developer's database.
const COLLATE_MARKER = 'urn:openldr:test:facility-live-collate';
const PAGE_MARKER = 'urn:openldr:test:facility-live-page';

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
    await sql`delete from facility_registry where facility_system = ${COLLATE_MARKER}`
      .execute(internal.db)
      .catch(() => undefined);
    await internal?.close().catch(() => undefined);
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
    await sql`delete from facility_registry where facility_system = ${PAGE_MARKER}`
      .execute(internal.db)
      .catch(() => undefined);
    await internal?.close().catch(() => undefined);
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
