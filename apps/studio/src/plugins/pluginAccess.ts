import type { LayoutPreset, PluginUiEntry } from '@/api';

/** The studio path of a plugin's own page. */
export function pluginPagePath(id: string): string {
  return `/x/${id}`;
}

/**
 * Whether this user may open the plugin's page. The same rule as the server's uiAllows: a plugin
 * that names no roles and no capabilities is open to everyone; otherwise any one of its roles or
 * any one of its capabilities lets the user in. The server already leaves out of /api/plugins/ui
 * every plugin the user may not open, and refuses its page asset, so this only repeats that
 * check in studio. An older server sends neither list, and its entries stay open.
 */
export function pluginUiAllowed(
  entry: Pick<PluginUiEntry, 'requiredRoles' | 'requiredCapabilities'>,
  userRoles: readonly string[],
  hasCapability: (c: string) => boolean,
): boolean {
  const roles = entry.requiredRoles ?? [];
  const caps = entry.requiredCapabilities ?? [];
  if (roles.length === 0 && caps.length === 0) return true;
  return roles.some((r) => userRoles.includes(r)) || caps.some((c) => hasCapability(c));
}

/**
 * The plugin entries the sidebar shows: those the user may open, then, under a layout, only the
 * ones it lists by their `/x/<id>` path. With no layout every allowed entry shows, as before. A
 * layout only hides; it never opens a plugin the user may not open.
 */
export function visiblePluginEntries(
  entries: readonly PluginUiEntry[],
  userRoles: readonly string[],
  hasCapability: (c: string) => boolean,
  layout: LayoutPreset | null,
): PluginUiEntry[] {
  return entries
    .filter((e) => pluginUiAllowed(e, userRoles, hasCapability))
    .filter((e) => !layout || layout.pages.includes(pluginPagePath(e.id)));
}
