import { readGrant } from '@openldr/marketplace';
import type { PluginDataStore } from '@openldr/db';
import { CONNECTOR_ALLOWED, auditOrRefuse, auditQuietly, type ImportActor, type ImportServiceDeps, type ImportService } from './import-run';

// Which plugins may use which connector (design 2026-11-26-plugin-connector-approval-and-results).
// One list per plugin, the one imports already keep: an admin switches a plugin on for a connector,
// and only then may the plugin use it. An import plugin is offered for a database connector of a
// type its import source reads, as before. Any plugin that declares host:connectors is offered for
// connector that is not a database. A database connector stays import-only: there CE opens the
// connection and runs only read-only SELECTs, so its password never reaches plugin code.

export interface ConnectorPluginCandidate {
  id: string;
  version: string;
  allowed: boolean;
  /** Why the plugin is offered: it imports from this connector, or it declares host:connectors. */
  use: 'import' | 'connector';
}

export interface PluginConnectorAccess {
  /** The plugins an admin may switch on for this connector, each with its state. Empty when the
   *  connector does not exist. */
  candidates(connectorId: string): Promise<ConnectorPluginCandidate[]>;
  /** Refused with a sentence when the plugin is not offered for this connector. */
  allow(pluginId: string, connectorId: string, actor: ImportActor): Promise<void>;
  revoke(pluginId: string, connectorId: string, actor: ImportActor): Promise<void>;
  /** The connectors switched on for this plugin. */
  allowed(pluginId: string): Promise<string[]>;
}

export interface PluginConnectorAccessDeps {
  plugins: { list(): Promise<Array<{ id: string; version: string; enabled: boolean; active: boolean; manifest: Record<string, unknown> }>> };
  connectors: { get(id: string): Promise<{ type?: string | null; kind?: string | null } | null> };
  pluginData: Pick<PluginDataStore, 'put' | 'delete' | 'list' | 'get'>;
  imports: Pick<ImportService, 'readers' | 'allow' | 'revoke'>;
  audit: ImportServiceDeps['audit'];
  now?: () => Date;
}

/** Does this stored plugin row declare host:connectors? A legacy row (no capabilities) does not. */
export function declaresConnectors(manifest: Record<string, unknown>): boolean {
  const grant = readGrant(manifest);
  return !grant.legacy && grant.capabilities.some((c) => c.kind === 'host:connectors');
}

export function createPluginConnectorAccess(deps: PluginConnectorAccessDeps): PluginConnectorAccess {
  const now = deps.now ?? (() => new Date());

  async function candidates(connectorId: string): Promise<ConnectorPluginCandidate[]> {
    const connector = await deps.connectors.get(connectorId);
    if (!connector) return [];
    const out = new Map<string, Omit<ConnectorPluginCandidate, 'allowed'>>();
    const type = connector.type ?? null;
    if (type) {
      for (const p of await deps.imports.readers()) {
        if (p.connectorTypes.includes(type)) out.set(p.id, { id: p.id, version: p.version, use: 'import' });
      }
    }
    // A database connector is offered to import plugins only.
    const forConnectorPlugins = connector.kind !== 'database';
    for (const row of forConnectorPlugins ? await deps.plugins.list() : []) {
      if (!row.active || !row.enabled || out.has(row.id)) continue;
      if (declaresConnectors(row.manifest)) out.set(row.id, { id: row.id, version: row.version, use: 'connector' });
    }
    const listed = [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
    return Promise.all(listed.map(async (c) => ({ ...c, allowed: (await deps.pluginData.get(c.id, CONNECTOR_ALLOWED, connectorId)) !== null })));
  }

  return {
    candidates,

    async allow(pluginId, connectorId, actor) {
      const offered = (await candidates(connectorId)).find((c) => c.id === pluginId);
      if (!offered) throw new Error(`plugin ${pluginId} cannot use connector ${connectorId}`);
      // An import plugin keeps the import service's own checks and audit row.
      if (offered.use === 'import') return deps.imports.allow(pluginId, connectorId, actor);
      await auditOrRefuse(deps.audit, { action: 'connector.allow', pluginId, connectorId, actor });
      await deps.pluginData.put(pluginId, CONNECTOR_ALLOWED, connectorId, { connectorId, allowedBy: actor.name, allowedAt: now().toISOString() });
    },

    async revoke(pluginId, connectorId, actor) {
      const offered = (await candidates(connectorId)).find((c) => c.id === pluginId);
      if (offered?.use === 'import') return deps.imports.revoke(pluginId, connectorId, actor);
      // A plugin no longer offered (removed, or it dropped host:connectors) can still be switched off.
      await deps.pluginData.delete(pluginId, CONNECTOR_ALLOWED, connectorId);
      await auditQuietly(deps.audit, { action: 'connector.revoke', pluginId, connectorId, actor });
    },

    async allowed(pluginId) {
      return (await deps.pluginData.list(pluginId, CONNECTOR_ALLOWED)).map((e) => e.key);
    },
  };
}
