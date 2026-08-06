import { describe, expect, it } from 'vitest';
import { makeMigratedDb } from './test-helpers';
import { FACILITY_REGISTRY_SYSTEM, DEFAULT_OBSERVED_FACILITY_SYSTEM } from '../../facility-observed';

describe('075 facility registry coding system', () => {
  // ⛔ THE trap, mirroring `publishRegistryConcepts`'s own equivalent test: must fail if the row is
  // merely present but inactive, not only if it is absent.
  it('seeds an ACTIVE coding_systems row for the facility registry on a fresh migrate', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('coding_systems').selectAll()
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).executeTakeFirst();
    expect(row).not.toBeUndefined();
    expect(row!.active).toBe(true);
    expect(row!.id).toBe('cs-url-FACILITY-REGISTRY');
    await db.destroy();
  });

  // Guards the deliberate asymmetry: the observed (site) dictionary must NEVER be shipped as a
  // product default, unlike the registry projection above.
  it('does NOT seed the observed facility dictionary (urn:openldr:default_fac)', async () => {
    const db = await makeMigratedDb();
    const row = await db.selectFrom('coding_systems').selectAll()
      .where('url', '=', DEFAULT_OBSERVED_FACILITY_SYSTEM).executeTakeFirst();
    expect(row).toBeUndefined();
    await db.destroy();
  });

  it('is idempotent across a re-run of up()', async () => {
    const db = await makeMigratedDb();
    const before = await db.selectFrom('coding_systems').select('id')
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
    const { internalMigrations } = await import('./index');
    await internalMigrations['075_facility_registry_coding_system']!.up(db as never);
    const after = await db.selectFrom('coding_systems').select('id')
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();
    expect(after.length).toBe(before.length);
    expect(after.length).toBe(1);
    await db.destroy();
  });

  it('does not clobber a deliberate deactivation left by an operator before this migration ran', async () => {
    const db = await makeMigratedDb();
    await db.updateTable('coding_systems').set({ active: false })
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).execute();

    const { internalMigrations } = await import('./index');
    await internalMigrations['075_facility_registry_coding_system']!.up(db as never);

    const row = await db.selectFrom('coding_systems').selectAll()
      .where('url', '=', FACILITY_REGISTRY_SYSTEM).executeTakeFirstOrThrow();
    expect(row.active).toBe(false);
    await db.destroy();
  });
});
