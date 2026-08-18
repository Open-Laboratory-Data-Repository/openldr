import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createInternalDb, type InternalDb } from './internal-db';
import { applySorts } from './table-query-sql';
import type { TableColumnMap } from '@openldr/table-query';

// pg-mem has a stable scan order and cannot demonstrate ORDER BY tie non-determinism: a pg-mem
// version of this test would pass whether or not applySorts appended its tiebreaker, which is a
// test that cannot fail (AGENTS.md §7). Only real Postgres can show pages repeating or skipping
// rows, so this needs INTERNAL_DATABASE_URL and is skipped cleanly without it — a skipped run is
// not a pass.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

const COLUMNS: TableColumnMap = {
  id: { sql: 'id', type: 'text', operators: ['eq'], sortable: true },
  occurredAt: { sql: 'occurred_at', type: 'date', operators: ['eq'], sortable: true },
};

const TABLE = 'tq_tie_scratch';
const STAMP = '2026-08-18T12:00:00Z';

live('pagination is stable when the sort key ties (live Postgres)', () => {
  let internal: InternalDb;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    // A previous run that died before its own cleanup must not fail this one — drop first,
    // unconditionally, then create fresh.
    await sql`drop table if exists ${sql.ref(TABLE)}`.execute(internal.db as never);
    await sql`
      create table ${sql.ref(TABLE)} (
        id text primary key,
        occurred_at timestamptz not null
      )
    `.execute(internal.db as never);

    // 40 rows, ALL sharing one occurred_at. With no tiebreaker, ORDER BY occurred_at alone has
    // nothing to break the tie with, and Postgres is free to order tied rows however its scan
    // happens to visit them.
    await (internal.db as never as import('kysely').Kysely<any>)
      .insertInto(TABLE)
      .values(
        Array.from({ length: 40 }, (_, i) => ({
          id: `id-${String(i).padStart(3, '0')}`,
          occurred_at: STAMP,
        })),
      )
      .execute();
  });

  afterAll(async () => {
    await sql`drop table if exists ${sql.ref(TABLE)}`.execute(internal.db as never).catch(() => undefined);
    await internal?.close().catch(() => undefined);
  });

  it('walks every row exactly once across pages, even when a tied row is re-upserted mid-pagination', async () => {
    const db = internal.db as never as import('kysely').Kysely<any>;
    const fetchPage = (offset: number) =>
      applySorts(
        db.selectFrom(TABLE).select('id'),
        [{ column: 'occurredAt', ascending: false }],
        COLUMNS,
        'id',
      )
        .limit(10)
        .offset(offset)
        .execute()
        .then((rows: { id: string }[]) => rows.map((r) => r.id));

    const seen: string[] = [];
    seen.push(...(await fetchPage(0)));

    // A tied row already shown on page 0 gets re-upserted (delete + insert, as a keyed upsert
    // commonly does) before page 1 is fetched — same id, same tied timestamp, but its physical
    // position in the table moves. This is what an ordinary correction to an already-paginated
    // row looks like on a live table: the tiebreaker is the only thing standing between that
    // write and a row that repeats or vanishes across pages.
    const movedId = seen[3]!;
    await db.deleteFrom(TABLE).where('id', '=', movedId).execute();
    await db.insertInto(TABLE).values({ id: movedId, occurred_at: STAMP }).execute();

    for (const offset of [10, 20, 30]) {
      seen.push(...(await fetchPage(offset)));
    }

    expect(seen.length).toBe(40);
    expect(new Set(seen).size).toBe(40); // no repeats, nothing skipped
  });
});
