import { createAppContext, type ConnectorPluginCandidate, type ImportActor } from '@openldr/bootstrap';
import { loadConfig } from '@openldr/config';
import { cliActor } from './cli-actor';

// `openldr connectors plugins|allow|revoke`: which plugins may use a connector (design
// 2026-11-26-plugin-connector-approval-and-results). The studio's Connectors > Plugin access sheet
// calls the same service. `openldr import allow` still works for import plugins.

/** In served mode, the signed-in account, as cliActor() gives. */
function actor(): ImportActor {
  const a = cliActor();
  if (a.actorType === 'user') return { type: 'user', id: a.actorId ?? null, name: a.actorName };
  return { type: 'cli', id: null, name: a.actorName };
}

/** One line per plugin: on or off, the id, the version, and how it uses the connector. */
export function formatConnectorPlugins(rows: ConnectorPluginCandidate[]): string {
  if (rows.length === 0) return '(no installed plugin can use this connector)';
  return rows.map((r) => `${r.allowed ? 'on ' : 'off'}  ${r.id}  ${r.version}  ${r.use === 'import' ? 'imports from it' : 'uses it as a connector'}`).join('\n');
}

export async function runConnectorPlugins(connectorId: string, opts: { json: boolean }): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    if (!(await ctx.connectors.get(connectorId))) {
      process.stderr.write(`connector ${connectorId} not found\n`);
      return 1;
    }
    const rows = await ctx.connectorAccess.candidates(connectorId);
    process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : `${formatConnectorPlugins(rows)}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runConnectorAllow(connectorId: string, pluginId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await ctx.connectorAccess.allow(pluginId, connectorId, actor());
    process.stdout.write(`${pluginId} may now use connector ${connectorId}\n`);
    return 0;
  } finally { await ctx.close(); }
}

export async function runConnectorRevoke(connectorId: string, pluginId: string): Promise<number> {
  const ctx = await createAppContext(loadConfig());
  try {
    await ctx.connectorAccess.revoke(pluginId, connectorId, actor());
    process.stdout.write(`${pluginId} may no longer use connector ${connectorId}\n`);
    return 0;
  } finally { await ctx.close(); }
}
