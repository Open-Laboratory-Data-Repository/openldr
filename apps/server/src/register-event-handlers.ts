import type { AppContext } from '@openldr/bootstrap';
import type { EventingPort } from '@openldr/ports';

type HandlerOwners = {
  reportScheduler: Pick<AppContext['reportScheduler'], 'registerRunner'>;
  pluginScheduleRunner: Pick<AppContext['pluginScheduleRunner'], 'registerRunner'>;
  workflows: {
    runner: Pick<AppContext['workflows']['runner'], 'registerRunner'>;
    receipts: Pick<AppContext['workflows']['receipts'], 'register'>;
  };
};

/**
 * Register every background event handler on `eventing`, which must be the bus this process drains
 * (`ingest.startWorker()` in index.ts).
 *
 * The outbox is one table, but each event bus instance keeps its own handler map. A handler on an
 * instance nobody drains is never called, and the drainer re-defers its events every 60 seconds with
 * no error. That is how every workflow webhook stayed `queued` after receipt tracking (010d288a)
 * registered its handler on the app context's bus instead of this one.
 */
export async function registerEventHandlers(ctx: HandlerOwners, eventing: EventingPort): Promise<void> {
  await ctx.reportScheduler.registerRunner(eventing);
  await ctx.pluginScheduleRunner.registerRunner(eventing);
  await ctx.workflows.runner.registerRunner(eventing);
  await ctx.workflows.receipts.register(eventing);
}
