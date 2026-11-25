import type { FastifyInstance } from 'fastify';
import { requireAnyCapability } from './rbac';

/**
 * The permissions of every studio page that reads terminology: the Terminology page and the Test
 * catalog (terminology.view, terminology.manage), the forms builder and a form being filled
 * (forms.view, forms.edit, forms.submit), Facilities (facilities.view), Settings, Laboratory
 * (settings.view), and the workflow mapping step (workflows.view). A person holding none of them
 * has no screen that reads codes, so CE refuses the read. Plugins read terminology inside the
 * server (`ce_read`), not through these routes.
 */
export const TERMINOLOGY_READ_CAPABILITIES = [
  'terminology.view',
  'terminology.manage',
  'forms.view',
  'forms.edit',
  'forms.submit',
  'facilities.view',
  'settings.view',
  'workflows.view',
] as const;

/**
 * Gives every GET under /api/terminology/ the read gate, unless the route names its own gate
 * (such as terminology.manage on an import job). Call it before the terminology routes are
 * registered: an onRoute hook sees only the routes added after it.
 */
export function gateTerminologyReads(app: FastifyInstance<any, any, any, any>): void {
  const gate = requireAnyCapability(...TERMINOLOGY_READ_CAPABILITIES);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    // HEAD too: Fastify adds one for each GET, and it answers the status and the body size.
    if (!methods.includes('GET') && !methods.includes('HEAD')) return;
    if (!route.url.startsWith('/api/terminology/')) return;
    if (route.preHandler) return;
    route.preHandler = gate;
  });
}
