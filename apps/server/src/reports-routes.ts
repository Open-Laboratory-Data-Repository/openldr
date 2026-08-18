import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { ReportNotFoundError, type AppContext } from '@openldr/bootstrap';
import { toCsv, nextRunAt, GLASS_SUBMISSION_COLUMNS, type ScheduleFrequency } from '@openldr/reporting';
import { appError, type AppError } from '@openldr/core';
import { requireCapability } from './rbac';

const runBeaconBody = z.object({
  format: z.enum(['preview', 'csv', 'pdf', 'xlsx']),
  rowCount: z.number().int().nullable().optional(),
  params: z.record(z.string()).optional(),
});

const FREQ = z.enum(['daily', 'weekly', 'monthly', 'quarterly']);
const FORMAT = z.enum(['csv', 'xlsx', 'pdf']);
const scheduleCreate = z.object({
  frequency: FREQ,
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT,
  params: z.record(z.string()).optional(),
});
const FORMAT_CONTENT_TYPE: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const schedulePatch = z.object({
  enabled: z.boolean().optional(),
  frequency: FREQ.optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  outputFormat: FORMAT.optional(),
  params: z.record(z.string()).optional(),
});

// These routes (other than the schedule-mutation ones, which were already MANAGE-gated) were
// previously UNGATED (no requireRole at all). Task 8 adds capability gates per the mapping table:
// read/list/options/run-history routes require reports.view; report execution (the JSON preview
// at GET /:id, and the run-record beacon) requires reports.run; downloads (csv/pdf/schedule-run
// artifact) require reports.export; schedule create/update/delete/run-now — previously grouped
// under one MANAGE guard — require reports.edit_templates (kept as one group, matching the
// pre-existing single guard object).
const VIEW = { preHandler: requireCapability('reports.view') };
const RUN = { preHandler: requireCapability('reports.run') };
const EXPORT = { preHandler: requireCapability('reports.export') };
const EDIT_TEMPLATES = { preHandler: requireCapability('reports.edit_templates') };

export function registerReportRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext): void {
  app.get('/api/reports', VIEW, async () => ctx.reporting.listAll());

  // Register the .csv route BEFORE the bare :id route so it is matched first.
  app.get('/api/reports/:id.csv', EXPORT, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.reporting.run(id, req.query);
      reply.header('content-type', 'text/csv').header('content-disposition', `attachment; filename="${id}.csv"`);
      return toCsv(result.columns, result.rows);
    } catch (err) {
      rethrowAsAppError(err);
    }
  });

  app.get('/api/reports/glass/ris.csv', EXPORT, async (req, reply) => {
    try {
      const result = await ctx.reporting.run('r-amr-glass-ris', req.query as Record<string, unknown>);
      reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="glass-ris.csv"');
      // The PINNED submission shape, not result.columns — see GLASS_SUBMISSION_COLUMNS.
      return toCsv(GLASS_SUBMISSION_COLUMNS as { key: string; label: string }[], result.rows);
    } catch (err) { rethrowAsAppError(err); }
  });

  app.get('/api/reports/:id.pdf', EXPORT, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const buf = await ctx.reporting.renderPdf(id, req.query);
      reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${id}.pdf"`);
      return reply.send(buf);
    } catch (err) { rethrowAsAppError(err); }
  });

  app.get('/api/reports/:id/options', VIEW, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.options(id);
    } catch (err) {
      rethrowAsAppError(err);
    }
  });

  app.get('/api/reports/runs', VIEW, async (req) => {
    const q = req.query as { reportId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportRuns.list({ reportId: q.reportId, limit, offset });
  });

  app.post('/api/reports/:id/runs', RUN, async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof runBeaconBody>;
    try {
      body = runBeaconBody.parse(req.body);
    } catch (err) {
      rethrowAsAppError(err);
    }
    const def = await ctx.reporting.findSummary(id);
    if (!def) throw appError('RP0002', { message: `report not found: ${id}` });
    const user = req.user;
    await ctx.reportRuns.record({
      reportId: id,
      reportName: def.name,
      format: body.format,
      params: body.params ?? {},
      rowCount: body.rowCount ?? null,
      userId: user?.id ?? null,
      userName: user?.username ?? null,
    });
    reply.code(201);
    return { ok: true };
  });

  app.get('/api/reports/:id/schedules', VIEW, async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportSchedules.listPaged({ reportId: id, limit, offset });
  });

  app.post('/api/reports/:id/schedules', EDIT_TEMPLATES, async (req, reply) => {
    const { id } = req.params as { id: string };
    let body: z.infer<typeof scheduleCreate>;
    try { body = scheduleCreate.parse(req.body); } catch (err) { rethrowAsAppError(err); }
    if (!(await ctx.reporting.findSummary(id))) throw appError('RP0002', { message: `report not found: ${id}` });
    const sid = randomUUID();
    const nextDueAt = nextRunAt(body.frequency as ScheduleFrequency, body.dayOfWeek ?? null, body.dayOfMonth ?? null, new Date());
    await ctx.reportSchedules.create({
      id: sid, reportId: id, params: body.params ?? {}, frequency: body.frequency,
      dayOfWeek: body.dayOfWeek ?? null, dayOfMonth: body.dayOfMonth ?? null,
      outputFormat: body.outputFormat, createdBy: req.user?.id ?? null, nextDueAt,
    });
    await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    reply.code(201);
    return await ctx.reportSchedules.get(sid);
  });

  app.patch('/api/reports/schedules/:sid', EDIT_TEMPLATES, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    let body: z.infer<typeof schedulePatch>;
    try { body = schedulePatch.parse(req.body); } catch (err) { rethrowAsAppError(err); }
    const existing = await ctx.reportSchedules.get(sid);
    if (!existing) throw appError('RP0002', { message: `schedule not found: ${sid}` });
    const timingChanged = body.frequency !== undefined || body.dayOfWeek !== undefined || body.dayOfMonth !== undefined;
    const nextDueAt = timingChanged
      ? nextRunAt((body.frequency ?? existing.frequency) as ScheduleFrequency,
          body.dayOfWeek !== undefined ? body.dayOfWeek : existing.dayOfWeek,
          body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth, new Date())
      : undefined;
    await ctx.reportSchedules.update(sid, { ...body, ...(nextDueAt ? { nextDueAt } : {}) });
    if (nextDueAt) await ctx.eventing.publish({ type: 'report.schedule.due', payload: { scheduleId: sid } }, { availableAt: nextDueAt });
    return await ctx.reportSchedules.get(sid);
  });

  app.delete('/api/reports/schedules/:sid', EDIT_TEMPLATES, async (req) => {
    const { sid } = req.params as { sid: string };
    await ctx.reportSchedules.remove(sid);
    return { ok: true };
  });

  app.post('/api/reports/schedules/:sid/run', EDIT_TEMPLATES, async (req, reply) => {
    const { sid } = req.params as { sid: string };
    if (!(await ctx.reportSchedules.get(sid))) { reply.code(404); return { error: `schedule not found: ${sid}` }; }
    ctx.reportScheduler.runNow(sid);
    reply.code(202);
    return { ok: true };
  });

  app.get('/api/reports/schedule-runs', VIEW, async (req) => {
    const q = req.query as { reportId?: string; scheduleId?: string; limit?: string; offset?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    return ctx.reportSchedules.listRuns({ reportId: q.reportId, scheduleId: q.scheduleId, limit, offset });
  });

  app.get('/api/reports/schedule-runs/:runId/download', EXPORT, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = await ctx.reportSchedules.getRun(runId);
    if (!run || !run.objectKey) { reply.code(404); return { error: 'run output not found' }; }
    const bytes = await ctx.blob.get(run.objectKey);
    const ct = FORMAT_CONTENT_TYPE[run.outputFormat] ?? 'application/octet-stream';
    void reply.header('content-type', ct);
    void reply.header('content-disposition', `attachment; filename="${run.reportId}.${run.outputFormat}"`);
    return reply.send(Buffer.from(bytes));
  });

  app.get('/api/reports/:id', RUN, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await ctx.reporting.run(id, req.query);
    } catch (err) {
      rethrowAsAppError(err);
    }
  });
}

// Reports-specific error mapping: turn the known reports failures into catalog codes and throw
// so the central error handler renders them uniformly ({ error, code, correlationId }). Anything
// else re-throws unchanged and is classified as a SY#### fallback by the central handler.
function rethrowAsAppError(err: unknown): never {
  if (err instanceof ReportNotFoundError) throw appError('RP0002', { message: err.message, cause: err });
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw appError('RP0004', { message: `invalid report parameters: ${fields}`, details: err.flatten(), cause: err });
  }
  throw asParamError(err) ?? err;
}

// `substituteParams` (packages/dashboards/src/custom-query-run.ts) reports every bad run value as a
// plain Error, so all three landed in the SY0500 catch-all — a 500 that blamed the server for what
// is always a CLIENT mistake, and gave Studio nothing to show but "failed: 500". The commonest case
// by far is simply running a report before picking its (required) date range.
//
// Matched with ANCHORED patterns against the exact strings that function throws. A loose substring
// test would silently downgrade real server faults that happen to mention a parameter — e.g. a
// Postgres `relation "parameters" does not exist` — from 500 to 400, hiding an outage as bad input.
const PARAM_ERRORS = [
  { re: /^required parameter: (.+)$/, code: 'RP0004' as const },
  { re: /^unbound parameter: (.+)$/, code: 'RP0004' as const },
  { re: /^invalid date: (.+)$/, code: 'RP0004' as const },
  // A value that violates the format its parameter DECLARES — thrown by `assertParamFormats`
  // (packages/bootstrap/src/index.ts) from `paramFormatMessage` (packages/core/src/param-format.ts).
  // Same anchoring discipline as the three above: the prefix is fixed by that function and nothing
  // else emits it, so a server fault that merely mentions a parameter cannot be caught here.
  // The message already names the field and what it accepts, so it is forwarded verbatim.
  { re: /^invalid parameter: (.+)$/, code: 'RP0004' as const },
];
// The query declares its date bounds as two separate params (`from`/`to`), so a missing one arrives
// as `required parameter: from`. That is the catalog's RP0001 ("date range not selected") — a more
// actionable thing to put in front of an operator than the generic invalid-parameters code.
const DATE_BOUND_IDS = new Set(['from', 'to', 'dateRange', 'dateFrom', 'dateTo']);

function asParamError(err: unknown): AppError | null {
  if (!(err instanceof Error)) return null;
  for (const { re, code } of PARAM_ERRORS) {
    const m = re.exec(err.message);
    if (!m) continue;
    const isMissingDateBound = code === 'RP0004' && re.source.startsWith('^required') && DATE_BOUND_IDS.has(m[1]);
    return appError(isMissingDateBound ? 'RP0001' : code, { message: err.message, cause: err });
  }
  return null;
}
