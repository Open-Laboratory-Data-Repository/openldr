import type { FastifyInstance } from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { ReportDesignSchema, findInvalidImageSources } from '@openldr/report-designer/pure';
import { renderReportDesignPdf, resolveDesignTables } from '@openldr/report-designer';
import { runStoredQuery, type RunStoredQueryDeps } from './run-stored-query';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

export function registerReportDesignRoutes(
  app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: RunStoredQueryDeps,
): void {
  const MANAGE = { preHandler: requireCapability('reports.edit_templates') };
  const PREVIEW = { preHandler: requireCapability('reports.run') };
  const VIEW = { preHandler: requireCapability('reports.view') };

  app.get('/api/report-designs', VIEW, async () => ctx.reportDesigns.list());

  app.get('/api/report-designs/:id', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const d = await ctx.reportDesigns.get(id);
    if (!d) { reply.code(404); return { error: 'not found' }; }
    return d;
  });

  // Write-time image gate on POST/PUT only.
  //
  // ⛔ Deliberately NOT on `/preview`: an author must be able to preview a design that already
  // contains a bad image in order to SEE the problem. Preview is diagnostic; save is the gate.
  // ⛔ Deliberately not a zod refinement either — `fromRow` parses stored designs through the same
  // schema, so a refinement would run on READ and make such a design permanently unopenable.
  app.post('/api/report-designs', MANAGE, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const invalidImages = findInvalidImageSources(p.data);
    if (invalidImages.length > 0) {
      reply.code(400);
      // The bare 'invalid image source' string used to be the whole message the studio's error
      // extractor (which reads only `body.error`) ever surfaces as a toast — opaque on an install
      // with N images across M pages, and worse on autosave's 1.2s debounce with no click to
      // correlate. Name the offending element(s) IN the string; keep `invalidImages` for programmatic
      // callers.
      const error = `invalid image source: ${invalidImages.map((i) => `${i.elementId} (${i.reason})`).join(', ')}`;
      return { error, invalidImages };
    }
    const created = await ctx.reportDesigns.create(p.data);
    await recordAudit(ctx, req, { action: 'report-design.create', entityType: 'report-design', entityId: created.id, before: null, after: created });
    reply.code(201);
    return created;
  });

  app.put('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const invalidImages = findInvalidImageSources(p.data);
    if (invalidImages.length > 0) {
      reply.code(400);
      // The bare 'invalid image source' string used to be the whole message the studio's error
      // extractor (which reads only `body.error`) ever surfaces as a toast — opaque on an install
      // with N images across M pages, and worse on autosave's 1.2s debounce with no click to
      // correlate. Name the offending element(s) IN the string; keep `invalidImages` for programmatic
      // callers.
      const error = `invalid image source: ${invalidImages.map((i) => `${i.elementId} (${i.reason})`).join(', ')}`;
      return { error, invalidImages };
    }
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDesigns.update(id, p.data);
    await recordAudit(ctx, req, { action: 'report-design.update', entityType: 'report-design', entityId: id, before, after });
    return after;
  });

  app.post('/api/report-designs/:id/publish', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    const after = await ctx.reportDesigns.publish(id, req.user?.id ?? null);
    await recordAudit(ctx, req, { action: 'report-design.publish', entityType: 'report-design', entityId: id, before, after });
    return after;
  });

  app.get('/api/report-designs/:id/versions', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    const design = await ctx.reportDesigns.get(id);
    if (!design) { reply.code(404); return { error: 'not found' }; }
    return ctx.reportDesigns.listVersions(id);
  });

  app.delete('/api/report-designs/:id', MANAGE, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.reportDesigns.get(id);
    if (!before) { reply.code(404); return { error: 'not found' }; }
    await ctx.reportDesigns.remove(id);
    await recordAudit(ctx, req, { action: 'report-design.delete', entityType: 'report-design', entityId: id, before, after: null });
    reply.code(204);
    return null;
  });

  // Resource-less: renders the POSTed working design (so unsaved/transient designs preview too).
  app.post('/api/report-designs/preview', PREVIEW, async (req, reply) => {
    const p = ReportDesignSchema.safeParse(req.body);
    if (!p.success) { reply.code(400); return { error: p.error.message }; }
    const design = p.data;

    // Binding contract: design.param.key === query.param.id (substituteParams keys by id),
    // so build values once from the design's own params — extra unmapped values are harmless.
    const values: Record<string, unknown> = {};
    for (const dp of design.parameters) if (dp.value != null) values[dp.key] = dp.value;

    // Per-table failures become an in-PDF placeholder, never a 500
    // (all store access lives inside runStoredQuery, inside resolveDesignTables' per-table catch).
    const resolved = await resolveDesignTables(design, values, (qid, v) => runStoredQuery(deps, qid, v));

    // Resolved fresh per preview so a Settings ▸ Laboratory edit shows up on the next render
    // without a restart — the same contract the other app-settings-backed services have.
    const pdf = await renderReportDesignPdf(design, resolved, { identity: await ctx.labIdentity.tokens() });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', 'inline; filename="report-design.pdf"');
    return reply.send(pdf);
  });
}
