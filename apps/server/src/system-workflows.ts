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
