import { readFileSync } from 'node:fs';
import { loadConfig } from '@openldr/config';
import { createAppContext, inspectConnectorConfig, updateConnectorConfig, recordAuditEvent, hostConnectorPatchSchema } from '@openldr/bootstrap';

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
