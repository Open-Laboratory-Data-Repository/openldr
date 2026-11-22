import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createPackItemStore } from './pack-item-store';

async function world() {
  const db = await makeMigratedDb();
  return { db, store: createPackItemStore(db as never) };
}

describe('pack item store: which content pack made a role, layout or form (migration 135)', () => {
  it('put_then_list_returns_the_item', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'role', key: 'clerk', itemId: 'role-1' });
    expect(await store.list('pack-a')).toEqual([{ packId: 'pack-a', kind: 'role', key: 'clerk', itemId: 'role-1' }]);
    expect(await store.list('pack-b')).toEqual([]);
    await db.destroy();
  });

  it('a_second_put_with_the_same_key_replaces_the_item_id', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'layout', key: 'desk', itemId: 'layout-1' });
    await store.put({ packId: 'pack-a', kind: 'layout', key: 'desk', itemId: 'layout-2' });
    expect(await store.list('pack-a')).toEqual([{ packId: 'pack-a', kind: 'layout', key: 'desk', itemId: 'layout-2' }]);
    await db.destroy();
  });

  it('list_is_ordered_by_kind_then_key', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'role', key: 'b', itemId: 'r2' });
    await store.put({ packId: 'pack-a', kind: 'form', key: 'z', itemId: 'f1' });
    await store.put({ packId: 'pack-a', kind: 'role', key: 'a', itemId: 'r1' });
    expect((await store.list('pack-a')).map((i) => `${i.kind}/${i.key}`)).toEqual(['form/z', 'role/a', 'role/b']);
    await db.destroy();
  });

  it('owners_maps_each_item_id_of_a_kind_to_its_pack', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'role', key: 'clerk', itemId: 'role-1' });
    await store.put({ packId: 'pack-b', kind: 'role', key: 'head', itemId: 'role-2' });
    await store.put({ packId: 'pack-a', kind: 'form', key: 'intake', itemId: 'form-1' });
    expect(await store.owners('role')).toEqual(new Map([['role-1', 'pack-a'], ['role-2', 'pack-b']]));
    expect(await store.owners('layout')).toEqual(new Map());
    await db.destroy();
  });

  it('remove_deletes_one_row_only', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'role', key: 'clerk', itemId: 'role-1' });
    await store.put({ packId: 'pack-a', kind: 'form', key: 'clerk', itemId: 'form-1' });
    await store.put({ packId: 'pack-b', kind: 'role', key: 'clerk', itemId: 'role-2' });
    await store.remove('pack-a', 'role', 'clerk');
    expect(await store.list('pack-a')).toEqual([{ packId: 'pack-a', kind: 'form', key: 'clerk', itemId: 'form-1' }]);
    expect(await store.list('pack-b')).toHaveLength(1);
    await db.destroy();
  });

  it('two_packs_cannot_claim_the_same_item', async () => {
    const { db, store } = await world();
    await store.put({ packId: 'pack-a', kind: 'role', key: 'clerk', itemId: 'role-1' });
    await expect(store.put({ packId: 'pack-b', kind: 'role', key: 'clerk', itemId: 'role-1' })).rejects.toThrow();
    await db.destroy();
  });
});
