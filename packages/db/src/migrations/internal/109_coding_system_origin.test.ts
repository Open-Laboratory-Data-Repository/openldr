import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('109 coding system origin', () => {
  it('adds nullable origin and origin_ref', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('coding_systems').values({
      id: 'cs-109', system_code: 'X109', system_name: 'X', url: 'urn:test:109', origin: 'pack', origin_ref: 'p1',
    } as never).execute();
    await db.insertInto('coding_systems').values({ id: 'cs-109b', system_code: 'Y109', system_name: 'Y', url: 'urn:test:109b' } as never).execute();
    const rows = await db.selectFrom('coding_systems').select(['id', 'origin', 'origin_ref']).where('id', 'in', ['cs-109', 'cs-109b']).orderBy('id').execute();
    expect(rows).toEqual([
      { id: 'cs-109', origin: 'pack', origin_ref: 'p1' },
      { id: 'cs-109b', origin: null, origin_ref: null },
    ]);
  });
});
