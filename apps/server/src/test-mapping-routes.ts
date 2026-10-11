import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseObservedQuery, TestCatalogError, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md, 4.4 to 4.6). Same gates as
// the catalog routes: terminology.view to read, terminology.manage to change.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
const IMPORT_STEP = { ...MANAGE, bodyLimit: TEST_MAPPING_IMPORT_MAX_BYTES + 1024 };

const setBody = z.object({ system: z.string().min(1), code: z.string().min(1), catalogCode: z.string().min(1) });
const clearBody = z.object({ system: z.string().min(1), code: z.string().min(1) });

// A refusal keeps its words and says which kind it is, as replyCatalogError does in test-catalog-routes.ts.
function replyMappingError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

async function readUpload(body: unknown): Promise<Buffer | null> {
  if (!body || typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] !== 'function') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > TEST_MAPPING_IMPORT_MAX_BYTES) break;
  }
  return Buffer.concat(chunks);
}

export function registerTestMappingRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog/mappings/observed', VIEW, async (req, reply) => {
    const parsed = parseObservedQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testMapping.observed(parsed.query));
  });

  app.get('/api/test-catalog/mappings/targets', VIEW, async (_req, reply) => {
    return reply.send({ targets: await ctx.testMapping.targets() });
  });

  app.put('/api/test-catalog/mappings', MANAGE, async (req, reply) => {
    const parsed = setBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system, code and catalogCode are required' });
    try {
      const change = await ctx.testMapping.set(parsed.data.system, parsed.data.code, parsed.data.catalogCode);
      await recordAudit(ctx, req, {
        action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/clear', MANAGE, async (req, reply) => {
    const parsed = clearBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system and code are required' });
    try {
      const change = await ctx.testMapping.clear(parsed.data.system, parsed.data.code);
      await recordAudit(ctx, req, {
        action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/mappings/export', VIEW, async (_req, reply) => {
    const csv = await ctx.testMapping.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="test-mappings.csv"')
      .send(csv);
  });

  app.post('/api/test-catalog/mappings/import/preview', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      return reply.send(await ctx.testMapping.importPreview(bytes));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/import/apply', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      const report = await ctx.testMapping.importApply(bytes);
      await recordAudit(ctx, req, {
        action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
      });
      return reply.send(report);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/rebuild', MANAGE, async (_req, reply) => {
    return reply.send(await ctx.testMapping.rebuildNow());
  });
}
