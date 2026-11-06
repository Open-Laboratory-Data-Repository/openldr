import { describe, it, expect, beforeEach } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createCustomQueryStore } from './custom-query-store';
import { createCustomQueryGroupStore } from './custom-query-group-store';

describe('CustomQueryGroupStore', () => {
  let db: Awaited<ReturnType<typeof makeMigratedDb>>;
  beforeEach(async () => { db = await makeMigratedDb(); });

  it('creates, lists by name, renames and gets', async () => {
    const groups = createCustomQueryGroupStore(db);
    await groups.create({ id: 'g2', name: 'Viral load' });
    await groups.create({ id: 'g1', name: 'TB' });
    expect(await groups.list()).toEqual([{ id: 'g1', name: 'TB' }, { id: 'g2', name: 'Viral load' }]);
    await groups.rename('g1', 'Tuberculosis');
    expect(await groups.get('g1')).toEqual({ id: 'g1', name: 'Tuberculosis' });
    expect((await groups.getByName('Viral load'))?.id).toBe('g2');
    expect(await groups.get('nope')).toBeNull();
  });

  it('deleting a group keeps its queries and moves them out of any group', async () => {
    const groups = createCustomQueryGroupStore(db);
    const queries = createCustomQueryStore(db);
    await groups.create({ id: 'g1', name: 'TB' });
    await queries.create({ id: 'q1', name: 'TB LAM', connectorId: 'c', sql: 'select 1', params: [] });
    await queries.setGroup('q1', 'g1');
    expect((await queries.get('q1'))?.groupId).toBe('g1');

    await groups.remove('g1');
    expect(await groups.list()).toEqual([]);
    expect((await queries.get('q1'))?.groupId).toBeNull();
  });
});
