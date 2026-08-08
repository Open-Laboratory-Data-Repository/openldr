import { describe, it, expect, vi } from 'vitest';
import { makeReconcileDeps, seedRegistry } from './test-support/facility-reconcile-fixture';
import { createFacilityJobRunners } from './facility-job-runners';
import type { publishFacilityMap as PublishFacilityMap, projectRegistryRows as ProjectRegistryRows } from './facility-reconcile';

describe('createFacilityJobRunners', () => {
  it('runRebuild calls publishFacilityMap with apply: true, not a dry run', async () => {
    const deps = await makeReconcileDeps();
    const publishFacilityMap = vi.fn<typeof PublishFacilityMap>(async () => ({
      resolved: 3, unmapped: 1, targetMissing: 0, nonFacilityTarget: 0, ambiguous: 0, written: 4,
    }));
    const projectRegistryRows = vi.fn<typeof ProjectRegistryRows>(async () => true);
    const runners = createFacilityJobRunners({ ...deps, publishFacilityMap, projectRegistryRows });

    const result = await runners.runRebuild();

    expect(publishFacilityMap).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: a dry run (`apply: false`) would compute the same resolution but
    // write nothing to `facility_map`, letting the job finish `done` while the dimension stayed
    // stale. Pin the exact opts the real call received, not just that some call happened.
    expect(publishFacilityMap.mock.calls[0]?.[1]).toEqual({ apply: true });
    expect(result).toEqual({ written: 4 });
  });

  it('runProjection projects an existing facility_registry row as { id, name }', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'ALPHA' });
    const publishFacilityMap = vi.fn<typeof PublishFacilityMap>();
    const projectRegistryRows = vi.fn<typeof ProjectRegistryRows>(async () => true);
    const runners = createFacilityJobRunners({ ...deps, publishFacilityMap, projectRegistryRows });

    await runners.runProjection('fac-A');

    expect(projectRegistryRows).toHaveBeenCalledTimes(1);
    expect(projectRegistryRows.mock.calls[0]?.[1]).toEqual([{ id: 'fac-A', name: 'Alpha Clinic' }]);
  });

  it('runProjection resolves without throwing, and skips projection, when the row is gone', async () => {
    const deps = await makeReconcileDeps();
    // Deliberately no seedRegistry call: this simulates a facility deleted between the moment its
    // job was enqueued and the moment the worker claims and runs it.
    const publishFacilityMap = vi.fn<typeof PublishFacilityMap>();
    const projectRegistryRows = vi.fn<typeof ProjectRegistryRows>(async () => true);
    const runners = createFacilityJobRunners({ ...deps, publishFacilityMap, projectRegistryRows });

    await expect(runners.runProjection('fac-missing')).resolves.toBeUndefined();
    expect(projectRegistryRows).not.toHaveBeenCalled();
  });

  // ⛔ This job only exists because an inline projection already failed once. `projectRegistryRows`
  // never throws, so a retry that fails exactly as the original did would otherwise return normally
  // and let the worker finish the job `done` — emptying the queue and erasing the durable record of a
  // facility that is still missing (or stale) in the mapping picker. Throwing is what routes it into
  // the worker's failure/retry path instead.
  it('runProjection throws when the projection reports that it did not land', async () => {
    const deps = await makeReconcileDeps();
    await seedRegistry(deps, { id: 'fac-A', name: 'Alpha Clinic', localCode: 'ALPHA' });
    const publishFacilityMap = vi.fn<typeof PublishFacilityMap>();
    const projectRegistryRows = vi.fn<typeof ProjectRegistryRows>(async () => false);
    const runners = createFacilityJobRunners({ ...deps, publishFacilityMap, projectRegistryRows });

    await expect(runners.runProjection('fac-A')).rejects.toThrow(/fac-A/);
  });
});
