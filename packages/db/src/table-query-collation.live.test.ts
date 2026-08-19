import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createInternalDb, type InternalDb } from './internal-db';
import { applySorts } from './table-query-sql';
import type { TableColumnMap } from '@openldr/table-query';

// pg-mem has no ICU and cannot demonstrate collation-dependent ordering at all — a pg-mem version
// of this test would pass or fail on its own scan/parser quirks, not on the thing being proven.
// Only real Postgres shows the musl-vs-glibc/ICU difference, so this needs INTERNAL_DATABASE_URL
// and is skipped cleanly without it — a skipped run is not a pass.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

const COLUMNS: TableColumnMap = {
  id: { sql: 'id', type: 'text', operators: ['eq'], sortable: true },
  name: { sql: 'name', type: 'text', operators: ['eq'], sortable: true },
};

const TABLE = 'tq_coll';

// MIXED CASE IS THE POINT. The existing sort fixture in table-query-sql.test.ts is all-lowercase
// ("a","m","z"), so it passes with or without an explicit collation.
const NAMES = ['', 'BETA', 'alpha', 'epsilon'];

live('text sorts use an explicit ICU collation', () => {
  let internal: InternalDb;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    // A previous run that died before its own cleanup must not fail this one — drop first,
    // unconditionally, then create fresh.
    await sql`drop table if exists ${sql.ref(TABLE)}`.execute(internal.db as never);
    await sql`
      create table ${sql.ref(TABLE)} (
        id text primary key,
        name text
      )
    `.execute(internal.db as never);
    await (internal.db as never as import('kysely').Kysely<any>)
      .insertInto(TABLE)
      .values(NAMES.map((n, i) => ({ id: `id-${i}`, name: n })))
      .execute();
  });

  afterAll(async () => {
    await sql`drop table if exists ${sql.ref(TABLE)}`.execute(internal.db as never).catch(() => undefined);
    await internal?.close().catch(() => undefined);
  });

  it("orders mixed case the way the client's localeCompare does", async () => {
    const db = internal.db as never as import('kysely').Kysely<any>;
    const rows = await applySorts(
      db.selectFrom(TABLE).select('name'),
      [{ column: 'name', ascending: true }],
      COLUMNS,
      'id',
    ).execute();

    // What String.localeCompare produces, and what COLLATE "en-US-x-icu" produces. A bare
    // ORDER BY on this musl-based Postgres image produces byte order instead:
    // ["", "BETA", "alpha", "epsilon"].
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['', 'alpha', 'BETA', 'epsilon']);
  });
});

// Moved here from table-query-sql.test.ts: applySorts now emits `collate "en-US-x-icu"` for
// every text-typed sort/tiebreaker column, and every case below sorts or tie-breaks on "name" or
// "id" (both text). pg-mem's SQL parser (pgsql-ast-parser) does not implement the COLLATE clause
// at all — a hard syntax error, not a semantic gap — so only real Postgres can run these. The
// logic under test (sort order, tiebreaker append/stability, NULLS placement, defaultSorts) is
// unchanged from the original pg-mem versions; only the backing database changed.
const SORT_COLUMNS: TableColumnMap = {
  id: { sql: 'id', type: 'text', operators: ['eq', 'in'], sortable: true },
  name: { sql: 'name', type: 'text', operators: ['eq', 'ne', 'like', 'in', 'is_null', 'is_not_null'], sortable: true },
  weight: { sql: 'weight', type: 'number', operators: ['gt', 'gte', 'lt', 'lte', 'between'], sortable: true },
};
const SORT_TABLE = 'tq_sort_scratch';

async function withSortTable(
  internal: InternalDb,
  rows: { id: string; name: string | null; weight: number }[],
  run: (db: import('kysely').Kysely<any>) => Promise<void>,
) {
  const db = internal.db as never as import('kysely').Kysely<any>;
  await sql`drop table if exists ${sql.ref(SORT_TABLE)}`.execute(internal.db as never);
  await sql`
    create table ${sql.ref(SORT_TABLE)} (
      id text primary key,
      name text,
      weight integer
    )
  `.execute(internal.db as never);
  await db.insertInto(SORT_TABLE).values(rows).execute();
  try {
    await run(db);
  } finally {
    await sql`drop table if exists ${sql.ref(SORT_TABLE)}`.execute(internal.db as never).catch(() => undefined);
  }
}

const DEFAULT_ROWS = [
  { id: '1', name: 'alpha', weight: 10 },
  { id: '2', name: 'BETA', weight: 5 },
  { id: '3', name: null, weight: 1 },
];

live('applySorts (live Postgres — pg-mem cannot parse COLLATE)', () => {
  let internal: InternalDb;

  beforeAll(async () => {
    internal = createInternalDb(url!);
  });

  afterAll(async () => {
    await internal?.close().catch(() => undefined);
  });

  it('applies each sort in order and always appends the tiebreaker', async () =>
    withSortTable(internal, DEFAULT_ROWS, async (db) => {
      const rows = await applySorts(
        db.selectFrom(SORT_TABLE).select(['id']),
        [{ column: 'weight', ascending: true }],
        SORT_COLUMNS,
        'name',
      ).execute();
      // weight asc: row3(1), row2(5), row1(10). "name" tiebreaker only matters on ties, which
      // this data has none of, but must not error and must not change the primary order.
      expect(rows.map((r: any) => r.id)).toEqual(['3', '2', '1']);
    }));

  it('the tiebreaker breaks ties deterministically when the sort key repeats', async () =>
    withSortTable(
      internal,
      [
        { id: 'z', name: 'same', weight: 1 },
        { id: 'a', name: 'same', weight: 1 },
        { id: 'm', name: 'same', weight: 1 },
      ],
      async (db) => {
        const rows = await applySorts(
          db.selectFrom(SORT_TABLE).select(['id']),
          [{ column: 'weight', ascending: true }],
          SORT_COLUMNS,
          'id',
        ).execute();
        expect(rows.map((r: any) => r.id)).toEqual(['a', 'm', 'z']);
      },
    ));

  // applyTableState.ts:18's compareValues puts a null value first regardless of anything else,
  // then applyTableState.ts:112 negates the comparator on descending — so ascending keeps null
  // first, and descending flips it to last. Postgres defaults to the exact opposite in both
  // directions (ASC -> NULLS LAST, DESC -> NULLS FIRST), so applySorts must override that default
  // to match the client, or a nullable column sorts one page in the opposite row order from the
  // other implementation of the same filter set.
  it("sorts NULLS FIRST ascending, matching applyTableState's comparator", async () =>
    withSortTable(internal, DEFAULT_ROWS, async (db) => {
      // row "3" has name === null
      const rows = await applySorts(
        db.selectFrom(SORT_TABLE).select(['id']),
        [{ column: 'name', ascending: true }],
        SORT_COLUMNS,
        'id',
      ).execute();
      expect(rows[0]!.id).toBe('3');
    }));

  it("sorts NULLS LAST descending, matching applyTableState's comparator", async () =>
    withSortTable(internal, DEFAULT_ROWS, async (db) => {
      // row "3" has name === null
      const rows = await applySorts(
        db.selectFrom(SORT_TABLE).select(['id']),
        [{ column: 'name', ascending: false }],
        SORT_COLUMNS,
        'id',
      ).execute();
      expect(rows[rows.length - 1]!.id).toBe('3');
    }));
});

live('applySorts default sorts (live Postgres — pg-mem cannot parse COLLATE)', () => {
  let internal: InternalDb;

  beforeAll(async () => {
    internal = createInternalDb(url!);
  });

  afterAll(async () => {
    await internal?.close().catch(() => undefined);
  });

  const ROWS = [
    { id: '1', name: 'alpha', weight: 10 },
    { id: '2', name: 'beta', weight: 5 },
    { id: '3', name: 'gamma', weight: 1 },
  ];

  it('uses defaultSorts when the caller sends no sort at all', async () =>
    withSortTable(internal, ROWS, async (db) => {
      const rows = await applySorts(
        db.selectFrom(SORT_TABLE).select(['id']),
        [], // caller sent no sort
        SORT_COLUMNS,
        'id',
        [{ column: 'weight', ascending: true }], // default: weight asc
      ).execute();
      expect(rows.map((r: any) => r.id)).toEqual(['3', '2', '1']);
    }));

  it("ignores defaultSorts once the caller supplies any sort of its own", async () =>
    withSortTable(internal, ROWS, async (db) => {
      const rows = await applySorts(
        db.selectFrom(SORT_TABLE).select(['id']),
        [{ column: 'weight', ascending: false }], // explicit: weight desc
        SORT_COLUMNS,
        'id',
        [{ column: 'weight', ascending: true }], // would-be default: weight asc — must be ignored
      ).execute();
      expect(rows.map((r: any) => r.id)).toEqual(['1', '2', '3']);
    }));
});
