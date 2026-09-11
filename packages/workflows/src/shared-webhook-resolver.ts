import { isSecretRef } from './secret-fields';
import type { Workflow, WorkflowNode } from './types';
import type { WebhookEntry } from './webhook-registry';

export function normalizeWebhookPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function webhookNodePath(node: WorkflowNode): string | undefined {
  if (node.type !== 'webhook' && !(node.type === 'trigger' && node.data.triggerType === 'webhook')) return;
  const path = node.data.path;
  if (typeof path !== 'string' || !path.trim()) return;
  return normalizeWebhookPath(path) || undefined;
}

export class WebhookPathConflictError extends Error {
  constructor() { super('Webhook path has multiple enabled triggers'); this.name = 'WebhookPathConflictError'; }
}

export interface SharedWebhookResolver {
  resolve(path: string): Promise<WebhookEntry | undefined>;
}

export function createSharedWebhookResolver(opts: {
  findByPath: (path: string) => Promise<Workflow[]>;
  /** Return null for unreadable credentials; propagate database failures. */
  resolveRef: (ref: string) => Promise<string | null>;
}): SharedWebhookResolver {
  return {
    async resolve(path) {
      const key = normalizeWebhookPath(path);
      if (!key) return;
      const workflows = (await opts.findByPath(key)).filter(w => w.enabled);
      if (workflows.length > 1) throw new WebhookPathConflictError();
      const workflow = workflows[0];
      if (!workflow) return;
      const nodes = workflow.definition.nodes.filter(node => webhookNodePath(node) === key);
      if (nodes.length > 1) throw new WebhookPathConflictError();
      if (!nodes.length) return;
      const raw = nodes[0].data.secret;
      let secret: string | null = null;
      if (isSecretRef(raw)) {
        secret = await opts.resolveRef(raw.secretRef);
      } else if (typeof raw === 'string') secret = raw;
      return { workflowId: workflow.id, secret };
    },
  };
}
