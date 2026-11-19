import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { requireCapability } from './rbac';

// Read-only payload-lifecycle views.
const VIEW = { preHandler: requireCapability('activity.view') };

export function registerActivityRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/activity', VIEW, async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.activity.listRecent({ limit, offset });
  });

  // How far the warehouse is behind the records saved. The dashboard and the reports read the
  // warehouse, so this is what tells a reader that their numbers are not complete yet.
  app.get('/api/warehouse/status', VIEW, async () => ctx.warehouseStatus.read());

  app.get('/api/activity/:correlationId', VIEW, async (req, reply) => {
    const { correlationId } = req.params as { correlationId: string };
    const lc = await ctx.activity.getLifecycle(correlationId);
    if (!lc) { reply.code(404); return { error: 'unknown payload' }; }
    return lc;
  });
}
