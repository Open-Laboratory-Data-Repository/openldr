import { describe, it, expect } from 'vitest';
import { createFacilityJobStore } from '@openldr/db';
import { makeReconcileDeps } from './test-support/facility-reconcile-fixture';

describe('boot-time facility-map rebuild enqueue', () => {
  it('a boot enqueue lands one queued rebuild, and a second boot absorbs into it', async () => {
    // Pins the property the boot call relies on: enqueueing unconditionally on every boot cannot
    // pile up work, because a rebuild that is still QUEUED absorbs the next request.
    const deps = await makeReconcileDeps();
    const jobs = createFacilityJobStore(deps.internalDb);

    const first = await jobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'boot' });
    const second = await jobs.enqueue({ kind: 'facility-map-rebuild', requestedBy: 'boot' });

    expect(first.coalesced).toBe(false);
    expect(second.coalesced).toBe(true);
    const unresolved = await jobs.listUnresolved();
    expect(unresolved.filter((j) => j.kind === 'facility-map-rebuild')).toHaveLength(1);
  });
});
