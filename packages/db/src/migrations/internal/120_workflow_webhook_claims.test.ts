import { describe, expect, it } from 'vitest';
import { makeMigratedDbUpTo } from './test-helpers';
import { up } from './120_workflow_webhook_claims';

describe('120_workflow_webhook_claims', () => {
  it('claims each path of an enabled workflow, leaves disabled ones out, and gives a shared path to the lower id', async () => {
    const db = await makeMigratedDbUpTo('119_import_check_held');
    const def = JSON.stringify({ nodes: [], edges: [] });
    await db.insertInto('workflows').values([
      { id: 'wf-b', name: 'B', definition: def, enabled: true },
      { id: 'wf-a', name: 'A', definition: def, enabled: true },
      { id: 'wf-off', name: 'Off', definition: def, enabled: false },
    ]).execute();
    await db.insertInto('workflow_webhook_paths').values([
      { workflow_id: 'wf-a', path: 'shared' },
      { workflow_id: 'wf-b', path: 'shared' },
      { workflow_id: 'wf-b', path: 'only-b' },
      { workflow_id: 'wf-off', path: 'off-path' },
    ]).execute();
    await up(db);
    const claims = await db.selectFrom('workflow_webhook_claims').selectAll().orderBy('path').execute();
    expect(claims).toEqual([{ path: 'only-b', workflow_id: 'wf-b' }, { path: 'shared', workflow_id: 'wf-a' }]);
    await db.destroy();
  });
});
