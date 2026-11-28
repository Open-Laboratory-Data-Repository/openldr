import { createAppContext, recordAuditEvent, setWorkflowEnabled, syncWorkflowSchedules, continueWorkflowReceipt } from '@openldr/bootstrap';
import { describeInterruption } from './interruptions';
import { loadConfig } from '@openldr/config';
import { cliNamedActor } from './cli-actor';
import { redactError } from './redact-error';

/**
 * `openldr workflows enable|disable <id>`: the studio row menu's Enable and Disable, through the same
 * shared code (bootstrap workflow-enabled.ts). Only `enabled` changes. A webhook follows at once,
 * because each request reads the stored workflow. A schedule follows at once too: its rows are
 * stored and its first run is put on the durable queue the running server drains, in one
 * database write (bootstrap workflow-schedules.ts, as the save routes do). A running server picks up listeners, ingest and
 * event triggers at its next start.
 */
export async function runWorkflowSetEnabled(id: string, enabled: boolean): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const changed = await setWorkflowEnabled(ctx.workflows.store, id, enabled);
    if (!changed) {
      process.stderr.write(`Workflow not found: ${id}\n`);
      return 1;
    }
    await syncWorkflowSchedules({ schedules: ctx.workflows.schedules, logger: ctx.logger }, changed.after);
    await recordAuditEvent(ctx, cliNamedActor(), {
      action: enabled ? 'workflow.enable' : 'workflow.disable', entityType: 'workflow', entityId: id,
    });
    process.stdout.write(`${changed.after.name} is ${enabled ? 'enabled' : 'disabled'}. Webhooks and schedules follow now. `
      + 'Restart the server for listeners, ingest and event triggers to follow.\n');
    return 0;
  } catch (err) {
    // A path refusal names workflows only, so it is printed as it is.
    const message = err instanceof Error && err.name === 'WebhookPathClaimedError' ? err.message : redactError(err);
    process.stderr.write(`workflows ${enabled ? 'enable' : 'disable'} failed: ${message}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}

export async function runWorkflowReceiptsList(workflowId: string, opts: { limit?: string; offset?: string; json: boolean }): Promise<number> {
  const limit = Number(opts.limit ?? '25');
  const offset = Number(opts.offset ?? '0');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
    process.stderr.write('Receipt limit must be 1 to 100; offset must be a non-negative integer.\n');
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = await ctx.workflows.receipts.list(workflowId, { limit, offset });
    const cuts = rows.length > 0 ? await ctx.jobInterruptions.listFor('workflow-receipt', rows.map((r) => r.id)) : new Map();
    process.stdout.write(opts.json ? JSON.stringify(rows.map((r) => ({ ...r, interruptions: cuts.get(r.id) ?? [] })), null, 2) + '\n' :
      (rows.map(row => [`${row.id}\t${row.status}\t${row.runId ?? ''}\t${row.createdAt}`, ...(cuts.get(row.id) ?? []).map(describeInterruption)].join('\n')).join('\n') || '(no receipts)') + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

export async function runWorkflowReceiptShow(requestId: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const receipt = await ctx.workflows.receipts.get(requestId);
    if (!receipt) {
      process.stdout.write(opts.json ? '{"error":"receipt not found"}\n' : 'Receipt not found.\n');
      return 1;
    }
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
    return 0;
  } finally {
    await ctx.close();
  }
}

/** `openldr workflows run-continue <workflowId> <requestId>`: the History row menu's Continue on an
 *  interrupted run, through the same shared code. Starts a new run with the stored input. */
export async function runWorkflowRunContinue(workflowId: string, requestId: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await continueWorkflowReceipt(ctx, workflowId, requestId);
    if (result === 'not-waiting') { process.stderr.write('workflows run-continue refused: this run is not waiting to continue\n'); return 1; }
    await recordAuditEvent(ctx, cliNamedActor(), { action: 'workflow.run.continued', entityType: 'workflow', entityId: workflowId, metadata: { receiptId: requestId, runId: result.runId } });
    process.stdout.write(opts.json ? JSON.stringify(result) + '\n'
      : `started run ${result.runId}${result.definitionChanged ? ' with the workflow as it is now; it changed after the interrupted run started' : ''}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`workflows run-continue failed: ${redactError(err)}\n`);
    return 1;
  } finally {
    await ctx.close();
  }
}
