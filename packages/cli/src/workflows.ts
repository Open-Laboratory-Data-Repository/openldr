import { createAppContext, recordAuditEvent, setWorkflowEnabled } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';
import { redactError } from './redact-error';

/**
 * `openldr workflows enable|disable <id>`: the studio row menu's Enable and Disable, through the same
 * shared code (bootstrap workflow-enabled.ts). Only `enabled` changes. A webhook follows at once,
 * because each request reads the stored workflow; a running server picks up schedules, listeners,
 * ingest and event triggers at its next start.
 */
export async function runWorkflowSetEnabled(id: string, enabled: boolean): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const changed = await setWorkflowEnabled(ctx.workflows.store, id, enabled);
    if (!changed) {
      process.stderr.write(`Workflow not found: ${id}\n`);
      return 1;
    }
    await recordAuditEvent(ctx, cliActor(), {
      action: enabled ? 'workflow.enable' : 'workflow.disable', entityType: 'workflow', entityId: id,
    });
    process.stdout.write(`${changed.after.name} is ${enabled ? 'enabled' : 'disabled'}. Webhooks follow now. `
      + 'Restart the server for schedules, listeners, ingest and event triggers to follow.\n');
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
    process.stdout.write(opts.json ? JSON.stringify(rows, null, 2) + '\n' :
      (rows.map(row => `${row.id}\t${row.status}\t${row.runId ?? ''}\t${row.createdAt}`).join('\n') || '(no receipts)') + '\n');
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
