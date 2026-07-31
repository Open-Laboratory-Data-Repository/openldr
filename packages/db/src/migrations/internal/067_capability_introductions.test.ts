import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { up } from './067_capability_introductions';

async function ledger(db: Awaited<ReturnType<typeof makeMigratedDb>>): Promise<string[]> {
  const rows = await db.selectFrom('capability_introductions').select('capability').execute();
  return (rows as Array<{ capability: string }>).map((r) => r.capability).sort();
}

describe('067_capability_introductions', () => {
  it('seeds every capability key that exists as of 2026-07-31', async () => {
    const db = await makeMigratedDb();
    const keys = await ledger(db);

    expect(keys).toHaveLength(38);
    expect(keys).toContain('data_exposure.manage');
    expect(keys).toContain('forms.submit');
    expect(keys).toContain('audit.view');
  });

  // The ledger is read on every boot; a re-run must not violate the primary key.
  it('is idempotent', async () => {
    const db = await makeMigratedDb();
    await up(db);
    await up(db);

    expect(await ledger(db)).toHaveLength(38);
  });

  // The whole safety argument rests on this: the ledger says "this key has existed", so a
  // reconciler must never treat data_exposure.manage as brand-new on an upgraded install.
  it('records data_exposure.manage even though no role may hold it', async () => {
    const db = await makeMigratedDb();
    const row = await db
      .selectFrom('capability_introductions')
      .select('capability')
      .where('capability', '=', 'data_exposure.manage')
      .executeTakeFirst();

    expect(row).toBeDefined();
  });
});
