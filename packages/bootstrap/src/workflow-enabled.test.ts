import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from '@openldr/db/testing';
import { createWorkflowStore, WebhookPathClaimedError, type Workflow } from '@openldr/workflows';
import { setWorkflowEnabled } from './workflow-enabled';

const hook = (id: string, name: string, path: string, enabled = true): Workflow => ({
  id, name, description: `${name} notes`, enabled, createdBy: null,
  definition: { nodes: [{ id: 't1', type: 'trigger', data: { triggerType: 'webhook', path } }], edges: [] },
});

describe('setWorkflowEnabled (real store, pg-mem)', () => {
  it('changes only enabled, keeping the stored graph, name and description', async () => {
    const store = createWorkflowStore(await makeMigratedDb());
    await store.create(hook('wf-a', 'A', 'a-path'));
    await store.update('wf-a', { ...hook('wf-a', 'A edited', 'a-path'), description: 'edited' });
    const changed = await setWorkflowEnabled(store, 'wf-a', false);
    expect(changed?.after).toMatchObject({ name: 'A edited', description: 'edited', enabled: false });
    expect(await store.get('wf-a')).toMatchObject({ name: 'A edited', description: 'edited', enabled: false });
  });

  it('refuses to enable onto a path another enabled workflow holds, and leaves it off', async () => {
    const store = createWorkflowStore(await makeMigratedDb());
    await store.create(hook('wf-h', 'Holder', 'shared'));
    await store.create(hook('wf-c', 'Copy', 'shared', false));
    await expect(setWorkflowEnabled(store, 'wf-c', true)).rejects.toBeInstanceOf(WebhookPathClaimedError);
    expect((await store.get('wf-c'))?.enabled).toBe(false);
  });

  it('gives null for an unknown id and changes nothing when already in that state', async () => {
    const store = createWorkflowStore(await makeMigratedDb());
    await store.create(hook('wf-b', 'B', 'b-path'));
    expect(await setWorkflowEnabled(store, 'nope', true)).toBeNull();
    const same = await setWorkflowEnabled(store, 'wf-b', true);
    expect(same?.after).toBe(same?.before);
  });
});
