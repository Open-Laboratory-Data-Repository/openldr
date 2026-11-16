import { describe, expect, it, vi } from 'vitest';
import { brokerAccessDetails, checkReadOp, recordCheckRead } from './check-read-audit';

// Layer under test: the audit row for a read of held requests, shared by the plugin broker and the
// CLI. It does not cover the broker's own call or the audit store.
const nullLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe('check read audit', () => {
  it('names the operation and the copy, as the broker did before', () => {
    expect(checkReadOp('held', 'c1')).toBe('import.check.held:c1');
    expect(checkReadOp('heldItem', 'c1')).toBe('import.check.heldItem:c1');
    expect(checkReadOp('heldItems', 'c1')).toBe('import.check.heldItems:c1');
  });

  it('builds the broker access row with the roles and a reason only when there is one', () => {
    expect(brokerAccessDetails({ pluginId: 'p1', op: 'import.check.held:c1', outcome: 'ok', roles: ['lab_admin'] })).toEqual({
      action: 'plugin.broker.access', entityType: 'plugin', entityId: 'p1',
      metadata: { op: 'import.check.held:c1', outcome: 'ok', roles: ['lab_admin'] },
    });
    expect(brokerAccessDetails({ pluginId: 'p1', op: 'x', outcome: 'denied', roles: [], reason: 'no' })).toMatchObject({
      action: 'plugin.broker.denied', metadata: { reason: 'no' },
    });
  });

  it('records the same row for a CLI caller, with the actor given and no key, value or count', async () => {
    const record = vi.fn(async (e) => e);
    await recordCheckRead({ audit: { record } as never, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'cli' }, { pluginId: 'p1', copyId: 'c1', kind: 'heldItems' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toEqual({
      actorType: 'cli', actorId: null, actorName: 'cli',
      action: 'plugin.broker.access', entityType: 'plugin', entityId: 'p1',
      metadata: { op: 'import.check.heldItems:c1', outcome: 'ok', roles: [] },
    });
  });

  it('never throws when the store rejects', async () => {
    const record = vi.fn(async () => { throw new Error('db down'); });
    await expect(recordCheckRead({ audit: { record } as never, logger: nullLogger },
      { actorType: 'cli', actorId: null, actorName: 'cli' }, { pluginId: 'p1', copyId: 'c1', kind: 'held' })).resolves.toBeUndefined();
  });
});
