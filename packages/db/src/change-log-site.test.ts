import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { stampEarlierRecords, NOT_LAB_OWNED_RESOURCE_TYPES } from './change-log-site';

// Layer: the UPDATE on fhir.change_log, on pg-mem. Not covered: the push then sending the rows,
// which the sync test on two machines checked (docs/superpowers/plans/2026-11-26-sync-standalone-to-national-test.md).

async function seed(): Promise<Kysely<any>> {
  const db = await makeMigratedDb();
  const row = (type: string, id: string, site: string | null) =>
    ({ resource_type: type, resource_id: id, version: 1, op: 'upsert', content_hash: 'h', site_id: site });
  await db.insertInto('fhir.change_log').values([
    row('Patient', 'p1', null),
    row('Observation', 'o1', ''),
    row('ServiceRequest', 'sr1', null),
    row('Organization', 'org1', null),
    row('ValueSet', 'vs1', null),
    row('CodeSystem', 'cs1', null),
    row('Patient', 'p2', 'other-lab'),
  ]).execute();
  return db;
}

// The migrations seed their own terminology rows; these tests read only the rows they wrote.
const MINE = ['p1', 'o1', 'sr1', 'org1', 'vs1', 'cs1', 'p2'];
const sites = async (db: Kysely<any>) =>
  Object.fromEntries((await db.selectFrom('fhir.change_log').select(['resource_id', 'site_id']).where('resource_id', 'in', MINE).execute()).map((r: any) => [r.resource_id, r.site_id]));

describe('stampEarlierRecords', () => {
  it('gives the site id to earlier records with none, and leaves terminology and other sites alone', async () => {
    const db = await seed();
    expect(await stampEarlierRecords(db, 'lab-01')).toBe(4);
    expect(await sites(db)).toEqual({
      p1: 'lab-01', o1: 'lab-01', sr1: 'lab-01', org1: 'lab-01',
      vs1: null, cs1: null,
      p2: 'other-lab',
    });
  });

  it('is safe to run again: a second save stamps nothing', async () => {
    const db = await seed();
    await stampEarlierRecords(db, 'lab-01');
    expect(await stampEarlierRecords(db, 'lab-01')).toBe(0);
  });

  it('does nothing without a site id', async () => {
    const db = await seed();
    expect(await stampEarlierRecords(db, '')).toBe(0);
    expect((await sites(db)).p1).toBeNull();
  });

  it('treats the four terminology types as the central\'s', () => {
    expect([...NOT_LAB_OWNED_RESOURCE_TYPES]).toEqual(['ValueSet', 'CodeSystem', 'ConceptMap', 'NamingSystem']);
  });
});
