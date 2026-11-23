import { CAPABILITY_GROUPS, CAPABILITY_KEYS, type CapabilityGroup, type CapabilityMeta } from '@openldr/rbac';
import { storedNavLabel, storedPermissions, type PluginRow, type StoredPermission } from '@openldr/plugins';

/** A plugin permission as the Roles page shows it. `labels` carries the French and Portuguese text
 *  when the plugin gives it; the page falls back to English. */
export interface PluginCapabilityMeta extends CapabilityMeta {
  labels?: StoredPermission['labels'];
}

/** A catalog group. A plugin's group names the plugin it came from. */
export interface CatalogGroup extends CapabilityGroup {
  plugin?: string;
  capabilities: PluginCapabilityMeta[];
}

export interface CapabilityCatalog {
  /** CE's static keys plus the keys of active, enabled plugins. */
  keys(): Promise<string[]>;
  /** CE's static groups plus one group per active, enabled plugin that declares permissions. */
  groups(): Promise<CatalogGroup[]>;
  isKnown(key: string): Promise<boolean>;
  /** The keys active, enabled plugins add. Never a CE key. */
  pluginKeys(): Promise<string[]>;
  /** Drop the cache. Called after a plugin is installed, enabled, disabled, removed or rolled back. */
  invalidate(): void;
}

export interface CapabilityCatalogDeps {
  plugins: { list(): Promise<PluginRow[]> };
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
  /** How long a read of the plugin rows is reused. Default 5 seconds, so a second server process
   *  sees another's install soon enough. This process invalidates on every change. */
  ttlMs?: number;
  now?: () => number;
  /** CE's static keys. Tests pass a list to act as a later CE release. */
  ceKeys?: readonly string[];
  ceGroups?: CapabilityGroup[];
}

interface Snapshot {
  at: number;
  groups: CatalogGroup[];
  pluginKeys: string[];
}

/** The capability catalog (plan 2026-11-23-plugin-host-2b, ruling 3). Role validation, the Roles
 *  page catalog, the CLI role commands and profile pack role steps read it. The 067 ledger does not:
 *  it records CE keys only. */
export function createCapabilityCatalog(deps: CapabilityCatalogDeps): CapabilityCatalog {
  const ttl = deps.ttlMs ?? 5_000;
  const now = deps.now ?? Date.now;
  const ce = new Set(deps.ceKeys ?? CAPABILITY_KEYS);
  const ceGroups = deps.ceGroups ?? CAPABILITY_GROUPS;
  // Each clash is logged once per process, not on every refresh.
  const warned = new Set<string>();
  let snap: Snapshot | null = null;
  let loading: Promise<Snapshot> | null = null;

  function warnOnce(tag: string, obj: Record<string, unknown>, msg: string): void {
    if (warned.has(tag)) return;
    warned.add(tag);
    deps.logger?.warn(obj, msg);
  }

  async function load(): Promise<Snapshot> {
    let all: PluginRow[];
    try {
      all = await deps.plugins.list();
    } catch (err) {
      // No plugins table yet, or the database is away. CE's own keys still work, and a save keeps
      // a stored plugin key as an unlisted one, so nothing is lost.
      deps.logger?.warn({ err }, 'the capability catalog could not read the installed plugins; it lists CE capabilities only for now');
      return { at: now(), groups: [], pluginKeys: [] };
    }
    const rows = all.filter((r) => r.active && r.enabled);
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const claimed = new Map<string, string>();
    const groups: CatalogGroup[] = [];
    for (const row of rows) {
      const caps: PluginCapabilityMeta[] = [];
      for (const p of storedPermissions(row.manifest)) {
        // A later CE release added this key. CE owns it; the plugin's declaration is ignored.
        if (ce.has(p.key)) {
          warnOnce(`ce:${row.id}:${p.key}`, { plugin: row.id, key: p.key },
            'a plugin declares a permission that is now a CE capability; CE owns the key and the plugin declaration is ignored');
          continue;
        }
        const owner = claimed.get(p.key);
        if (owner) {
          warnOnce(`dup:${row.id}:${p.key}`, { plugin: row.id, key: p.key, owner },
            'two installed plugins declare the same permission; the first keeps it');
          continue;
        }
        claimed.set(p.key, row.id);
        caps.push({ key: p.key, group: `plugin:${row.id}`, label: p.label, description: p.description, ...(p.labels ? { labels: p.labels } : {}) });
      }
      if (caps.length) groups.push({ key: `plugin:${row.id}`, label: storedNavLabel(row.manifest) ?? row.id, plugin: row.id, capabilities: caps });
    }
    return { at: now(), groups, pluginKeys: [...claimed.keys()] };
  }

  async function current(): Promise<Snapshot> {
    if (snap && now() - snap.at < ttl) return snap;
    if (!loading) {
      const p = load();
      loading = p;
      p.then((s) => { if (loading === p) snap = s; }, () => {}).finally(() => { if (loading === p) loading = null; });
    }
    return loading;
  }

  return {
    async keys() {
      return [...ce, ...(await current()).pluginKeys];
    },
    async groups() {
      return [...ceGroups, ...(await current()).groups];
    },
    async isKnown(key) {
      return ce.has(key) || (await current()).pluginKeys.includes(key);
    },
    async pluginKeys() {
      return [...(await current()).pluginKeys];
    },
    invalidate() {
      snap = null;
      loading = null;
    },
  };
}

export interface PluginPermissionSyncDeps {
  catalog: CapabilityCatalog;
  roles: { grantAdministrator(keys: string[]): Promise<Array<{ slug: string; roleId: string; capability: string }>> };
  /** Records what was granted, one call per role. */
  record?: (actorName: string, granted: Array<{ slug: string; roleId: string; capability: string }>) => Promise<void>;
}

/** Keeps the catalog and the Administrator in step with the installed plugins (rulings 3 and 4).
 *  `onChange` goes to the plugin runtime. `grantAll` runs at boot, for a plugin installed before
 *  this. Install, enable and rollback grant; disable and removal keep the grants (kept). */
export function createPluginPermissionSync(deps: PluginPermissionSyncDeps) {
  async function grantAll(actorName: string): Promise<void> {
    const granted = await deps.roles.grantAdministrator(await deps.catalog.pluginKeys());
    if (granted.length && deps.record) await deps.record(actorName, granted);
  }
  return {
    grantAll,
    async onChange(e: { id: string; action: 'install' | 'enable' | 'disable' | 'remove' | 'rollback' }): Promise<void> {
      deps.catalog.invalidate();
      if (e.action === 'install' || e.action === 'enable' || e.action === 'rollback') await grantAll('plugin-install');
    },
  };
}
