import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore } from '@openldr/db';
import type { Config } from '@openldr/config';
import { installHoldsLabData, loadSampleData, LAB_DATA_RESOURCE_TYPES, type SampleDataDeps } from './sample-data';

// Layer under test: installHoldsLabData against the migrated internal FHIR store and the migrated
// warehouse, both on pg-mem. pg-mem is not Postgres: this proves the query shape and the sources
// it reads, not how a real Postgres, MySQL or SQL Server plans them. The SQL Server branch (TOP 1)
// is not run here.

const seedDatabase = vi.fn();
const close = vi.fn();
vi.mock('./seed', () => ({ seedDatabase: (...a: unknown[]) => seedDatabase(...a) }));
vi.mock('./db-context', () => ({ createDbContext: async () => ({ close: () => close() }) }));

async function build() {
  const internalDb = await makeMigratedDb();
  const targetDb = await makeMigratedExternalDb();
  const fhirStore = createFhirStore(internalDb);
  const deps: SampleDataDeps = {
    cfg: {} as Config,
    targetEngine: 'postgres',
    targetDb: targetDb as Kysely<ExternalSchema>,
    listByType: (type, limit) => fhirStore.listByType(type, limit),
    seedTarget: {} as SampleDataDeps['seedTarget'],
  };
  return { deps, fhirStore, targetDb };
}

describe('installHoldsLabData', () => {
  it('is false on an empty install', async () => {
    const { deps } = await build();
    expect(await installHoldsLabData(deps)).toBe(false);
  });

  it('is true when the patients table has a row', async () => {
    const { deps, targetDb } = await build();
    await targetDb.insertInto('patients').values({ id: 'p1' }).execute();
    expect(await installHoldsLabData(deps)).toBe(true);
  });

  it('is true when the lab_requests table has a row', async () => {
    const { deps, targetDb } = await build();
    await targetDb.insertInto('lab_requests').values({ id: 'sr1', request_id: 'r1', patient_id: 'p1' }).execute();
    expect(await installHoldsLabData(deps)).toBe(true);
  });

  it('checks exactly the seven FHIR resource types', () => {
    expect([...LAB_DATA_RESOURCE_TYPES].sort()).toEqual(
      ['DiagnosticReport', 'Location', 'Observation', 'Organization', 'Patient', 'ServiceRequest', 'Specimen'],
    );
  });

  for (const type of ['Patient', 'ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport', 'Organization', 'Location']) {
    it(`is true when the FHIR store holds a ${type}`, async () => {
      const { deps, fhirStore } = await build();
      await fhirStore.save({ resourceType: type, id: `x-${type}` } as never);
      expect(await installHoldsLabData(deps)).toBe(true);
    });
  }

  it('is false when the FHIR store holds only other types', async () => {
    const { deps, fhirStore } = await build();
    await fhirStore.save({ resourceType: 'ValueSet', id: 'vs-1', url: 'urn:x', status: 'active' } as never);
    expect(await installHoldsLabData(deps)).toBe(false);
  });
});

// Layer under test: loadSampleData's three calls, with seedDatabase and createDbContext faked.
// What seedDatabase writes is tested in seed.test.ts.
describe('loadSampleData', () => {
  beforeEach(() => { seedDatabase.mockReset(); close.mockReset(); });

  const deps = { cfg: {} as Config, seedTarget: { marker: true } } as unknown as SampleDataDeps;

  it('seeds through seedDatabase, returns the five counts only, and closes the context', async () => {
    seedDatabase.mockResolvedValue({
      resources: [{ id: 'seed-pat', flattened: 'x' }], formsSeeded: 4, workflowsSeeded: 2, connectorsSeeded: 1,
      dashboardsSeeded: 1, reportDesignsSeeded: 3, demoDesignsRemoved: 0, dataDrivenReportsSeeded: {}, settingsSeeded: 5,
    });
    expect(await loadSampleData(deps)).toEqual({
      formsSeeded: 4, workflowsSeeded: 2, connectorsSeeded: 1, dashboardsSeeded: 1, settingsSeeded: 5,
    });
    expect(seedDatabase).toHaveBeenCalledOnce();
    expect(seedDatabase.mock.calls[0][1]).toBe(deps.seedTarget);
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the context when the seed throws', async () => {
    seedDatabase.mockRejectedValue(new Error('seed failed'));
    await expect(loadSampleData(deps)).rejects.toThrow('seed failed');
    expect(close).toHaveBeenCalledOnce();
  });
});
