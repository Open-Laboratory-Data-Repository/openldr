import { describe, it, expect } from 'vitest';
import type { EventingPort } from '@openldr/ports';
import { registerEventHandlers } from './register-event-handlers';

// The outbox is ONE table, but each event bus instance keeps its own handler map. The server drains
// exactly one bus (the ingest context's). A handler registered on any other instance is never called,
// and its events are re-deferred forever with no error: that is how every workflow webhook sat
// `queued` after receipt tracking landed. This pins that every background handler is registered on
// the bus the server drains.
describe('registerEventHandlers', () => {
  it('registers every background handler on the bus the server drains', async () => {
    const drained = { name: 'drained' } as unknown as EventingPort;
    const seen: Record<string, unknown> = {};
    const ctx = {
      reportScheduler: { registerRunner: async (e: unknown) => { seen.reportScheduler = e; } },
      pluginScheduleRunner: { registerRunner: async (e: unknown) => { seen.pluginScheduleRunner = e; } },
      workflows: {
        runner: { registerRunner: async (e: unknown) => { seen.workflowRunner = e; } },
        receipts: { register: async (e: unknown) => { seen.webhookReceipts = e; } },
      },
    };

    await registerEventHandlers(ctx as never, drained);

    expect(seen).toEqual({
      reportScheduler: drained,
      pluginScheduleRunner: drained,
      workflowRunner: drained,
      webhookReceipts: drained,
    });
  });
});
