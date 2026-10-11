import type { FastifyInstance } from 'fastify';
import { parseResultFieldQuery, TEST_MAPPING_IMPORT_MAX_BYTES, type AppContext } from '@openldr/bootstrap';
import { z } from 'zod';
import { recordAudit } from './audit-helper';
import { requireCapability } from './rbac';
import { readUpload, replyMappingError } from './test-mapping-routes';

// Result fields (docs/superpowers/specs/2026-10-11-result-field-mapping-design.md, 4.5 and 4.6): the
// result dictionary and each field's LOINC link. Same gates as the test mapping routes.
const VIEW = { preHandler: requireCapability('terminology.view') };
const MANAGE = { preHandler: requireCapability('terminology.manage') };
const IMPORT_STEP = { ...MANAGE, bodyLimit: TEST_MAPPING_IMPORT_MAX_BYTES + 1024 };

const linkBody = z.object({ loinc: z.string().min(1) });

export function registerResultFieldsRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req: unknown, payload: unknown, done: (e: null, b: unknown) => void) => done(null, payload));
  }

  app.get('/api/test-catalog/result-fields', VIEW, async (req, reply) => {
    const parsed = parseResultFieldQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    return reply.send(await ctx.resultFields.list(parsed.query));
  });

  app.put('/api/test-catalog/result-fields/:code/loinc', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    const parsed = linkBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'loinc is required' });
    try {
      const change = await ctx.resultFields.link(code, parsed.data.loinc);
      await recordAudit(ctx, req, {
        action: 'result_field.link', entityType: 'result_field', entityId: code,
        before: { loinc: change.before }, after: { loinc: change.after },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.delete('/api/test-catalog/result-fields/:code/loinc', MANAGE, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const change = await ctx.resultFields.unlink(code);
      await recordAudit(ctx, req, {
        action: 'result_field.unlink', entityType: 'result_field', entityId: code,
        before: { loinc: change.before }, after: { loinc: null },
      });
      return reply.send(change);
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.get('/api/test-catalog/result-fields/export', VIEW, async (_req, reply) => {
    const csv = await ctx.resultFields.exportCsv();
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="result-fields.csv"')
      .send(csv);
  });

  app.post('/api/test-catalog/result-fields/import/preview', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      return reply.send(await ctx.resultFields.importPreview(bytes));
    } catch (err) { return replyMappingError(err, reply); }
  });

  app.post('/api/test-catalog/result-fields/import/apply', IMPORT_STEP, async (req, reply) => {
    const bytes = await readUpload(req.body);
    if (!bytes) return reply.code(400).send({ error: 'send the CSV file as application/octet-stream' });
    try {
      const report = await ctx.resultFields.importApply(bytes);
      await recordAudit(ctx, req, {
        action: 'result_field.import', entityType: 'result_field', entityId: 'import',
        before: null, after: null, metadata: { counts: report.counts, refused: report.refused },
      });
      return reply.send(report);
    } catch (err) { return replyMappingError(err, reply); }
  });
}
