import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInternalDb, type InternalDb } from '@openldr/db';
import { createAuditStore, type AuditStore } from './store';

// pg-mem has a stable scan order and cannot demonstrate ORDER BY tie non-determinism: a pg-mem
// version of this test would pass whether or not the store's tiebreaker actually ran, which is
// a test that cannot fail (AGENTS.md §7). Only real Postgres can show pages repeating or
// skipping rows, so this needs INTERNAL_DATABASE_URL and is skipped cleanly without it — a
// skipped run is not a pass. Modelled on packages/db/src/table-query-pagination.live.test.ts.
const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

// Far enough in the future that no real audit_events row can share it, so these 40 rows always
// sort ahead of everything else under "occurred_at desc" without needing a WHERE filter. A WHERE
// filter on an indexed column (e.g. entity_type) was tried first and rejected: it makes Postgres
// answer the query with an index scan keyed on that column, so the result order is pinned by the
// filter column's index — not by whatever the tiebreaker does — and the mutation below (deleting
// and re-inserting one row) stops being visible at all. No WHERE clause on the paginated query
// itself is what lets "occurred_at desc" alone drive an Index Scan Backward on the occurred_at
// index, where a full tie is broken by physical row order — which the mutation DOES perturb.
const STAMP = new Date('2099-01-01T00:00:00.000Z');
// Unique per run, used only to identify these rows for cleanup — never as a query filter.
const MARKER = `tq-tie-scratch-${randomUUID()}`;

live('audit pagination is stable when the sort key ties (live Postgres)', () => {
  let internal: InternalDb;
  let store: AuditStore;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    store = createAuditStore(internal.db);

    // 40 rows, all sharing one occurred_at AND one actor_name. Two tied columns, not one: the
    // mutation check (see the commit message) temporarily swaps the store's tiebreaker argument
    // from "id" to "actorName" to prove the fix matters — that swap only exposes instability if
    // actorName also ties across every row, otherwise it would coincidentally still be unique.
    for (let i = 0; i < 40; i++) {
      await store.record({
        actorType: 'system',
        actorName: 'same-actor',
        action: 'x.y',
        entityType: MARKER,
        entityId: `e-${String(i).padStart(3, '0')}`,
      });
    }
    await internal.db
      .updateTable('audit_events')
      .set({ occurred_at: STAMP })
      .where('entity_type', '=', MARKER)
      .execute();
  });

  afterAll(async () => {
    await internal.db.deleteFrom('audit_events').where('entity_type', '=', MARKER).execute().catch(() => undefined);
    await internal?.close().catch(() => undefined);
  });

  it('walks every row exactly once across pages, even when a tied row is re-upserted mid-pagination', async () => {
    // No entityType/actorId/etc filter here on purpose — see the STAMP comment above.
    const fetchPage = (offset: number) =>
      store.list({ limit: 10, offset }).then((rows) => rows.map((r) => r.id));

    const seen: string[] = [];
    seen.push(...(await fetchPage(0)));

    // A tied row already shown on page 0 gets re-upserted (delete + insert, as a keyed upsert
    // commonly does) before page 1 is fetched — same id, same tied occurred_at and actor_name,
    // but its physical position in the table moves. This is what an ordinary correction to an
    // already-paginated audit row looks like on a live table: the tiebreaker is the only thing
    // standing between that write and a row that repeats or vanishes across pages.
    const movedId = seen[3]!;
    const movedRow = await internal.db
      .selectFrom('audit_events')
      .select(['id', 'occurred_at', 'actor_type', 'actor_id', 'actor_name', 'action', 'entity_type', 'entity_id'])
      .where('id', '=', movedId)
      .executeTakeFirstOrThrow();
    await internal.db.deleteFrom('audit_events').where('id', '=', movedId).execute();
    await internal.db.insertInto('audit_events').values(movedRow).execute();

    for (const offset of [10, 20, 30]) {
      seen.push(...(await fetchPage(offset)));
    }

    expect(seen.length).toBe(40);
    expect(new Set(seen).size).toBe(40); // no repeats, nothing skipped
  });
});

// I2: nothing else sorts real `audit_events` rows by a text column through AUDIT_COLUMNS. The
// COLLATE "en-US-x-icu" fix (table-query-sql.ts's applySorts) is proven live only against a
// synthetic two-column scratch table in packages/db/src/table-query-collation.live.test.ts — if
// any `sql:` name in AUDIT_COLUMNS (packages/table-query/src/columns.ts) were wrong, the first
// user click on Sort -> Actor/Action would 500 on the real table. This is the only end-to-end
// proof the branch's headline fix works on the table it was written for.
const COLLATION_MARKER = `tq-collation-scratch-${randomUUID()}`;

live('audit sorts a text column with ICU collation, on the real table (live Postgres)', () => {
  let internal: InternalDb;
  let store: AuditStore;

  beforeAll(async () => {
    internal = createInternalDb(url!);
    store = createAuditStore(internal.db);

    // MIXED CASE IS THE POINT (same fixture as table-query-collation.live.test.ts): an
    // all-lowercase set of names would pass with or without the explicit collation.
    const names = ['BETA', 'alpha', 'epsilon'];
    for (const [i, actorName] of names.entries()) {
      await store.record({
        actorType: 'system',
        actorName,
        action: 'x.y',
        entityType: COLLATION_MARKER,
        entityId: `e-${i}`,
      });
    }
  });

  afterAll(async () => {
    await internal.db.deleteFrom('audit_events').where('entity_type', '=', COLLATION_MARKER).execute().catch(() => undefined);
    await internal?.close().catch(() => undefined);
  });

  it("orders actorName the way applyTableState's localeCompare does, not this musl image's byte order", async () => {
    const rows = await store.list({
      entityType: COLLATION_MARKER,
      sorts: [{ column: 'actorName', ascending: true }],
    });
    // ICU: 'alpha' < 'BETA' < 'epsilon'. A bare byte-order ORDER BY on postgres:16-alpine (musl)
    // would instead produce ['BETA', 'alpha', 'epsilon'] — uppercase sorts first.
    expect(rows.map((r) => r.actorName)).toEqual(['alpha', 'BETA', 'epsilon']);
  });
});
