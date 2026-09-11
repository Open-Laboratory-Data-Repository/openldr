import { createAppContext } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';

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
