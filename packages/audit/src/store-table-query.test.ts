import { describe, it, expect } from 'vitest';
import { type Kysely } from 'kysely';
import { newDb } from 'pg-mem';
import { internalMigrations, type InternalSchema } from '@openldr/db';
import { createAuditStore, type AuditStore } from './store';

async function makeDb(): Promise<Kysely<InternalSchema>> {
  const mem = newDb();
  const db = mem.adapters.createKysely() as Kysely<InternalSchema>;
  for (const migration of Object.values(internalMigrations)) {
    await migration.up(db);
  }
  return db;
}

async function seed(db: Kysely<InternalSchema>, store: AuditStore) {
  const rows = [
    { actorType: 'user' as const, actorId: 'u1', actorName: 'ann', action: 'form.create', entityType: 'form', entityId: 'f1' },
    { actorType: 'user' as const, actorId: 'u2', actorName: 'bob', action: 'form.delete', entityType: 'form', entityId: 'f2' },
    { actorType: 'cli' as const, actorId: null, actorName: 'cli', action: 'user.create', entityType: 'user', entityId: 'u9' },
  ];
  for (const [i, row] of rows.entries()) {
    const event = await store.record(row);
    // Pin occurred_at to a distinct, monotonically increasing instant per row so the
    // "explicit sort" and "default newest-first" assertions below don't depend on how fast
    // pg-mem's clock ticks between inserts.
    await db
      .updateTable('audit_events')
      .set({ occurred_at: new Date(Date.UTC(2026, 0, 1, 0, i)) })
      .where('id', '=', event.id)
      .execute();
  }
}

// Three rows spread across two calendar days, so an "eq"/"between" date filter has both a day to
// match and a day to exclude. Nothing before this test ran a date *filter* against a database —
// table-query-sql.test.ts's coverage is filter-only on text/number columns, and the sort tests
// here use occurredAt only as a sort key, never as a filter value. C1: `occurred_at` renders as
// `2026-01-01 01:18:19.491000+00`, which a bare `= '2026-01-01'` (or `between` against that
// literal) can never match — this is the exact shape the DatePicker sends.
async function seedAcrossDays(db: Kysely<InternalSchema>, store: AuditStore) {
  const rows: { actorType: 'user' | 'cli'; actorId: string | null; actorName: string; action: string; entityType: string; entityId: string }[] = [
    { actorType: 'user', actorId: 'u1', actorName: 'ann', action: 'form.create', entityType: 'form', entityId: 'day1-early' },
    { actorType: 'user', actorId: 'u2', actorName: 'bob', action: 'form.delete', entityType: 'form', entityId: 'day1-late' },
    { actorType: 'cli', actorId: null, actorName: 'cli', action: 'user.create', entityType: 'user', entityId: 'day2-midnight' },
  ];
  const stamps = [
    new Date(Date.UTC(2026, 0, 1, 1, 18, 19, 491)), // 2026-01-01 01:18:19.491 — just after midnight
    new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)), // 2026-01-01 23:59:59.999 — just before midnight
    new Date(Date.UTC(2026, 0, 2, 0, 0, 0, 0)), // 2026-01-02 00:00:00.000 — the very next day
  ];
  for (const [i, row] of rows.entries()) {
    const event = await store.record(row);
    await db.updateTable('audit_events').set({ occurred_at: stamps[i] }).where('id', '=', event.id).execute();
  }
}

describe('audit store: day-aware date filters (C1)', () => {
  it('"eq" on a date-only value matches every row on that day, not just literal midnight', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seedAcrossDays(db, store);
    const rows = await store.list({
      filters: [{ column: 'occurredAt', operator: 'eq', value: '2026-01-01', combine: 'and' }],
    });
    expect(rows.map((r) => r.entityId).sort()).toEqual(['day1-early', 'day1-late']);
  });

  it('"ne" on a date-only value excludes that whole day', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seedAcrossDays(db, store);
    const rows = await store.list({
      filters: [{ column: 'occurredAt', operator: 'ne', value: '2026-01-01', combine: 'and' }],
    });
    expect(rows.map((r) => r.entityId)).toEqual(['day2-midnight']);
  });

  it('"between" on two date-only values includes the end day in full', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seedAcrossDays(db, store);
    const rows = await store.list({
      filters: [{ column: 'occurredAt', operator: 'between', value: ['2026-01-01', '2026-01-01'], combine: 'and' }],
    });
    expect(rows.map((r) => r.entityId).sort()).toEqual(['day1-early', 'day1-late']);
  });
});

describe('audit store with grammar filters', () => {
  it('applies a grammar filter', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seed(db, store);
    const rows = await store.list({ filters: [{ column: 'action', operator: 'like', value: 'form.', combine: 'and' }] });
    expect(rows.map((r) => r.entityId).sort()).toEqual(['f1', 'f2']);
  });

  it('ANDs a grammar filter with the existing named params', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seed(db, store);
    const rows = await store.list({
      entityType: 'form',
      filters: [{ column: 'action', operator: 'eq', value: 'form.delete', combine: 'and' }],
    });
    expect(rows.map((r) => r.entityId)).toEqual(['f2']);
  });

  it('counts with the same filters as list', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seed(db, store);
    const filters = [{ column: 'action', operator: 'like' as const, value: 'form.', combine: 'and' as const }];
    expect(await store.count({ filters })).toBe((await store.list({ filters })).length);
  });

  it('keeps newest-first when the caller sends no sort', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seed(db, store);
    const rows = await store.list({});
    const times = rows.map((r) => r.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  // Sorts on "occurredAt" rather than "action": occurredAt is a date column, which applySorts
  // never collates, so this stays runnable under pg-mem. A text column here (e.g. "action")
  // would hit applySorts' explicit COLLATE "en-US-x-icu" — correct for real Postgres, but pg-mem's
  // parser cannot parse COLLATE at all. That case is covered on live Postgres instead, in
  // packages/db/src/table-query-collation.live.test.ts.
  it('honours an explicit sort instead of the default', async () => {
    const db = await makeDb();
    const store = createAuditStore(db);
    await seed(db, store);
    const rows = await store.list({ sorts: [{ column: 'occurredAt', ascending: true }] });
    expect(rows.map((r) => r.entityId)).toEqual(['f1', 'f2', 'u9']);
  });
});
