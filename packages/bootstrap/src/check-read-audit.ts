import type { AuditStore } from '@openldr/audit';
import type { Logger } from '@openldr/core';
import { recordAuditEvent, type AuditActor, type AuditDetails } from './record-audit';

// The audit row for a read of held requests. Their rows hold patient values, so every read leaves
// one. The plugin broker (Studio) and the CLI both write it from here, so the two rows are the same.
// It names the operation and the copy. Never a key, a value, a count or a file path.

export type CheckReadKind = 'held' | 'heldItem' | 'heldItems';

/** The operation as the audit row names it. */
export function checkReadOp(kind: CheckReadKind, copyId: string): string {
  return `import.check.${kind}:${copyId}`;
}

/** The row for a broker event: a denial or a completed sensitive operation. */
export function brokerAccessDetails(e: {
  pluginId: string; op: string; outcome: 'denied' | 'ok'; roles: string[]; reason?: string;
}): AuditDetails {
  return {
    action: e.outcome === 'denied' ? 'plugin.broker.denied' : 'plugin.broker.access',
    entityType: 'plugin', entityId: e.pluginId,
    metadata: { op: e.op, outcome: e.outcome, roles: e.roles, ...(e.reason ? { reason: e.reason } : {}) },
  };
}

/** Records one read of held requests. Best-effort, as every audit row of a read is. The CLI has no
 *  roles, so it records none. */
export async function recordCheckRead(
  ctx: { audit: AuditStore; logger: Logger },
  actor: AuditActor,
  read: { pluginId: string; copyId: string; kind: CheckReadKind },
): Promise<void> {
  await recordAuditEvent(ctx, actor, brokerAccessDetails({
    pluginId: read.pluginId, op: checkReadOp(read.kind, read.copyId), outcome: 'ok', roles: [],
  }));
}
