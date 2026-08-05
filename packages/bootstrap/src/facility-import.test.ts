import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from '@openldr/db/testing';
import { createFacilityRegistryStore, referenceCapture, type InternalSchema } from '@openldr/db';
import { importFacilities, type FacilityImportDeps } from './facility-import';

const SYSTEM = 'urn:tz:hfr';

async function buildDeps(): Promise<FacilityImportDeps & { db: Kysely<InternalSchema> }> {
  const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
  return { db, capture: referenceCapture };
}

async function rowFor(db: Kysely<InternalSchema>, nationalCode: string) {
  return db.selectFrom('facility_registry').selectAll().where('national_code', '=', nationalCode).executeTakeFirst();
}

const HEADER = 'national_code,name,level,ownership,status,country,zone,region,district,council,ward,village,address,phone,latitude,longitude';

function csv(rows: string[]): string {
  return [HEADER, ...rows].join('\n') + '\n';
}

describe('importFacilities', () => {
  it('dry-run reports parsed/skipped/unknownColumns and writes nothing', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', ',No Code,,,,,,,,,,,,,,']); // second row missing required national_code
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM });
    expect(result).toEqual({ parsed: 1, skipped: 1, unknownColumns: [], created: 0, updated: 0 });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);
  });

  it('apply inserts new rows and updates existing ones in place; re-import is idempotent on id', async () => {
    const deps = await buildDeps();
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    const r1 = await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    expect(r1).toMatchObject({ parsed: 1, created: 1, updated: 0 });
    const row1 = await rowFor(deps.db, '100');
    expect(row1?.name).toBe('Dodoma Regional Referral');
    const idAfterFirst = row1?.id;

    // Re-import the SAME register unchanged: same national_code+system ⇒ same hashed id, updates in place.
    const r2 = await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    expect(r2).toMatchObject({ parsed: 1, created: 0, updated: 1 });
    const row2 = await rowFor(deps.db, '100');
    expect(row2?.id).toBe(idAfterFirst);

    // A NEW release of the register with a renamed facility (same code) updates in place, not a new row.
    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    const r3 = await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });
    expect(r3).toMatchObject({ created: 0, updated: 1 });
    const row3 = await rowFor(deps.db, '100');
    expect(row3?.id).toBe(idAfterFirst);
    expect(row3?.name).toBe('Dodoma Regional Referral Hospital');

    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(1);
  });

  it('a row already present keeps its id, and its attached facility_aliases survive', async () => {
    const deps = await buildDeps();
    const store = createFacilityRegistryStore(deps.db);
    const first = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, first, { nationalSystem: SYSTEM, apply: true });
    const row = await rowFor(deps.db, '100');
    const id = row!.id;
    await store.attachAlias({ sourceSystem: 'cdr', sourceCode: 'Dodoma', registryId: id });

    const renamed = csv(['100,Dodoma Regional Referral Hospital,,,,,,,,,,,,,,']);
    await importFacilities(deps, renamed, { nationalSystem: SYSTEM, apply: true });

    expect(await store.resolve('cdr', 'Dodoma')).toMatchObject({ id });
    expect(await store.listAliases(id)).toHaveLength(1);
  });

  it('unknown columns block the import unless allowed, then land in extras', async () => {
    const deps = await buildDeps();
    const withExtra = ['national_code,name,beds', '100,Dodoma Regional Referral,250'].join('\n') + '\n';

    const blocked = await importFacilities(deps, withExtra, { nationalSystem: SYSTEM, apply: true });
    expect(blocked).toEqual({ parsed: 0, skipped: 0, unknownColumns: ['beds'], created: 0, updated: 0 });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(0);

    const allowed = await importFacilities(deps, withExtra, { nationalSystem: SYSTEM, allowUnknownColumns: true, apply: true });
    expect(allowed).toMatchObject({ parsed: 1, unknownColumns: ['beds'], created: 1 });
    const row = await rowFor(deps.db, '100');
    expect(row?.extras).toMatchObject({ beds: '250' });
  });

  it('rows missing a required field are counted in skipped, not thrown', async () => {
    const deps = await buildDeps();
    const body = csv([
      '100,Dodoma Regional Referral,,,,,,,,,,,,,,',
      ',Missing Code,,,,,,,,,,,,,,',
      '200,,,,,,,,,,,,,,,',
    ]);
    const result = await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    expect(result).toMatchObject({ parsed: 1, skipped: 2, created: 1 });
  });

  it('a ragged row does not throw', async () => {
    const deps = await buildDeps();
    const body = [HEADER, '100,Dodoma Regional Referral', '200,Muhimbili,,,,,,,,,,,,,,,,,,,,extra,columns,here'].join('\n') + '\n';
    await expect(importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true })).resolves.toMatchObject({ skipped: 0 });
  });

  it('rows absent from the import are NOT deleted', async () => {
    const deps = await buildDeps();
    const store = createFacilityRegistryStore(deps.db);
    await store.upsert({ id: 'manual-1', localCode: 'LAB01', name: 'Hand-entered facility', source: 'manual' });

    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });

    expect(await store.get('manual-1')).toMatchObject({ name: 'Hand-entered facility' });
    expect(await deps.db.selectFrom('facility_registry').selectAll().execute()).toHaveLength(2);
  });

  it('managed_origin is NULL on every imported row', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,', '200,Muhimbili,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const rows = await deps.db.selectFrom('facility_registry').selectAll().execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.managed_origin).toBeNull();
  });

  it('logs a reference_change_log row for a newly created row, and none on an unchanged re-import', async () => {
    const deps = await buildDeps();
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const afterFirst = await deps.db.selectFrom('reference_change_log').selectAll().where('entity_type', '=', 'facility_registry').execute();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].op).toBe('upsert');

    // Re-importing byte-identical content must NOT append a redundant log row.
    await importFacilities(deps, body, { nationalSystem: SYSTEM, apply: true });
    const afterSecond = await deps.db.selectFrom('reference_change_log').selectAll().where('entity_type', '=', 'facility_registry').execute();
    expect(afterSecond).toHaveLength(1);
  });

  it('omitting capture writes facility_registry rows without touching reference_change_log', async () => {
    const db = (await makeMigratedDb()) as Kysely<InternalSchema>;
    const body = csv(['100,Dodoma Regional Referral,,,,,,,,,,,,,,']);
    await importFacilities({ db }, body, { nationalSystem: SYSTEM, apply: true });
    expect(await rowFor(db, '100')).toBeDefined();
    expect(await db.selectFrom('reference_change_log').selectAll().execute()).toHaveLength(0);
  });
});
