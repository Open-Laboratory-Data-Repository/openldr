import type { FastifyInstance } from 'fastify';
import { runSetupChecks, setupCheckDeps, type AppContext, type SetupReport } from '@openldr/bootstrap';
import { requireCapability } from './rbac';
import { recordAudit } from './audit-helper';

export interface SetupRouteDeps {
  /** Injectable for tests; defaults to the real checks over the app context. */
  run?: () => Promise<SetupReport>;
}

export function registerSetupRoutes(app: FastifyInstance<any, any, any, any>, ctx: AppContext, deps: SetupRouteDeps = {}): void {
  const run = deps.run ?? (() => runSetupChecks(setupCheckDeps(ctx)));

  // What this install still needs before it is ready. The same list as `openldr doctor`.
  // POST, not GET: it opens test connections with the stored connector credentials and writes an
  // audit row, like /api/connectors/:id/diagnose. The audit row holds check ids only.
  app.post('/api/settings/setup-checks', { preHandler: requireCapability('settings.view') }, async (req, reply) => {
    let report: SetupReport;
    try {
      report = await run();
    } catch {
      reply.code(500);
      return { error: 'setup checks could not run' };
    }
    const ids = (status: string) => report.checks.filter((c) => c.status === status).map((c) => c.id);
    await recordAudit(ctx, req, {
      action: 'setup.check', entityType: 'system', entityId: 'setup',
      metadata: { ok: report.ok, failed: ids('fail'), warned: ids('warn') },
    });
    reply.header('Cache-Control', 'no-store');
    return report;
  });
}
