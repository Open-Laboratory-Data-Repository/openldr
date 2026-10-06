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

  it('marks the observed-facility systems by the names their writers use', async () => {
    const { down, up } = await import('./109_coding_system_origin');
    const db = await makeMigratedDb();
    await down(db);
    await db.insertInto('coding_systems').values([
      { id: 'cs-obs', system_code: 'URN_TEST_LAB', system_name: 'Observed facilities', url: 'urn:test:lab' },
      { id: 'cs-lvl', system_code: 'FAC-LEVEL-OBSERVED', system_name: 'Observed facility level values', url: 'urn:test:lvl' },
      { id: 'cs-oth', system_code: 'OTHER', system_name: 'Other', url: 'urn:test:oth' },
    ] as never).execute();
    await up(db);
    const rows = await db.selectFrom('coding_systems').select(['id', 'origin']).where('id', 'in', ['cs-obs', 'cs-lvl', 'cs-oth']).orderBy('id').execute();
    expect(rows).toEqual([
      { id: 'cs-lvl', origin: 'import' },
      { id: 'cs-obs', origin: 'ingest' },
      { id: 'cs-oth', origin: null },
    ]);
  });
});
