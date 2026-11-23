import { PLUGIN_PERMISSION_KEY } from '@openldr/marketplace';
import { permissionGroup } from '@openldr/rbac';

/** One permission as read back from a stored plugin row. */
export interface StoredPermission {
  key: string;
  label: string;
  description: string;
  labels?: { fr?: { label: string; description: string }; pt?: { label: string; description: string } };
}

function text(v: unknown): { label: string; description: string } | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { label, description } = v as { label?: unknown; description?: unknown };
  if (typeof label !== 'string' || !label) return undefined;
  return { label, description: typeof description === 'string' ? description : '' };
}

/** The permissions a stored plugin row declares (`manifest.payload.permissions`).
 *
 *  A shape check only, never the strict install parse. The install parse refuses a key equal to a
 *  CE capability, and a later CE release may add one, so re-running it on a stored row would make a
 *  plugin CE once accepted fail to load. An entry of the wrong shape is skipped. */
export function storedPermissions(manifest: Record<string, unknown> | null | undefined): StoredPermission[] {
  const payload = (manifest as { payload?: unknown } | null | undefined)?.payload;
  const raw = (payload as { permissions?: unknown } | null | undefined)?.permissions;
  if (!Array.isArray(raw)) return [];
  const out: StoredPermission[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue;
    const { key, labels } = p as { key?: unknown; labels?: unknown };
    const en = text(p);
    if (typeof key !== 'string' || !PLUGIN_PERMISSION_KEY.test(key) || !en || seen.has(key)) continue;
    seen.add(key);
    const fr = text((labels as { fr?: unknown } | undefined)?.fr);
    const pt = text((labels as { pt?: unknown } | undefined)?.pt);
    out.push({ key, ...en, ...(fr || pt ? { labels: { ...(fr ? { fr } : {}), ...(pt ? { pt } : {}) } } : {}) });
  }
  return out;
}

/** The sidebar label a stored plugin row declares, if any. */
export function storedNavLabel(manifest: Record<string, unknown> | null | undefined): string | undefined {
  const payload = (manifest as { payload?: unknown } | null | undefined)?.payload as { ui?: { nav?: { label?: unknown } } } | undefined;
  const label = payload?.ui?.nav?.label;
  return typeof label === 'string' && label ? label : undefined;
}

/** The permission groups a stored or parsed manifest's keys use: each key's first segment. */
export function permissionGroups(manifest: Record<string, unknown> | null | undefined): string[] {
  return [...new Set(storedPermissions(manifest).map((p) => permissionGroup(p.key)))].sort();
}

/** Who owns a permission group: the plugin id and the verified publisher key fingerprint (null
 *  when the claiming install was unsigned). */
export interface GroupOwner {
  pluginId: string;
  publisher: string | null;
}

/** A plugin declares a key in a permission group it may not use (ruling 1 as amended): another
 *  plugin owns it, or a plugin with the same id from another publisher does. */
export class PermissionGroupTakenError extends Error {
  constructor(
    readonly group: string,
    readonly owner: string,
    readonly pluginId: string,
    readonly reason: 'plugin' | 'publisher' = 'plugin',
  ) {
    super(
      reason === 'plugin'
        ? `the permission group '${group}' belongs to the plugin ${owner}, so ${pluginId} cannot declare permissions in it`
        : `the permission group '${group}' belongs to the plugin ${owner} from a different publisher, so this copy of ${pluginId} cannot declare permissions in it`,
    );
    this.name = 'PermissionGroupTakenError';
  }
}

/** The first group in `groups` that `owners` keeps from plugin `id` with publisher `publisher`, as
 *  an error, or undefined when every group is free or already this plugin's. A claim matches only
 *  when the plugin id and the publisher are both equal; a null publisher matches only null. */
export function groupRefusal(
  groups: readonly string[],
  owners: Map<string, GroupOwner>,
  id: string,
  publisher: string | null,
): PermissionGroupTakenError | undefined {
  for (const g of groups) {
    const owner = owners.get(g);
    if (owner === undefined) continue;
    if (owner.pluginId !== id) return new PermissionGroupTakenError(g, owner.pluginId, id, 'plugin');
    if (owner.publisher !== publisher) return new PermissionGroupTakenError(g, owner.pluginId, id, 'publisher');
  }
  return undefined;
}

/** The permissions each entrypoint needs, as a stored plugin row declares them
 *  (`manifest.payload.actionPermissions`). `undefined` when the row declares none: the plugin keeps
 *  the broker's old rules. When the field is there, an entrypoint with no usable list is absent from
 *  the result, so the broker refuses it (closed by default). A shape check only, like
 *  `storedPermissions`. */
export function storedActionPermissions(manifest: Record<string, unknown> | null | undefined): Map<string, string[]> | undefined {
  const payload = (manifest as { payload?: unknown } | null | undefined)?.payload;
  if (typeof payload !== 'object' || payload === null || !('actionPermissions' in payload)) return undefined;
  const raw = (payload as { actionPermissions?: unknown }).actionPermissions;
  if (raw === undefined) return undefined;
  // A Map, so an entrypoint named like an Object property ('constructor', '__proto__') finds nothing.
  const out = new Map<string, string[]>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [entrypoint, keys] of Object.entries(raw)) {
    if (!Array.isArray(keys)) continue;
    const listed = keys.filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (listed.length > 0) out.set(entrypoint, listed);
  }
  return out;
}
