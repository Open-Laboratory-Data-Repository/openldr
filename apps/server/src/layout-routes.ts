import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { deleteLayout, layoutInputSchema, LayoutError, listLayouts, saveLayout } from '@openldr/bootstrap';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

// Layout presets: named sidebars and first pages, with a default per role. Any signed-in user may
// read the list, because the user menu offers it. Changing one needs settings.edit_general. A
// layout only hides pages in studio; it grants nothing, so reading it discloses nothing sensitive.
const EDIT = { preHandler: requireCapability('settings.edit_general') };

function layoutError(err: unknown, reply: FastifyReply): { error: string } {
  if (err instanceof LayoutError) {
    reply.code(err.code === 'not-found' ? 404 : err.code === 'duplicate-name' ? 409 : 400);
    return { error: err.message };
  }
  throw err;
}

export function registerLayoutRoutes(app: FastifyInstance<any, any, any, any>, ctx: Pick<AppContext, 'internalDb' | 'audit' | 'logger'>): void {
  app.get('/api/layouts', async (req, reply) => {
    if (!req.user) { reply.code(401); return { error: 'authentication required' }; }
    return listLayouts(ctx.internalDb);
  });

  app.post('/api/layouts', EDIT, async (req, reply) => {
    const parsed = layoutInputSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid layout' }; }
    try {
      const saved = await saveLayout(ctx.internalDb, null, parsed.data, req.user?.username ?? null);
      await recordAudit(ctx as AppContext, req, { action: 'layout.create', entityType: 'layout', entityId: saved.id, metadata: { name: saved.name } });
      return saved;
    } catch (err) { return layoutError(err, reply); }
  });

  app.put('/api/layouts/:id', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = layoutInputSchema.safeParse(req.body);
    if (!parsed.success) { reply.code(400); return { error: 'invalid layout' }; }
    try {
      const saved = await saveLayout(ctx.internalDb, id, parsed.data, req.user?.username ?? null);
      await recordAudit(ctx as AppContext, req, { action: 'layout.update', entityType: 'layout', entityId: id, metadata: { name: saved.name } });
      return saved;
    } catch (err) { return layoutError(err, reply); }
  });

  app.delete('/api/layouts/:id', EDIT, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const gone = await deleteLayout(ctx.internalDb, id);
      await recordAudit(ctx as AppContext, req, { action: 'layout.delete', entityType: 'layout', entityId: id, metadata: { name: gone.name } });
      return { ok: true };
    } catch (err) { return layoutError(err, reply); }
  });
}
