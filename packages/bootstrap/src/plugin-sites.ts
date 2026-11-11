import type { AppSettingStore } from '@openldr/db';
import { uiSitesSchema, PLUGIN_SITES, type PluginSite, type UiSites } from '@openldr/marketplace';

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

/** What an admin sees for one plugin: the sites its manifest declares, and which are off. */
export interface PluginSitesState { declared: UiSites; off: PluginSite[] }

export class PluginSitesError extends Error {
  constructor(public readonly code: 'not-found' | 'not-declared', message: string) { super(message); }
}

interface PluginRowLike { id: string; active: boolean; manifest: Record<string, unknown> }
export interface PluginSitesDeps {
  plugins: { list(): Promise<PluginRowLike[]> };
  appSettings: AppSettingStore;
}

/** The declared sites in a stored manifest. The stored manifest may carry the raw signed form
 *  (no height default), so it is parsed again here; anything that does not parse counts as none. */
export function declaredSites(manifest: Record<string, unknown>): UiSites {
  const raw = (manifest.payload as { ui?: { sites?: unknown } } | undefined)?.ui?.sites;
  if (raw === undefined) return {};
  const parsed = uiSitesSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

async function activeRow(deps: PluginSitesDeps, pluginId: string): Promise<PluginRowLike> {
  const rows = (await deps.plugins.list()).filter((r) => r.id === pluginId);
  const row = rows.find((r) => r.active) ?? rows[0];
  if (!row) throw new PluginSitesError('not-found', `plugin ${pluginId} is not installed`);
  return row;
}

function stateFor(pluginId: string, declared: UiSites, off: Set<string>): PluginSitesState {
  return { declared, off: PLUGIN_SITES.filter((s) => declared[s] && off.has(entry(pluginId, s))) };
}

/** Shared by the route and the CLI. Throws PluginSitesError('not-found') for an unknown plugin. */
export async function readPluginSites(deps: PluginSitesDeps, pluginId: string): Promise<PluginSitesState> {
  const declared = declaredSites((await activeRow(deps, pluginId)).manifest);
  return stateFor(pluginId, declared, await getSitesOff(deps.appSettings));
}

/** Shared by the route and the CLI. The caller audits. Throws PluginSitesError('not-found') or
 *  ('not-declared') when the plugin's manifest has no such site. */
export async function updatePluginSite(
  deps: PluginSitesDeps, pluginId: string, site: PluginSite, on: boolean, actor: string | null,
): Promise<PluginSitesState> {
  const declared = declaredSites((await activeRow(deps, pluginId)).manifest);
  if (!declared[site]) throw new PluginSitesError('not-declared', `plugin ${pluginId} declares no ${site}`);
  return stateFor(pluginId, declared, await setSiteOn(deps.appSettings, pluginId, site, on, actor));
}
