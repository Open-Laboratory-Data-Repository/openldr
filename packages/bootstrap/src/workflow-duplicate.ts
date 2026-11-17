import { randomUUID } from 'node:crypto';
import { isSecretRef, mapSecretFieldsAsync, type Workflow } from '@openldr/workflows';
import type { WorkflowSecretStore } from '@openldr/db';
import { sealDefinitionSecrets } from './workflow-secret-seal';

/**
 * A copy of a workflow that stands on its own.
 *
 * - **Disabled.** An enabled copy would share the original's webhook path, and two enabled
 *   workflows on one path leave the path unavailable to both. The person enables the copy once its
 *   path is changed.
 * - **A fresh webhook secret.** The copy does not answer the original's senders.
 * - **Its own sealed secrets.** Every other secret (an HTTP node's headers) is read from the
 *   original's store row and sealed again under the copy's id. Before this, the copy pointed at the
 *   original's rows, and deleting the original deleted them.
 *
 * Returns the workflow to create. Its secrets are already sealed under `newId`, so the caller
 * stores it as it is.
 */
export async function duplicateWorkflow(
  source: Workflow,
  deps: { newId: string; secretStore: WorkflowSecretStore; key: string | undefined; createdBy: string | null },
): Promise<Workflow> {
  const plain = await mapSecretFieldsAsync(source.definition, async (f) => {
    if (f.path.endsWith('.data.secret')) {
      f.set(randomUUID());
      return;
    }
    if (isSecretRef(f.value)) f.set(await deps.secretStore.resolve(f.value.secretRef, deps.key));
  });
  const definition = await sealDefinitionSecrets(plain, deps.newId, deps.secretStore, deps.key);
  return {
    id: deps.newId,
    name: `${source.name} (copy)`,
    description: source.description,
    definition: definition as Workflow['definition'],
    enabled: false,
    createdBy: deps.createdBy,
  };
}

/** A new workflow id, in the form the studio makes. */
export function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
}
