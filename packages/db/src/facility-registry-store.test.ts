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

  it('captures a reference change for central-managed writes', async () => {
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
});
