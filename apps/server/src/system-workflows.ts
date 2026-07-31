import { randomUUID } from 'node:crypto';
import { buildDefaultWorkflows, isSecretRef } from '@openldr/workflows';

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
 * The webhook token the reset should keep in force, read out of whatever is currently stored.
 *
 * Two shapes are both legitimate on the stored node:
 *
 *  - `{ secretRef }` — the normal case; the plaintext lives in `workflow_secrets` and the graph
 *    only names it. Carry the REFERENCE over untouched.
 *  - a plaintext string — an unsealed graph: seeded before SEC-06, imported, or written by a
 *    path that skipped `extractWorkflowSecrets`. Carry the VALUE over; the reset route seals it
 *    on the way to storage, so the token survives and no plaintext is persisted.
 *
 * Anything else (absent, empty, a non-string) means there is no token to keep.
 */
function carryOverSecret(trigger: Record<string, any> | undefined): { secretRef: string } | string | undefined {
  const stored = trigger?.data?.secret;
  if (isSecretRef(stored)) return { secretRef: stored.secretRef };
  if (typeof stored === 'string' && stored.trim()) return stored;
  return undefined;
}

/**
 * Rebuild a seeded workflow's definition from `buildDefaultWorkflows`, carrying two
 * things over from whatever is currently stored:
 *
 *  - the webhook node's secret. The seed mints secrets with randomUUID(), so
 *    minting a fresh one here would silently invalidate every external producer's
 *    token. Reset restores structure, never credentials.
 *  - the form-validate node's `formId`, so a site that re-pointed it keeps its binding.
 *
 * `secretPreserved` has ONE precise meaning: **no external sender's webhook token
 * changed as a result of this reset.** Concretely:
 *
 *   - the restored graph has NO webhook node   → true  (there is no token; nothing could change)
 *   - an existing secret was carried over      → true  (the same token stays in force, whether it
 *                                                       was stored as a `{ secretRef }` or, on an
 *                                                       unsealed graph, as plaintext)
 *   - a webhook node exists but the stored graph held no secret at all → false (a NEWLY minted
 *     token is now in force; nobody can be given it, because workflow secrets are write-only —
 *     see the route/UI, which tells the operator to set one instead)
 *
 * Only the third case is operator-actionable, which is why the route surfaces and audits it.
 * The no-webhook case is `true` on purpose, not by accident: `wf-sample-reactive` is fired by
 * an `event-trigger` and has no token at all, so resetting it cannot break a sender.
 */
export function rebuildSystemWorkflow(existing: { id: string; definition: { nodes?: unknown[] } }): {
  workflow: any;
  secretPreserved: boolean;
} {
  const carried = carryOverSecret(findNode(existing.definition, 'webhook-trigger'));
  const oldFormId = findNode(existing.definition, 'form-validate')?.data?.config?.formId as string | undefined;

  const defaults = buildDefaultWorkflows({
    orderFormId: oldFormId ?? SEEDED_ORDER_FORM_ID,
    // Only reached when nothing was carried over — the rebuilt graph would otherwise hold a
    // fabricated token. `carried` overwrites it below whenever there IS something to keep.
    webhookSecret: randomUUID(),
  });
  const fresh = defaults.find((w) => w.id === existing.id);
  if (!fresh) throw new Error(`'${existing.id}' is not a seeded system workflow`);

  const workflow = JSON.parse(JSON.stringify(fresh));
  const newTrigger = findNode(workflow.definition, 'webhook-trigger');
  const carriedOver = Boolean(newTrigger && carried);
  if (carriedOver) newTrigger!.data.secret = carried;

  // Spelled out rather than folded into one boolean expression: the two `true` branches
  // mean different things (no token exists vs. the same token survived) and only the
  // remaining case — a webhook whose token was just replaced — is a change to report.
  const secretPreserved = !newTrigger || carriedOver;
  return { workflow, secretPreserved };
}
