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
 * `secretPreserved` has ONE precise meaning: **no external sender's webhook token
 * changed as a result of this reset.** Concretely:
 *
 *   - the restored graph has NO webhook node   → true  (there is no token; nothing could change)
 *   - an existing `secretRef` was carried over → true  (the same token stays in force)
 *   - a webhook node exists but nothing was carried over (the stored graph was gutted or its
 *     secret was plaintext/absent) → false (a NEWLY minted token is now in force, and every
 *     existing sender's token is dead until the operator redistributes it)
 *
 * Only the third case is operator-actionable, which is why the route surfaces and audits it.
 * The no-webhook case is `true` on purpose, not by accident: `wf-sample-reactive` is fired by
 * an `event-trigger` and has no token at all, so resetting it cannot break a sender.
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
  const carriedOver = Boolean(newTrigger && oldSecretRef);
  if (carriedOver) newTrigger!.data.secret = { secretRef: oldSecretRef };

  // Spelled out rather than folded into one boolean expression: the two `true` branches
  // mean different things (no token exists vs. the same token survived) and only the
  // remaining case — a webhook whose token was just replaced — is a change to report.
  const secretPreserved = !newTrigger || carriedOver;
  return { workflow, secretPreserved };
}
