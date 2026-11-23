import { PLUGIN_PERMISSION_KEY } from '@openldr/marketplace';

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
