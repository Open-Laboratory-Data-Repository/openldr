import { findWebhookPathClaims, WebhookPathClaimedError, type Workflow, type WorkflowStore } from '@openldr/workflows';

/**
 * Turn a workflow on or off, and change nothing else. The studio's row menu and `openldr workflows
 * enable|disable` both call this, so a stale page or a script never writes back a graph, name or
 * description it did not edit (operator, 2026-11-17, review C7-1).
 *
 * - Enabling is refused when another enabled workflow holds one of its webhook paths; the error
 *   names that workflow. The store's path claim refuses a race the same way.
 * - The write is based on the version read here, so a save in between is not overwritten.
 * - Returns null for an unknown id. Turning on a workflow that is already on changes nothing.
 */
export async function setWorkflowEnabled(
  store: WorkflowStore,
  id: string,
  enabled: boolean,
): Promise<{ before: Workflow; after: Workflow } | null> {
  const before = await store.get(id);
  if (!before) return null;
  if (before.enabled === enabled) return { before, after: before };
  if (enabled) {
    const claims = await findWebhookPathClaims(
      before.definition.nodes as Parameters<typeof findWebhookPathClaims>[0],
      id,
      (path) => store.findByWebhookPath(path),
    );
    if (claims[0]) throw new WebhookPathClaimedError(claims[0].path, claims[0].name);
  }
  const after = await store.update(id, { ...before, enabled }, { expectedVersion: before.version });
  return { before, after };
}
