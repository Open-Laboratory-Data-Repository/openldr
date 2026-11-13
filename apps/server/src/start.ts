import type { Config } from '@openldr/config';
import { createAppContext, createIngestContext, createDbContext, seedDatabase, seedEssentials, drainCrashMarkersToAudit, startUpdateCheck, type AppContext } from '@openldr/bootstrap';
import type { Logger } from '@openldr/core';
import { buildApp } from './app';
import { createUpdateFetch } from './update-fetch';
import { createShutdown } from './shutdown';
import { registerEventHandlers } from './register-event-handlers';

export interface RunningServer {
  /** For example http://127.0.0.1:3000 */
  address: string;
  context: AppContext;
  /** Runs the existing shutdown. Safe to call twice. */
  close(): Promise<void>;
}

/**
 * Opens the databases, builds the app and listens on `cfg.LISTEN_HOST`:`cfg.PORT`.
 *
 * It never calls `process.exit` and never installs signal or crash handlers. Those belong to the
 * program that calls it (`index.ts` for the Docker image). If a step throws after something was
 * opened, it closes what it opened, newest first, and then rethrows. A caller that catches the
 * rejection is then left with a process that can exit by itself.
 */
export async function startServer(cfg: Config, logger: Logger): Promise<RunningServer> {
  // Self-migrate on startup when enabled (single-port prod deployment). migrateToLatest is
  // idempotent, so a fresh DB gets its schema and an already-migrated one is a no-op. Runs
  // before any context that queries tables, so the app never serves 500s on an unmigrated DB.
  if (cfg.MIGRATE_ON_START) {
    const dbCtx = await createDbContext(cfg);
    try {
      const res = await dbCtx.migrateAll();
      if (res.internal.error || res.external.error) {
        throw (res.internal.error ?? res.external.error) as Error;
      }
      const internal = (res.internal.results ?? []).map((r) => r.migrationName);
      const external = (res.external.results ?? []).map((r) => r.migrationName);
      logger.info({ internal, external }, 'startup migration complete');
    } finally {
      await dbCtx.close();
    }
  }

  // ⛔ THE API SERVER IS THE PROCESS THAT DRAINS THE FACILITY-IMPORT QUEUE, and it is the only one:
  // an `openldr` CLI command builds an `AppContext` too, and that worker's construction sweeps stale
  // runs against the shared database (see `AppContextOptions.runFacilityImportWorker`). Uploading a
  // register through `POST /api/facilities/import/upload` mints a `queued` run that nothing else
  // will ever claim, so dropping this flag silently parks every background import forever.
  //
  // ⛔ The same holds for the facility job queue (`runFacilityJobWorker`). Dropping it parks every
  // facility-map rebuild and registry projection, and the Facilities chip reads "Updating" forever.
  // And for the terminology import queue (`runTerminologyIngestWorker`): dropping it leaves every
  // Studio terminology upload `queued` for good.
  // And for sync (`startSyncWorkers`): dropping it leaves the push and pull workers unbuilt until
  // someone opens the sync status, so a lab would stop syncing after a restart.
  const ctx = await createAppContext(cfg, {
    runFacilityImportWorker: true, runFacilityJobWorker: true, runTerminologyIngestWorker: true,
    startSyncWorkers: true,
  });

  // What is open so far, in the order it was opened. On a failed start these close newest first.
  const opened: Array<() => unknown> = [() => ctx.close()];
  try {
    // Ingest any crash markers left by a previous process-FATAL plugin crash into the audit
    // trail (action plugin.crash / system.crash). Best-effort: a drain failure must not block
    // startup. Runs once the audit store is available.
    try {
      await drainCrashMarkersToAudit({ dir: cfg.PLUGIN_CRASH_LOG_DIR, audit: ctx.audit, logger: ctx.logger });
    } catch (err) {
      ctx.logger.warn({ err }, 'crash-marker audit drain failed at startup (continuing)');
    }

    // Seed idempotent sample data after migration. The FULL demo seed (org/location/patient
    // resources, all sample forms, default connector, dashboards, reports, terminology, feature
    // flags) is opt-in via SEED_ON_START. But a minimum set MUST exist on every install regardless
    // of that flag — the Users-page form, the Lab order form, and the inbound ingestion workflow
    // bound to it — so `seedEssentials` runs UNCONDITIONALLY (mirroring the boot-time
    // roles.seedSystemRoles() call in createAppContext, which is also deliberately not SEED_ON_START-
    // gated). Both paths are idempotent (forms deduped by name, workflows by id) and best-effort:
    // a seed failure must not block startup. The full seed already includes the essentials, so the
    // two are mutually exclusive here to avoid seeding them twice.
    if (cfg.SEED_ON_START) {
      const dbCtx = await createDbContext(cfg);
      try {
        const { resources, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology } = await seedDatabase(dbCtx, ctx);
        logger.info({ resources: resources.length, formsSeeded, workflowsSeeded, connectorsSeeded, dashboardsSeeded, settingsSeeded, terminology }, 'startup seed complete');
      } finally {
        await dbCtx.close();
      }
    } else {
      try {
        const { formsSeeded, workflowsSeeded, connectorsSeeded, valueSetsImported } = await seedEssentials(ctx);
        logger.info({ formsSeeded, workflowsSeeded, connectorsSeeded, valueSetsImported }, 'essential seed complete (SEED_ON_START off)');
      } catch (err) {
        logger.warn({ err }, 'essential seed failed (continuing)');
      }
    }

    const ingest = await createIngestContext(cfg);
    opened.push(() => ingest.close());

    const app = await buildApp(ctx);
    opened.push(() => app.close());

    // Every background handler goes on the bus this process drains (ingest.startWorker() below).
    await registerEventHandlers(ctx, ingest.eventing);
    // Arming existing schedules is best-effort: a pending migration or transient DB
    // hiccup must not block server startup (the runner re-arms on the next firing).
    try {
      await ctx.reportScheduler.reconcile(ingest.eventing);
    } catch (err) {
      ctx.logger.warn({ err }, 'report schedule reconcile failed at startup (continuing)');
    }

    // Plugin schedules (e.g. the DHIS2 webview plugin) fire headlessly through the host
    // runner. The legacy host DHIS2 scheduler has been removed (SP-A2 Task 14); plugin
    // schedules live in `plugin_data` (migration 036 copied the host rows over), so this
    // runner is now the sole driver of DHIS2 (and any other plugin) schedules.
    try {
      await ctx.pluginScheduleRunner.reconcile(ingest.eventing);
    } catch (err) {
      ctx.logger.warn({ err }, 'plugin schedule reconcile failed at startup (continuing)');
    }

    // Best-effort like the report scheduler: rebuild the ingest-id set + webhook registry
    // and arm saved schedules. A bad migration or DB hiccup must not block startup.
    try {
      ctx.workflows.runner.setIngestWorkflowIds(
        (await ctx.workflows.store.list())
          .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"ingest"'))
          .map((w) => w.id),
      );
      ctx.workflows.runner.setEventWorkflowIds(
        (await ctx.workflows.store.list())
          .filter((w) => JSON.stringify(w.definition).includes('"triggerType":"event"'))
          .map((w) => w.id),
      );
      await ctx.workflows.runner.reconcile(ingest.eventing);
      await ctx.workflows.listeners.reconcile();
    } catch (err) {
      ctx.logger.warn({ err }, 'workflow trigger reconcile failed at startup (continuing)');
    }

    // Is a newer OpenLDR published? Polled here — not in buildApp — because this is the process that
    // arms every other background runner, and because buildApp is constructed by unit tests that must
    // not reach the network. Fills the `update.*` keys the /api/update route reads; the operator's
    // switch (PUT /api/settings/update) suppresses the request itself, so "off" means no traffic
    // leaves the lab. It NEVER pulls an image or restarts anything.
    const stopUpdateCheck = startUpdateCheck({
      check: ctx.updateCheck,
      fetchText: createUpdateFetch(),
      now: () => new Date().toISOString(),
      logger: ctx.logger,
    });
    opened.push(stopUpdateCheck);

    const worker = ingest.startWorker();
    opened.push(() => worker.stop());

    const shutdown = createShutdown({
      stopUpdateCheck,
      closeApp: () => app.close(),
      stopWorker: () => worker.stop(),
      closeIngest: () => ingest.close(),
      closeContext: () => ctx.close(),
    });

    // LISTEN_HOST defaults to all interfaces; the reverse proxy owns the external port (P1-NFR-7).
    const address = await app.listen({ port: cfg.PORT, host: cfg.LISTEN_HOST });
    return { address, context: ctx, close: shutdown };
  } catch (err) {
    for (let i = opened.length - 1; i >= 0; i--) {
      try {
        await opened[i]!();
      } catch (closeErr) {
        logger.warn({ err: closeErr }, 'closing after a failed start failed (continuing)');
      }
    }
    throw err;
  }
}
