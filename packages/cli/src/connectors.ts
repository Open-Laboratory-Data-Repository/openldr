import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { redactError } from './redact-error';
import { cliNamedActor } from './cli-actor';
import {
  createAppContext, inspectConnectorConfig, updateConnectorConfig, recordAuditEvent, hostConnectorPatchSchema,
  diagnoseConnector, DIAGNOSE_HINT_TEXT, type DiagnoseResult,
  hostConnectorCreateSchema, createHostConnector, testHostConnector, removeConnector,
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
    await recordAuditEvent(ctx, cliNamedActor(), {
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
    await recordAuditEvent(ctx, cliNamedActor(), {
      action: 'connector.diagnose', entityType: 'connector', entityId: id,
      metadata: { ok: result.ok, failedStep: result.steps.find((step) => step.status === 'fail')?.id ?? null },
    });
    process.stdout.write((opts.json ? JSON.stringify(result, null, 2) : formatDiagnose(result)) + '\n');
    return result.ok ? 0 : 1;
  } finally { await ctx.close(); }
}


/** Every connector, without settings or secrets: id, type or plugin, name, and whether it is on. */
export async function runConnectorList(opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const rows = (await ctx.connectors.list()).map((c) => ({ id: c.id, kind: c.type ?? c.pluginId ?? '', name: c.name, enabled: c.enabled }));
    if (opts.json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else for (const r of rows) process.stdout.write(`${r.id}  ${r.kind.padEnd(14)} ${r.enabled ? 'on ' : 'off'}  ${r.name}\n`);
    return 0;
  } finally { await ctx.close(); }
}

/** Add a database connector from a JSON file: {"name", "type", "config"}. Same code as the studio. */
export async function runConnectorAdd(file: string): Promise<number> {
  // Parse before connecting. Callers print only a generic error, never file contents.
  const input = hostConnectorCreateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const ctx = await createAppContext(loadConfig());
  try {
    const id = await createHostConnector(ctx.connectors, input, ctx.cfg.SECRETS_ENCRYPTION_KEY);
    await recordAuditEvent(ctx, cliNamedActor(), {
      action: 'connector.create', entityType: 'connector', entityId: id, metadata: { name: input.name, type: input.type },
    });
    process.stdout.write(JSON.stringify({ id }) + '\n');
    return 0;
  } finally { await ctx.close(); }
}

/** Open a test connection with the stored credentials. Changes nothing. Exit 1 when it fails. */
export async function runConnectorTest(id: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    const result = await testHostConnector(ctx.connectors, id, ctx.cfg.SECRETS_ENCRYPTION_KEY);
    await recordAuditEvent(ctx, cliNamedActor(), {
      action: 'connector.test', entityType: 'connector', entityId: id, metadata: { outcome: result.ok ? 'ok' : 'failed' },
    });
    process.stdout.write(result.ok ? 'Connection OK\n' : `Connection failed: ${redactError(new Error(result.error))}\n`);
    return result.ok ? 0 : 1;
  } finally { await ctx.close(); }
}

/** Remove a connector. Destructive, so it refuses without --force. */
export async function runConnectorRemove(id: string, opts: { force: boolean }): Promise<number> {
  if (!opts.force) {
    process.stderr.write(`Refusing to remove connector ${id} without --force. Anything that uses it stops working.\n`);
    return 1;
  }
  const ctx = await createAppContext(loadConfig());
  try {
    const removed = await removeConnector(ctx.connectors, id);
    if (!removed) { process.stderr.write('connector not found\n'); return 1; }
    await recordAuditEvent(ctx, cliNamedActor(), {
      action: 'connector.delete', entityType: 'connector', entityId: id, metadata: { name: removed.name, pluginId: removed.pluginId },
    });
    process.stdout.write('{"ok":true}\n');
    return 0;
  } finally { await ctx.close(); }
}
