import type { FastifyInstance } from 'fastify';
import { installHoldsLabData, loadSampleData, sampleDataDeps, type AppContext, type SampleDataCounts } from '@openldr/bootstrap';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

export interface SampleDataRouteDeps {
  /** Injectable for tests; defaults to installHoldsLabData over the app context. */
  holdsLabData?: () => Promise<boolean>;
  /** Injectable for tests; defaults to loadSampleData over the app context. */
  load?: () => Promise<SampleDataCounts>;
}

// The administrator role holds settings.danger_zone, and its holder can already reset the
// install, which seeds too.
const DANGER_ZONE = { preHandler: requireCapability('settings.danger_zone') };

export function registerSampleDataRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: SampleDataRouteDeps = {}): void {
  const holdsLabData = deps.holdsLabData ?? (() => installHoldsLabData(sampleDataDeps(ctx)));
  const load = deps.load ?? (() => loadSampleData(sampleDataDeps(ctx)));
  // One load at a time in this process. Two loads at once would both pass the check.
  let busy = false;

  // Whether sample data may load, so the first-run step can hide itself.
  app.get('/api/settings/sample-data', DANGER_ZONE, async (_req, reply) => {
    const allowed = !(await holdsLabData());
    reply.header('Cache-Control', 'no-store');
    return reply.send({ allowed });
  });

  // Loads what `openldr db seed` loads. It checks again itself and never trusts an earlier GET.
  app.post('/api/settings/sample-data', DANGER_ZONE, async (req, reply) => {
    if (busy) {
      return reply.code(409).send({ error: 'Sample data is already loading.', code: 'sample_data_busy' });
    }
    busy = true;
    try {
      if (await holdsLabData()) {
        return reply.code(409).send({ error: 'This install already holds lab data, so sample data was not loaded.', code: 'has_lab_data' });
      }
      let counts: SampleDataCounts;
      try {
        counts = await load();
      } catch (err) {
        // Not the error itself: its text could hold a host or a query. Its name and a database
        // error code are safe and enough to start looking.
        const e = err as { name?: unknown; code?: unknown } | null;
        ctx.logger.error({
          name: typeof e?.name === 'string' ? e.name : undefined,
          code: typeof e?.code === 'string' ? e.code : undefined,
        }, 'sample data load failed');
        // seedDatabase writes the sample organization, location and patient first, so a load that
        // fails partway can leave sample data behind. Record who asked, with no error text.
        try {
          await recordAudit(ctx, req, {
            action: 'settings.sample_data.load', entityType: 'system', entityId: 'sample-data',
            metadata: { ok: false },
          });
        } catch { /* the 500 still goes out */ }
        return reply.code(500).send({ error: 'Sample data could not be loaded.' });
      }
      await recordAudit(ctx, req, {
        action: 'settings.sample_data.load', entityType: 'system', entityId: 'sample-data',
        metadata: {
          ok: true,
          formsSeeded: counts.formsSeeded,
          workflowsSeeded: counts.workflowsSeeded,
          connectorsSeeded: counts.connectorsSeeded,
          dashboardsSeeded: counts.dashboardsSeeded,
          settingsSeeded: counts.settingsSeeded,
        },
      });
      return reply.send({
        ok: true,
        formsSeeded: counts.formsSeeded,
        workflowsSeeded: counts.workflowsSeeded,
        connectorsSeeded: counts.connectorsSeeded,
        dashboardsSeeded: counts.dashboardsSeeded,
        settingsSeeded: counts.settingsSeeded,
      });
    } finally {
      busy = false;
    }
  });
}
