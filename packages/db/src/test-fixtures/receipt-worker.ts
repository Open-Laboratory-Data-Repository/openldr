import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { InternalSchema } from '../schema/internal';
import { createEventBus } from '../../../adapter-event-bus/src/index';
import { createWorkflowReceiptService } from '../../../workflows/src/receipt-service';

const [schema, mode] = process.argv.slice(2);
if (!/^receipt_[a-f0-9]+$/.test(schema)) throw new Error('Expected isolated receipt test schema');
const url = process.env.WEBHOOK_TEST_DATABASE_URL!;
const options = { connectionString: url, options: `-c search_path=${schema}` };
const db = new Kysely<InternalSchema>({ dialect: new PostgresDialect({ pool: new pg.Pool(options) }) });
const bus = createEventBus({ url, leaseMs: 300 }, { pool: new pg.Pool(options) });
const service = createWorkflowReceiptService({ db, execute: async (_definition, runId, workflowId) => {
  if (mode === 'before-effect') {
    process.send?.('started');
    await new Promise(() => {});
  }
  await sql`insert into receipt_test_effects (receipt_run_id) values (${runId})`.execute(db);
  if (mode === 'after-effect') {
    process.send?.('effect');
    await new Promise(() => {});
  }
  return { id: runId, workflowId, triggerSource: 'webhook', status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result: { results: [] }, error: null };
} });
try {
  await service.register(bus);
  if (mode === 'before-claim') {
    process.send?.('ready');
    await new Promise(() => {});
  }
  await bus.drain();
  await bus.close();
  await db.destroy();
  process.send?.('complete');
  process.disconnect?.();
} catch (error) {
  process.send?.({ error: String(error) });
  process.exit(1);
}
