import type { FastifyInstance, FastifyReply } from 'fastify';
import { parseMapLevel, parseObservedQuery, TestCatalogError, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';

// Test mapping and result field mapping (docs/superpowers/specs/2026-10-11-test-mapping-design.md and
// 2026-10-11-result-field-mapping-design.md). Same gates as the catalog routes: terminology.view to
// read, terminology.manage to change.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
const IMPORT_STEP = { ...MANAGE, bodyLimit: TEST_MAPPING_IMPORT_MAX_BYTES + 1024 };

const level = z.enum(['test', 'result']).optional();
// catalogCode is the target code at either level: a catalog test, or a result field at level 'result'.
const setBody = z.object({ system: z.string().min(1), code: z.string().min(1), catalogCode: z.string().min(1), level });
const clearBody = z.object({ system: z.string().min(1), code: z.string().min(1), level });
const matchBody = z.object({ system: z.string().min(1) });

// A refusal keeps its words and says which kind it is, as replyCatalogError does in test-catalog-routes.ts.
export function replyMappingError(err: unknown, reply: FastifyReply) {
  if (!(err instanceof TestCatalogError)) throw err;
  const status = err.kind === 'invalid' ? 400 : err.kind === 'not-found' ? 404 : 409;
  return reply.code(status).send({ error: err.message, kind: err.kind });
}

export async function readUpload(body: unknown): Promise<Buffer | null> {
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

/** The level from a query string. Blank means 'test'. */
function levelOf(query: unknown): ReturnType<typeof parseMapLevel> {
  return parseMapLevel((query as Record<string, unknown> | undefined)?.level);
}

export function registerTestMappingRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog/mappings/observed', VIEW, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    const parsed = parseObservedQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.testMapping.observed(parsed.query, level));
  });

  app.get('/api/test-catalog/mappings/targets', VIEW, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    return reply.send({ targets: await ctx.testMapping.targets(level) });
  });

  app.put('/api/test-catalog/mappings', MANAGE, async (req, reply) => {
    const parsed = setBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system, code and catalogCode are required; level must be test or result' });
    const lvl = parsed.data.level ?? 'test';
    try {
      const change = await ctx.testMapping.set(parsed.data.system, parsed.data.code, parsed.data.catalogCode, lvl);
      await recordAudit(ctx, req, {
        action: 'test_mapping.set', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: change.after }, metadata: { level: lvl, rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/clear', MANAGE, async (req, reply) => {
    const parsed = clearBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system and code are required; level must be test or result' });
    const lvl = parsed.data.level ?? 'test';
    try {
      const change = await ctx.testMapping.clear(parsed.data.system, parsed.data.code, lvl);
      await recordAudit(ctx, req, {
        action: 'test_mapping.clear', entityType: 'test_mapping', entityId: `${change.system}|${change.code}`,
        before: { catalogCode: change.before }, after: { catalogCode: null }, metadata: { level: lvl, rebuild: change.rebuild.ok },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/mappings/export', VIEW, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    const csv = await ctx.testMapping.exportCsv(level);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${level === 'result' ? 'result' : 'test'}-mappings.csv"`)
      .send(csv);
  });

  app.post('/api/test-catalog/mappings/import/preview', IMPORT_STEP, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      return reply.send(await ctx.testMapping.importPreview(bytes, level));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/import/apply', IMPORT_STEP, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      const report = await ctx.testMapping.importApply(bytes, level);
      await recordAudit(ctx, req, {
        action: 'test_mapping.import', entityType: 'test_mapping', entityId: 'import',
        before: null, after: null, metadata: { level, counts: report.counts, refused: report.refused, rebuild: report.rebuild?.ok ?? null },
      });
      return reply.send(report);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/mappings/systems', VIEW, async (req, reply) => {
    const lvl = levelOf(req.query);
    if (!lvl.ok) return reply.code(400).send({ error: lvl.error });
    const level = lvl.level;
    return reply.send({ systems: await ctx.testMapping.observedSystems(level) });
  });

  // Map matching codes (result field mapping spec 4.5). Result level only.
  app.get('/api/test-catalog/mappings/match', VIEW, async (req, reply) => {
    const system = (req.query as Record<string, unknown> | undefined)?.system;
    if (typeof system !== 'string' || system === '') return reply.code(400).send({ error: 'system is required' });
    try {
      return reply.send(await ctx.testMapping.planMatch(system));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/match', MANAGE, async (req, reply) => {
    const parsed = matchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'system is required' });
    try {
      const out = await ctx.testMapping.applyMatch(parsed.data.system);
      await recordAudit(ctx, req, {
        action: 'test_mapping.match', entityType: 'test_mapping', entityId: `match:${out.system}`,
        before: null, after: null,
        metadata: { level: 'result', system: out.system, codes: out.matches.map((m) => m.code), count: out.matches.length, rebuild: out.rebuild.ok },
      });
      return reply.send(out);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/mappings/rebuild', MANAGE, async (_req, reply) => {
    return reply.send(await ctx.testMapping.rebuildNow());
  });
}
