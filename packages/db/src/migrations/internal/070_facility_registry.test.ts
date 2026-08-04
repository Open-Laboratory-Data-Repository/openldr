import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('070_facility_registry', () => {
  it('creates a registry row identified by a local code alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f1', local_code: 'LAB01', name: 'Bahebe Health Laboratory', source: 'manual',
    } as never).execute();
    const row = await db.selectFrom('facility_registry' as never).selectAll().executeTakeFirstOrThrow();
    expect((row as any).local_code).toBe('LAB01');
    expect((row as any).national_code).toBeNull();
    // NULL managed_origin means lab-local — the existing convention from migration 048.
    expect((row as any).managed_origin).toBeNull();
    expect((row as any).extras).toEqual({});
  });

  it('creates a registry row identified by a national code alone', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f2', national_system: 'urn:tz:hfr', national_code: '122023-5',
      name: 'BAHEBE HEALTH LABORATORY', source: 'import', managed_origin: 'central',
    } as never).execute();
    const row = await db.selectFrom('facility_registry' as never).selectAll().executeTakeFirstOrThrow();
    expect((row as any).local_code).toBeNull();
    expect((row as any).national_code).toBe('122023-5');
  });

  it('REJECTS a row carrying neither code — a facility must be identifiable somehow', async () => {
    const db = await makeMigratedDb();
    await expect(db.insertInto('facility_registry' as never).values({
      id: 'f3', name: 'Nameless', source: 'manual',
    } as never).execute()).rejects.toThrow();
  });

  it('resolves many aliases to one facility, but one alias to only one facility', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('facility_registry' as never).values({
      id: 'f1', local_code: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual',
    } as never).execute();
    // Two different feeds, two codes, one facility — the multi-LIS case.
    await db.insertInto('facility_aliases' as never).values([
      { source_system: 'lis-a', source_code: 'DOD01', registry_id: 'f1' },
      { source_system: 'urn:openldr:cdr:performer', source_code: 'Dodoma', registry_id: 'f1' },
    ] as never).execute();
    const rows = await db.selectFrom('facility_aliases' as never).selectAll().execute();
    expect(rows).toHaveLength(2);
    // The SAME (source_system, source_code) cannot mean two facilities.
    await expect(db.insertInto('facility_aliases' as never).values(
      { source_system: 'lis-a', source_code: 'DOD01', registry_id: 'f1' } as never,
    ).execute()).rejects.toThrow();
  });
});
