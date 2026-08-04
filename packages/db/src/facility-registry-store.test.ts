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

  it('round-trips extras and hashes them independent of jsonb key order', async () => {
    // Part 1: extras really do round-trip through the store with their values intact.
    const { s } = await store();
    await s.upsert({ ...manual, extras: { catchmentPop: 42000, tier: 'referral' } });
    expect(await s.get('f1')).toMatchObject({ extras: { catchmentPop: 42000, tier: 'referral' } });

    // Part 2: the captured content hash is the same for the same extras entries inserted in a
    // different key order. NOTE: Postgres (and pg-mem, faithfully) already canonicalizes jsonb
    // key order in storage — verified empirically: a plain SELECT after INSERT/UPDATE always
    // returns keys sorted, regardless of insertion order — so `hashOf`'s input (the freshly
    // read-back row) is already order-normalized by the time a real store.upsert() reaches it,
    // and a live DB round trip cannot exercise the JSON.stringify-vs-canonicalHash difference.
    // Drive hashOf() through the real store/capture path anyway, using a minimal stand-in `db`
    // that returns a *controlled* stored row (bypassing DB-level canonicalization) so the two
    // captured hashes are genuinely comparing "same content, different literal key order" — the
    // exact case plain JSON.stringify gets wrong and canonicalHash gets right.
    const rowFor = (extras: Record<string, unknown>) => ({
      id: 'f1', local_code: 'LAB01', national_system: null, national_code: null,
      name: 'Dodoma Regional Referral', level: null, ownership: null, status: null,
      country: null, zone: null, region: null, district: null, council: null, ward: null,
      village: null, address_text: null, phone: null, latitude: null, longitude: null,
      managed_origin: null, source: 'manual', extras,
    });
    const stubDb = (row: Record<string, unknown>) => ({
      transaction: () => ({
        execute: async (cb: (trx: unknown) => Promise<unknown>) =>
          cb({
            insertInto: () => ({
              values: () => ({
                onConflict: (fn: (oc: unknown) => unknown) => {
                  fn({ column: () => ({ doUpdateSet: () => ({}) }) });
                  return { execute: async () => {} };
                },
              }),
            }),
            selectFrom: () => ({
              selectAll: () => ({ where: () => ({ executeTakeFirstOrThrow: async () => row }) }),
            }),
          }),
      }),
    });

    let hashA = '';
    const sA = createFacilityRegistryStore(stubDb(rowFor({ catchmentPop: 42000, tier: 'referral' })) as never, {
      record: async (_trx, _entityType, _entityId, _op, contentHash) => { hashA = contentHash as string; },
    });
    await sA.upsert({ ...manual, extras: { catchmentPop: 42000, tier: 'referral' } });

    let hashB = '';
    const sB = createFacilityRegistryStore(stubDb(rowFor({ tier: 'referral', catchmentPop: 42000 })) as never, {
      record: async (_trx, _entityType, _entityId, _op, contentHash) => { hashB = contentHash as string; },
    });
    await sB.upsert({ ...manual, extras: { tier: 'referral', catchmentPop: 42000 } });

    expect(hashA).toBeTruthy();
    expect(hashA).toBe(hashB);
  });

  it('filters the list by region and status', async () => {
    const { s } = await store();
    await s.upsert({ ...manual, region: 'Dodoma Region', status: 'Operating' });
    await s.upsert({ id: 'f2', localCode: 'LAB02', name: 'Closed One', source: 'manual', region: 'Dodoma Region', status: 'Closed' });
    expect(await s.list({ region: 'Dodoma Region' })).toHaveLength(2);
    expect(await s.list({ region: 'Dodoma Region', status: 'Operating' })).toHaveLength(1);
  });
});
