import { randomUUID } from 'node:crypto';
import { buildDefaultWorkflows } from '@openldr/workflows';

/**
 * Ids of the workflows the seed always creates. Derived from the seed itself so the
 * set follows automatically when `buildDefaultWorkflows` changes — and so protection
 * cannot be edited away through the same API it is meant to guard.
 *
 * The arguments here only shape node config, never the ids, so throwaway values are
 * fine for enumeration.
 */
export const PROTECTED_WORKFLOW_IDS: readonly string[] = buildDefaultWorkflows({
  orderFormId: 'enumeration-only',
  webhookSecret: 'enumeration-only',
}).map((w) => w.id);

export function isProtectedWorkflowId(id: string): boolean {
  return PROTECTED_WORKFLOW_IDS.includes(id);
}

const SEEDED_ORDER_FORM_ID = 'form-sample-order';

function findNode(def: { nodes?: unknown[] }, templateId: string): Record<string, any> | undefined {
  return (def.nodes ?? []).find(
    (n) => (n as any)?.data?.templateId === templateId,
  ) as Record<string, any> | undefined;
}

/**
 * Rebuild a seeded workflow's definition from `buildDefaultWorkflows`, carrying two
 * things over from whatever is currently stored:
 *
 *  - the webhook node's `secretRef`. The seed mints secrets with randomUUID(), so
 *    minting a fresh one here would silently invalidate every external producer's
 *    token. Reset restores structure, never credentials.
 *  - the form-validate node's `formId`, so a site that re-pointed it keeps its binding.
 *
 * `secretPreserved: false` means the stored graph had no secret to carry over and the
 * rebuilt one carries the freshly generated default — callers must surface that.
 */
export function rebuildSystemWorkflow(existing: { id: string; definition: { nodes?: unknown[] } }): {
  workflow: any;
  secretPreserved: boolean;
} {
  const oldTrigger = findNode(existing.definition, 'webhook-trigger');
  const oldSecretRef = oldTrigger?.data?.secret?.secretRef as string | undefined;
  const oldFormId = findNode(existing.definition, 'form-validate')?.data?.config?.formId as string | undefined;

  const defaults = buildDefaultWorkflows({
    orderFormId: oldFormId ?? SEEDED_ORDER_FORM_ID,
    webhookSecret: randomUUID(),
  });
  const fresh = defaults.find((w) => w.id === existing.id);
  if (!fresh) throw new Error(`'${existing.id}' is not a seeded system workflow`);

  const workflow = JSON.parse(JSON.stringify(fresh));
  const newTrigger = findNode(workflow.definition, 'webhook-trigger');
  if (newTrigger && oldSecretRef) newTrigger.data.secret = { secretRef: oldSecretRef };

  return { workflow, secretPreserved: Boolean(oldSecretRef) || !newTrigger };
}
