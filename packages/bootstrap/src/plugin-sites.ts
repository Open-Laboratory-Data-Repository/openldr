import type { AppSettingStore } from '@openldr/db';
import type { PluginSite, UiSites } from '@openldr/marketplace';

/** The app_settings row holding the plugin sites an admin switched off, as a JSON array of
 *  `${pluginId}:${site}`. Lab-wide. Absent means every declared site is on. */
export const SITES_OFF_KEY = 'plugins.sitesOff';

const entry = (pluginId: string, site: PluginSite): string => `${pluginId}:${site}`;

/** The switched-off sites. A junk stored value is read as "nothing is off", never an error:
 *  a broken row must not take the dashboard or the plugin list down. */
export async function getSitesOff(store: AppSettingStore): Promise<Set<string>> {
  const row = await store.get(SITES_OFF_KEY);
  if (!row) return new Set();
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((e): e is string => typeof e === 'string'));
  } catch {
    return new Set();
  }
}

/** Switch one site of one plugin on or off. Returns the new off list. The caller audits. */
export async function setSiteOn(
  store: AppSettingStore, pluginId: string, site: PluginSite, on: boolean, actor: string | null,
): Promise<Set<string>> {
  const off = await getSitesOff(store);
  if (on) off.delete(entry(pluginId, site));
  else off.add(entry(pluginId, site));
  await store.set(SITES_OFF_KEY, JSON.stringify([...off].sort()), actor);
  return off;
}

/** The declared sites minus the ones switched off. `{}` when the plugin declares none. */
export function visibleSites(declared: UiSites | undefined, off: Set<string>, pluginId: string): UiSites {
  const out: UiSites = {};
  if (declared?.widget && !off.has(entry(pluginId, 'widget'))) out.widget = declared.widget;
  if (declared?.panel && !off.has(entry(pluginId, 'panel'))) out.panel = declared.panel;
  return out;
}
