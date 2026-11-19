import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createExplorerGroupStore } from './explorer-group-store';

async function world() {
  const db = await makeMigratedDb();
  return { db, store: createExplorerGroupStore(db as never) };
}

describe('explorer group store: groups for Connectors and Datasets (migration 133)', () => {
  it('a_group_can_be_made_empty_and_each_branch_has_its_own_groups', async () => {
    const { db, store } = await world();
    await store.createGroup('dataset', 'Turnaround');
    await store.createGroup('connector', 'Country systems');
    await store.createGroup('connector', 'Turnaround');
    expect(await store.listGroups('dataset')).toEqual(['Turnaround']);
    expect(await store.listGroups('connector')).toEqual(['Country systems', 'Turnaround']);
    await expect(store.createGroup('dataset', 'Turnaround')).rejects.toThrow('name already exists');
    await db.destroy();
  });

  it('moves_an_item_into_a_group_into_a_new_group_and_into_none', async () => {
    const { db, store } = await world();
    await store.createGroup('dataset', 'A');
    await store.setItemGroup('dataset', 'abc', 'A');
    await store.setItemGroup('dataset', 'abd', 'B');
    await store.setItemGroup('dataset', 'abe', null);
    expect(await store.itemGroups('dataset')).toEqual({ abc: 'A', abd: 'B', abe: null });
    expect(await store.listGroups('dataset')).toEqual(['A', 'B']);
    await store.setItemGroup('dataset', 'abc', null);
    expect((await store.itemGroups('dataset')).abc).toBeNull();
    // An emptied group stays.
    expect(await store.listGroups('dataset')).toEqual(['A', 'B']);
    await db.destroy();
  });

  it('renames_a_group_with_its_items_and_removing_one_leaves_its_items_with_no_group', async () => {
    const { db, store } = await world();
    await store.setItemGroup('connector', 'c1', 'Old');
    await store.setItemGroup('connector', 'c2', 'Old');
    await store.createGroup('connector', 'Empty');
    expect(await store.renameGroup('connector', 'Old', 'New')).toBe(2);
    expect(await store.renameGroup('connector', 'Empty', 'Still empty')).toBe(0);
    expect(await store.listGroups('connector')).toEqual(['New', 'Still empty']);
    expect(await store.itemGroups('connector')).toEqual({ c1: 'New', c2: 'New' });
    expect(await store.renameGroup('connector', 'New', null)).toBe(2);
    expect(await store.listGroups('connector')).toEqual(['Still empty']);
    expect(await store.itemGroups('connector')).toEqual({ c1: null, c2: null });
    await db.destroy();
  });

  it('a_rename_onto_a_group_that_exists_joins_the_two', async () => {
    const { db, store } = await world();
    await store.setItemGroup('dataset', 'abc', 'A');
    await store.setItemGroup('dataset', 'abd', 'B');
    await store.renameGroup('dataset', 'A', 'B');
    expect(await store.listGroups('dataset')).toEqual(['B']);
    expect(await store.itemGroups('dataset')).toEqual({ abc: 'B', abd: 'B' });
    await db.destroy();
  });

  it('places_an_item_only_if_it_was_never_placed', async () => {
    const { db, store } = await world();
    await store.placeIfUnplaced('dataset', 'abc', 'reports-zm');
    expect(await store.itemGroups('dataset')).toEqual({ abc: 'reports-zm' });
    await store.setItemGroup('dataset', 'abc', null);
    await store.placeIfUnplaced('dataset', 'abc', 'reports-zm');
    expect((await store.itemGroups('dataset')).abc).toBeNull();
    await store.forgetItem('dataset', 'abc');
    expect(await store.itemGroups('dataset')).toEqual({});
    await db.destroy();
  });
});
