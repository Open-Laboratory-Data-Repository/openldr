import { describe, it, expect } from 'vitest';
import { createAuditStore, type AuditStore } from './store';
import { makeMigratedDb as makeDb } from './test-db';

async function seed(store: AuditStore) {
  await store.record({ actorType: 'user', actorId: 'u1', actorName: 'ann', action: 'form.create', entityType: 'form', entityId: 'f1' });
  await store.record({ actorType: 'user', actorId: 'u2', actorName: 'bob', action: 'form.delete', entityType: 'form', entityId: 'f2' });
  await store.record({ actorType: 'cli', actorId: null, actorName: 'cli', action: 'user.create', entityType: 'user', entityId: 'u9' });
}

describe('audit store with grammar filters', () => {
  it('applies a grammar filter', async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({ filters: [{ column: 'action', operator: 'like', value: 'form.', combine: 'and' }] });
    expect(rows.map((r) => r.entityId).sort()).toEqual(['f1', 'f2']);
  });

  it('ANDs a grammar filter with the existing named params', async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({
      entityType: 'form',
      filters: [{ column: 'action', operator: 'eq', value: 'form.delete', combine: 'and' }],
    });
    expect(rows.map((r) => r.entityId)).toEqual(['f2']);
  });

  it('counts with the same filters as list', async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const filters = [{ column: 'action', operator: 'like' as const, value: 'form.', combine: 'and' as const }];
    expect(await store.count({ filters })).toBe((await store.list({ filters })).length);
  });

  it('keeps newest-first when the caller sends no sort', async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({});
    const times = rows.map((r) => r.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('honours an explicit sort instead of the default', async () => {
    const store = createAuditStore(await makeDb());
    await seed(store);
    const rows = await store.list({ sorts: [{ column: 'action', ascending: true }] });
    expect(rows.map((r) => r.action)).toEqual(['form.create', 'form.delete', 'user.create']);
  });
});
