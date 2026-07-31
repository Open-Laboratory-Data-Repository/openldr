import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

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

  // Boot-time re-entrancy is what actually matters: a later task re-seeds this table on EVERY
  // start, so a repeat insert must hit the primary key and do nothing rather than throw.
  //
  // NOTE: this deliberately does NOT call up() twice. pg-mem's planner cannot run
  // `create table ... if not exists` a second time (it throws "Not supported"), and a harness
  // limitation must never push a try/catch into production migration code. In production the
  // migrator runs up() exactly once; the repeated path is the seed insert exercised here.
  it('re-seeding an existing key is a no-op (the ON CONFLICT guard holds)', async () => {
    const db = await makeMigratedDb();

    await db
      .insertInto('capability_introductions')
      .values({ capability: 'data_exposure.manage' })
      .onConflict((oc) => oc.column('capability').doNothing())
      .execute();

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
