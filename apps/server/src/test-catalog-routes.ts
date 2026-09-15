import type { FastifyInstance, FastifyReply } from 'fastify';
import { catalogChangeAction, parseCatalogListQuery, TestCatalogError, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test catalog S1 (docs/superpowers/specs/2026-09-15-test-catalog-design.md, 4.6): terminology.view
// to read, terminology.manage to change anything, central edits and lab settings alike.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };

const coding = z.object({ system: z.string().min(1), code: z.string().min(1) });
const testInput = z.object({
  code: z.string().nullish(),
  display: z.string(),
  shortName: z.string().nullish(),
  category: z.string().nullish(),
  specimenTypes: z.array(coding).optional(),
  loinc: z.string().nullish(),
  active: z.boolean().optional(),
});
const labInput = z.object({
  enabled: z.boolean(),
  specimenTypes: z.array(coding).nullable(),
  localDisplay: z.string().nullable(),
});
const enabledInput = z.object({ enabled: z.boolean() });
const activeInput = z.object({ active: z.boolean() });

// A catalog refusal keeps its words and says which kind it is. Anything else goes to the shared
// error handler.
function replyCatalogError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

export function registerTestCatalogRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/test-catalog', VIEW, async (req, reply) => {
    const parsed = parseCatalogListQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testCatalog.list(parsed.query));
  });

  // The page's pickers read this, not a ValueSet expansion, so they offer exactly what a save accepts.
  app.get('/api/test-catalog/options', VIEW, async (_req, reply) => {
    return reply.send(await ctx.testCatalog.options());
  });

  app.post('/api/test-catalog', MANAGE, async (req, reply) => {
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const created = await ctx.testCatalog.create(parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.create', entityType: 'test_catalog', entityId: created.code, before: null, after: created });
      return reply.code(201).send(created);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = testInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const updated = await ctx.testCatalog.update(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.update', entityType: 'test_catalog', entityId: code, before, after: updated });
      return reply.send(updated);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/lab', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = labInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = (await ctx.testCatalog.get(code))?.lab ?? null;
      const saved = await ctx.testCatalog.setLabSettings(code, parsed.data);
      await recordAudit(ctx, req, { action: 'test_catalog.lab_settings', entityType: 'test_catalog', entityId: code, before, after: saved.lab });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  // The page's row actions. Each changes one field; `openldr test-catalog enable | disable | retire |
  // restore` calls the same service methods and records the same audit action.
  app.put('/api/test-catalog/:code/enabled', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = enabledInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setEnabled(code, parsed.data.enabled);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('enabled', parsed.data.enabled), entityType: 'test_catalog', entityId: code,
        before: { enabled: before?.lab.enabled ?? null }, after: { enabled: saved.lab.enabled },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });

  app.put('/api/test-catalog/:code/active', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = activeInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const before = await ctx.testCatalog.get(code);
      const saved = await ctx.testCatalog.setActive(code, parsed.data.active);
      await recordAudit(ctx, req, {
        action: catalogChangeAction('active', parsed.data.active), entityType: 'test_catalog', entityId: code,
        before: { active: before?.active ?? null }, after: { active: saved.active },
      });
      return reply.send(saved);
    } catch (err) {
      return replyCatalogError(err, reply);
    }
  });
}
