import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import {
  createAppContext, inspectConnectorConfig, updateConnectorConfig, recordAuditEvent, hostConnectorPatchSchema,
  diagnoseConnector, DIAGNOSE_HINT_TEXT, type DiagnoseResult,
} from '@openldr/bootstrap';

export async function runConnectorInspect(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const view = await inspectConnectorConfig(ctx.connectors, id, ctx.cfg.SECRETS_ENCRYPTION_KEY);
    if (!view) throw new Error('connector not found');
    process.stdout.write(JSON.stringify(view, null, 2) + '\n');
    return 0;
  } finally { await ctx.close(); }
}

export async function runConnectorUpdate(id: string, file: string): Promise<number> {
  // Parse before connecting. Callers print only a generic error, never file contents.
  const patch = hostConnectorPatchSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const ctx = await createAppContext(loadConfig());
  try {
    const record = await ctx.connectors.get(id);
    if (!record?.type) throw new Error('host connector required');
    await updateConnectorConfig(ctx.connectors, id, patch, ctx.cfg.SECRETS_ENCRYPTION_KEY);
    await recordAuditEvent(ctx, { actorType: 'cli', actorId: null, actorName: 'cli' }, {
      action: 'connector.update', entityType: 'connector', entityId: id,
      metadata: { fields: Object.keys(patch) },
    });
    process.stdout.write('{"ok":true}\n');
    return 0;
  } finally { await ctx.close(); }
}

/** Plain-text report: one line per step, the hint indented under a failed or warning step. */
export function formatDiagnose(result: DiagnoseResult): string {
  const lines: string[] = [];
  for (const step of result.steps) {
    lines.push(`${step.status.toUpperCase().padEnd(5)} ${step.id.padEnd(8)} ${step.detail ?? ''}`.trimEnd());
    if (step.hint) lines.push(`      ${DIAGNOSE_HINT_TEXT[step.hint]}`);
  }
  const failed = result.steps.find((step) => step.status === 'fail');
  lines.push('', failed ? `Connection check failed at: ${failed.id}` : 'All checks passed.');
  return lines.join('\n');
}

/** Read-only: opens test connections with the stored credentials, changes nothing. */
export async function runConnectorDiagnose(id: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const record = await ctx.connectors.get(id);
    if (!record?.type) throw new Error('host connector required');
    const config = await ctx.connectors.getDecryptedConfig(id, ctx.cfg.SECRETS_ENCRYPTION_KEY);
    const result = await diagnoseConnector(record.type, config);
    await recordAuditEvent(ctx, { actorType: 'cli', actorId: null, actorName: 'cli' }, {
      action: 'connector.diagnose', entityType: 'connector', entityId: id,
      metadata: { ok: result.ok, failedStep: result.steps.find((step) => step.status === 'fail')?.id ?? null },
    });
    process.stdout.write((opts.json ? JSON.stringify(result, null, 2) : formatDiagnose(result)) + '\n');
    return result.ok ? 0 : 1;
  } finally { await ctx.close(); }
}

