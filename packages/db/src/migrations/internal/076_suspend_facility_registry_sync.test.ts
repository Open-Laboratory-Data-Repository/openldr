import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up } from './076_suspend_facility_registry_sync';

describe('076 suspend facility_registry sync', () => {
  it('deletes logged facility_registry rows and leaves every other entity type untouched', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('reference_change_log').values([
      { entity_type: 'facility_registry', entity_id: 'fac-1', op: 'upsert', content_hash: 'h1' },
      { entity_type: 'facility_registry', entity_id: 'fac-2', op: 'delete', content_hash: null },
      { entity_type: 'form', entity_id: 'form-1', op: 'upsert', content_hash: 'h2' },
    ] as never).execute();

    await up(db as never);

    const rows = await db.selectFrom('reference_change_log').select(['entity_type', 'entity_id']).execute();
    expect(rows).toEqual([{ entity_type: 'form', entity_id: 'form-1' }]);
    await db.destroy();
  });

  it('writes no new rows — a change_log insert from a migration perturbs every site pendingPush baseline', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('reference_change_log').values(
      { entity_type: 'form', entity_id: 'form-1', op: 'upsert', content_hash: 'h' } as never,
    ).execute();
    const before = await db.selectFrom('reference_change_log').select('seq').execute();

    await up(db as never);

    const after = await db.selectFrom('reference_change_log').select('seq').execute();
    expect(after).toEqual(before);
    await db.destroy();
  });
});
