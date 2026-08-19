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
