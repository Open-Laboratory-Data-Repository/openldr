import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFacilityRegistryStore } from './facility-registry-store';

async function store() {
  const db = await makeMigratedDb();
  return { db, s: createFacilityRegistryStore(db as never) };
}

const manual = { id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral', source: 'manual' as const };

describe('createFacilityRegistryStore', () => {
  it('round-trips a hand-entered facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    expect(await s.get('f1')).toMatchObject({ id: 'f1', localCode: 'LAB01', name: 'Dodoma Regional Referral' });
  });

  it('resolves an observed feed code to the facility it was attached to', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.attachAlias({ sourceSystem: 'urn:openldr:cdr:performer', sourceCode: 'Dodoma', registryId: 'f1' });
    expect(await s.resolve('urn:openldr:cdr:performer', 'Dodoma')).toMatchObject({ id: 'f1' });
    expect(await s.resolve('urn:openldr:cdr:performer', 'Mnazi Mmoja')).toBeUndefined();
  });

  it('stores an observed string EXACTLY as it arrived, truncation included', async () => {
    // The 30-char truncation is a match key, not a name. Never normalise it.
    const { s } = await store();
    await s.upsert(manual);
    const truncated = 'International School of Tangan';
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: truncated, registryId: 'f1' });
    expect(await s.resolve('cdr', truncated)).toMatchObject({ id: 'f1' });
    expect(await s.resolve('cdr', 'International School of Tanganyika')).toBeUndefined();
  });

  it('is idempotent: re-attaching the same alias is a no-op, not a duplicate', async () => {
    const { s } = await store();
    await s.upsert(manual);
    const a = { sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' };
    await s.attachAlias(a);
    await s.attachAlias(a);
    expect(await s.listAliases('f1')).toHaveLength(1);
  });

  it('re-points an alias when it is attached to a different facility', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Muhimbili', source: 'manual' });
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f2' });
    expect(await s.resolve('cdr', 'Dodoma')).toMatchObject({ id: 'f2' });
    expect(await s.listAliases('f1')).toHaveLength(0);
  });

  it('upsert updates in place, so aliases survive a rename', async () => {
    const { s } = await store();
    await s.upsert(manual);
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.upsert({ ...manual, name: 'Dodoma Regional Referral Hospital' });
    expect(await s.get('f1')).toMatchObject({ name: 'Dodoma Regional Referral Hospital' });
    expect(await s.listAliases('f1')).toHaveLength(1);
  });

  it('captures a reference change on registry writes — unconditionally, not filtered by managedOrigin', async () => {
    const { db } = await store();
    const seen: { entityType: string; entityId: string; op: string }[] = [];
    const s = createFacilityRegistryStore(db as never, {
      record: async (_trx, entityType, entityId, op) => { seen.push({ entityType, entityId, op }); },
    });
    await s.upsert({ id: 'f9', nationalSystem: 'urn:tz:hfr', nationalCode: '122023-5', name: 'Bahebe', source: 'import' });
    await s.remove('f9');
    expect(seen).toEqual([
      { entityType: 'facility_registry', entityId: 'f9', op: 'upsert' },
      { entityType: 'facility_registry', entityId: 'f9', op: 'delete' },
    ]);
  });

  it('does NOT capture alias writes — aliases are lab-local and must never sync', async () => {
    // An alias maps ONE lab's feed codes; it is meaningless at central and actively wrong at another
    // lab whose identical local code means a different facility.
    const { db } = await store();
    const seen: string[] = [];
    const s = createFacilityRegistryStore(db as never, {
      record: async (_trx, entityType) => { seen.push(entityType); },
    });
    await s.upsert(manual);
    seen.length = 0;
    await s.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: 'f1' });
    await s.detachAlias('cdr', 'Dodoma');
    expect(seen).toEqual([]);
  });

  it('round-trips extras through the store', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, extras: { catchmentPop: 42000, tier: 'referral' } });
    expect(await s.get('f1')).toMatchObject({ extras: { catchmentPop: 42000, tier: 'referral' } });
  });

  it('filters the list by region and status', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, region: 'Dodoma Region', status: 'Operating' });
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Closed One', source: 'manual', region: 'Dodoma Region', status: 'Closed' });
    expect(await s.list({ region: 'Dodoma Region' })).toHaveLength(2);
    expect(await s.list({ region: 'Dodoma Region', status: 'Operating' })).toHaveLength(1);
  });

  it('caps list() at a default of 200 rows when no limit is given — a national register runs 10-15k', async () => {
    const { db, s } = await store();
    const rows = Array.from({ length: 205 }, (_, i) => ({
      id: `f${i}`, local_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual',
    }));
    await db.insertInto('facility_registry' as never).values(rows as never).execute();
    expect(await s.list()).toHaveLength(200);
    expect(await s.list({ limit: 5 })).toHaveLength(5);
  });

  // --- Task 3: distinctAdminValues ------------------------------------------------------------

  describe('distinctAdminValues', () => {
    it('ranks distinct values by frequency (commonest first), with counts', async () => {
      const { db, s } = await store();
      // Dodoma x3, Kongwa x1, Chamwino x2 — the ranking must be Dodoma(3), Chamwino(2), Kongwa(1),
      // NOT insertion order and NOT alphabetical.
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: 'Dodoma' },
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', district: 'Dodoma' },
        { id: 'f4', local_code: 'LAB4', name: 'D', source: 'manual', district: 'Kongwa' },
        { id: 'f5', local_code: 'LAB5', name: 'E', source: 'manual', district: 'Chamwino' },
        { id: 'f6', local_code: 'LAB6', name: 'F', source: 'manual', district: 'Chamwino' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      expect(await s.distinctAdminValues('district')).toEqual([
        { value: 'Dodoma', count: 3 },
        { value: 'Chamwino', count: 2 },
        { value: 'Kongwa', count: 1 },
      ]);
    });

    it('scopes by the parent level already chosen (e.g. districts filtered by region)', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', region: 'Dodoma Region', district: 'Kongwa' },
        // Same district NAME, different region — must NOT bleed into the Dodoma-region result.
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', region: 'Mbeya Region', district: 'Dodoma' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      const result = await s.distinctAdminValues('district', { region: 'Dodoma Region' });
      expect(result.map((r) => r.value).sort()).toEqual(['Dodoma', 'Kongwa']);
      expect(result.find((r) => r.value === 'Dodoma')?.count).toBe(1);
    });

    it('an absent or blank scope value means unfiltered for that level, not "match empty string"', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', region: 'Dodoma Region', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', region: 'Mbeya Region', district: 'Mbeya' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      // No scope at all.
      expect((await s.distinctAdminValues('district')).map((r) => r.value).sort()).toEqual(['Dodoma', 'Mbeya']);
      // Explicit but blank scope value — must behave the same as omitting it, never match `region = ''`.
      expect((await s.distinctAdminValues('district', { region: '' })).map((r) => r.value).sort()).toEqual(['Dodoma', 'Mbeya']);
    });

    it('excludes NULL and blank values — they are not suggestions', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: null },
        { id: 'f3', local_code: 'LAB3', name: 'C', source: 'manual', district: '' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      expect(await s.distinctAdminValues('district')).toEqual([{ value: 'Dodoma', count: 1 }]);
    });

    it('never treats a scope entry for the requested level itself as a filter', async () => {
      const { db, s } = await store();
      const rows = [
        { id: 'f1', local_code: 'LAB1', name: 'A', source: 'manual', district: 'Dodoma' },
        { id: 'f2', local_code: 'LAB2', name: 'B', source: 'manual', district: 'Kongwa' },
      ];
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      // scope.district is nonsensical when level === 'district'; it must be ignored, not applied
      // as `WHERE district = 'Dodoma'` (which would silently collapse the result to one row).
      const result = await s.distinctAdminValues('district', { district: 'Dodoma' } as never);
      expect(result.map((r) => r.value).sort()).toEqual(['Dodoma', 'Kongwa']);
    });

    it('caps the number of distinct values returned', async () => {
      const { db, s } = await store();
      const rows = Array.from({ length: 1005 }, (_, i) => ({
        id: `f${i}`, local_code: `LAB${i}`, name: `Facility ${i}`, source: 'manual', zone: `Zone ${i}`,
      }));
      await db.insertInto('facility_registry' as never).values(rows as never).execute();
      const result = await s.distinctAdminValues('zone');
      expect(result.length).toBeLessThanOrEqual(1000);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
