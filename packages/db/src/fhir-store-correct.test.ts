import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely } from 'kysely';
import { validateResource } from '@openldr/fhir';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createFhirStore, CorrectionError } from './fhir-store';

async function memDb(): Promise<Kysely<any>> {
  return makeMigratedDb() as unknown as Promise<Kysely<any>>;
}

const order = (over: Record<string, unknown> = {}) => ({
  resourceType: 'ServiceRequest',
  id: 'sr-1',
  status: 'active',
  intent: 'order',
  subject: { reference: 'Patient/p-1' },
  ...over,
});

async function historyCount(db: Kysely<any>): Promise<number> {
  const rows = await db.selectFrom('fhir.resource_history').select('id').execute();
  return rows.length;
}

async function expectCorrectionError(p: Promise<unknown>, reason: string): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(CorrectionError);
  expect((err as CorrectionError).reason).toBe(reason);
}

describe('FhirStore.correct', () => {
  let db: Kysely<any>;
  beforeEach(async () => {
    // A store with no sync site id: no app_setting in a fresh db, and no env var.
    delete process.env.OPENLDR_SITE_ID;
    db = await memDb();
  });

  it('saves version 2 and a Provenance pointing at it, on a store with no site id', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any);

    const out = await store.correct({
      resourceType: 'ServiceRequest',
      id: 'sr-1',
      next: order({ priority: 'urgent' }),
      who: 'reception clerk',
      reason: '  wrong priority typed  ',
    });

    expect(out.version).toBe(2);
    expect((out.resource as any).priority).toBe('urgent');
    expect((out.resource as any).meta.versionId).toBe('2');

    const cur = (await store.get('ServiceRequest', 'sr-1')) as any;
    expect(cur.priority).toBe('urgent');
    expect(cur.meta.versionId).toBe('2');

    const prov = (await store.get('Provenance', out.provenanceId)) as any;
    expect(prov.target).toEqual([{ reference: 'ServiceRequest/sr-1/_history/2' }]);
    expect(typeof prov.recorded).toBe('string');
    expect(prov.agent[0].who.display).toBe('reception clerk');
    expect(prov.reason[0].text).toBe('wrong priority typed');
    expect(prov.activity.coding[0]).toEqual({ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'UPDATE' });
    expect(prov.activity.text).toBeUndefined();

    const site = await db
      .selectFrom('fhir.change_log')
      .select('site_id')
      .where('resource_type', '=', 'ServiceRequest')
      .where('resource_id', '=', 'sr-1')
      .where('version', '=', 2)
      .executeTakeFirstOrThrow();
    expect(site.site_id).toBeNull();
  });

  it('writes a Provenance that passes validateResource, for correct and for amend', async () => {
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Observation', id: 'obs-1', status: 'final', code: { text: 'x' }, valueString: 'a' } as any);
    const first = await store.correct({
      resourceType: 'Observation',
      id: 'obs-1',
      next: { resourceType: 'Observation', id: 'obs-1', status: 'corrected', code: { text: 'x' }, valueString: 'b' },
      who: 'tech',
      reason: 'value re-checked',
      activity: 'amend',
    });
    const prov = (await store.get('Provenance', first.provenanceId)) as any;
    expect(prov.activity).toEqual({
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: 'UPDATE' }],
      text: 'amend',
    });
    expect(validateResource(prov).ok).toBe(true);

    const second = await store.correct({
      resourceType: 'Observation',
      id: 'obs-1',
      next: { resourceType: 'Observation', id: 'obs-1', status: 'corrected', code: { text: 'x' }, valueString: 'c' },
      who: 'tech',
      reason: 'typo',
    });
    expect(second.version).toBe(3);
    expect(validateResource(await store.get('Provenance', second.provenanceId)).ok).toBe(true);
  });

  it('keeps version 1 in the history', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any);
    await store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ priority: 'stat' }), who: 'w', reason: 'r' });

    const rows = await db
      .selectFrom('fhir.resource_history')
      .select(['version', 'resource'])
      .where('resource_type', '=', 'ServiceRequest')
      .where('id', '=', 'sr-1')
      .orderBy('version', 'asc')
      .execute();
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2]);
    const v1 = typeof rows[0].resource === 'string' ? JSON.parse(rows[0].resource) : rows[0].resource;
    expect(v1.priority).toBeUndefined();
  });

  it('keeps the stored record origin (source system, batch) on the corrected version', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any, { sourceSystem: 'disa', batchId: 'b-1' });
    await store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ priority: 'stat' }), who: 'w', reason: 'r' });
    const got = await store.getWithProvenance('ServiceRequest', 'sr-1');
    expect(got?.provenance.sourceSystem).toBe('disa');
    expect(got?.provenance.batchId).toBe('b-1');
  });

  it('throws not-found for an unknown id', async () => {
    const store = createFhirStore(db);
    const before = await historyCount(db);
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'nope', next: order({ id: 'nope' }), who: 'w', reason: 'r' }),
      'not-found',
    );
    expect(await historyCount(db)).toBe(before);
  });

  it('throws type for a resource type outside the three', async () => {
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Patient', id: 'p-1' } as any);
    const before = await historyCount(db);
    await expectCorrectionError(
      store.correct({ resourceType: 'Patient' as any, id: 'p-1', next: { resourceType: 'Patient', id: 'p-1' }, who: 'w', reason: 'r' }),
      'type',
    );
    expect(await historyCount(db)).toBe(before);
  });

  it('throws invalid for a body that fails validation, and writes nothing', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any);
    const before = await historyCount(db);
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ status: 'not-a-status' }), who: 'w', reason: 'r' }),
      'invalid',
    );
    expect(await historyCount(db)).toBe(before);
    expect(((await store.get('ServiceRequest', 'sr-1')) as any).meta.versionId).toBe('1');
  });

  it('throws invalid when the body names another type or id', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any);
    const before = await historyCount(db);
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ id: 'sr-2' }), who: 'w', reason: 'r' }),
      'invalid',
    );
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: { resourceType: 'Specimen', id: 'sr-1' }, who: 'w', reason: 'r' }),
      'invalid',
    );
    expect(await historyCount(db)).toBe(before);
  });

  it('throws reason for an empty or too long reason', async () => {
    const store = createFhirStore(db);
    await store.save(order() as any);
    const before = await historyCount(db);
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ priority: 'stat' }), who: 'w', reason: '   ' }),
      'reason',
    );
    await expectCorrectionError(
      store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ priority: 'stat' }), who: 'w', reason: 'x'.repeat(501) }),
      'reason',
    );
    expect(await historyCount(db)).toBe(before);
    const ok = await store.correct({ resourceType: 'ServiceRequest', id: 'sr-1', next: order({ priority: 'stat' }), who: 'w', reason: 'x'.repeat(500) });
    expect(ok.version).toBe(2);
  });

  it('writes no sync_amendments row', async () => {
    const store = createFhirStore(db);
    await store.save({ resourceType: 'Specimen', id: 'sp-1' } as any);
    await store.correct({ resourceType: 'Specimen', id: 'sp-1', next: { resourceType: 'Specimen', id: 'sp-1', note: [{ text: 'n' }] }, who: 'w', reason: 'r' });
    const rows = await db.selectFrom('sync_amendments').selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
