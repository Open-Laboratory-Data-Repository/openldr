import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import type { ExternalSchema } from '@openldr/db';
import { makeMigratedDb } from '@openldr/db/testing';
import { makeMigratedExternalDb } from '@openldr/db/testing-external';
import { createFhirStore } from '@openldr/db';
import type { Config } from '@openldr/config';
import { installHoldsLabData, loadSampleData, LAB_DATA_RESOURCE_TYPES, SAMPLE_ORDERS_SOURCE, type SampleDataDeps } from './sample-data';
import type { IngestOutcome } from './ingest-and-wait';

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

  it('checks exactly the eight FHIR resource types', () => {
    expect([...LAB_DATA_RESOURCE_TYPES].sort()).toEqual(
      ['DiagnosticReport', 'Location', 'Observation', 'Organization', 'Patient', 'QuestionnaireResponse', 'ServiceRequest', 'Specimen'],
    );
  });

  for (const type of ['Patient', 'ServiceRequest', 'Specimen', 'Observation', 'DiagnosticReport', 'Organization', 'Location', 'QuestionnaireResponse']) {
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

// Layer under test: loadSampleData's calls, with seedDatabase, createDbContext and the orders load
// faked. What seedDatabase writes is tested in seed.test.ts. The real orders load
// (createIngestContext over a real database) is not run here.
describe('loadSampleData', () => {
  beforeEach(() => { seedDatabase.mockReset(); close.mockReset(); });

  const seeded = {
    resources: [{ id: 'seed-pat', flattened: 'x' }], formsSeeded: 4, workflowsSeeded: 2, connectorsSeeded: 1,
    dashboardsSeeded: 1, reportDesignsSeeded: 3, demoDesignsRemoved: 0, dataDrivenReportsSeeded: {}, settingsSeeded: 5,
  };
  const outcome = (o: Partial<IngestOutcome> = {}): IngestOutcome =>
    ({ batchId: 'b1', status: 'done', resourceCount: 7, error: null, finished: true, ...o });
  const withOrders = (ingestSampleOrders: SampleDataDeps['ingestSampleOrders']) =>
    ({ cfg: { marker: 'cfg' } as unknown as Config, seedTarget: { marker: true }, ingestSampleOrders }) as unknown as SampleDataDeps;

  it('seeds through seedDatabase, then loads the orders, returns the six counts, and closes the context', async () => {
    seedDatabase.mockResolvedValue(seeded);
    const ingest = vi.fn(async () => outcome());
    const deps = withOrders(ingest);
    expect(await loadSampleData(deps)).toEqual({
      formsSeeded: 4, workflowsSeeded: 2, connectorsSeeded: 1, dashboardsSeeded: 1, settingsSeeded: 5, sampleResources: 7,
    });
    expect(seedDatabase).toHaveBeenCalledOnce();
    expect(seedDatabase.mock.calls[0][1]).toBe(deps.seedTarget);
    expect(ingest).toHaveBeenCalledOnce();
    expect(ingest).toHaveBeenCalledWith(deps.cfg);
    expect(seedDatabase.mock.invocationCallOrder[0]).toBeLessThan(ingest.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('never loads the orders when the seed throws, and closes the context', async () => {
    seedDatabase.mockRejectedValue(new Error('seed failed'));
    const ingest = vi.fn(async () => outcome());
    await expect(loadSampleData(withOrders(ingest))).rejects.toThrow('seed failed');
    expect(ingest).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('throws when the orders batch failed, with the status only in the message', async () => {
    seedDatabase.mockResolvedValue(seeded);
    const ingest = vi.fn(async () => outcome({ status: 'failed', error: 'bad bundle at /srv/data/x.json on db.example:5432' }));
    const err = await loadSampleData(withOrders(ingest)).then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('failed');
    for (const part of ['/srv', 'x.json', 'db.example', '5432', 'bad bundle', 'sample-lab-data']) expect(err?.message).not.toContain(part);
  });

  it('throws when the orders batch did not finish in time', async () => {
    seedDatabase.mockResolvedValue(seeded);
    const ingest = vi.fn(async () => outcome({ status: 'processing', finished: false, resourceCount: 0 }));
    await expect(loadSampleData(withOrders(ingest))).rejects.toThrow('processing');
  });

  it('labels the sample orders batch as sample data, not as a CLI import', () => {
    expect(SAMPLE_ORDERS_SOURCE).toBe('sample-data');
  });

  it('throws when the orders batch is gone', async () => {
    seedDatabase.mockResolvedValue(seeded);
    const ingest = vi.fn(async () => outcome({ status: undefined, finished: false, resourceCount: undefined, error: undefined }));
    await expect(loadSampleData(withOrders(ingest))).rejects.toThrow(Error);
  });
});

// Layer under test: the shipped file on disk. It proves the bootstrap copy matches the docs copy
// and holds the 60 orders the docs describe. It does not prove the pipeline accepts it.
describe('the sample orders file', () => {
  const bootstrapCopy = fileURLToPath(new URL('./samples/sample-lab-data.json', import.meta.url));
  const webCopy = fileURLToPath(new URL('../../../apps/web/public/docs-samples/openldr-sample-lab-data.json', import.meta.url));

  it('is byte-identical to the copy the docs link to', () => {
    expect(readFileSync(bootstrapCopy).equals(readFileSync(webCopy))).toBe(true);
  });

  it('is a FHIR Bundle with 60 ServiceRequest entries', () => {
    const bundle = JSON.parse(readFileSync(bootstrapCopy, 'utf8')) as { resourceType: string; entry: { resource: { resourceType: string } }[] };
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.entry.filter((e) => e.resource.resourceType === 'ServiceRequest')).toHaveLength(60);
    expect(bundle.entry).toHaveLength(226);
  });
});
