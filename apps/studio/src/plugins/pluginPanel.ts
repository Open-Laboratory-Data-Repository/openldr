import { useSyncExternalStore } from 'react';
import type { PluginUiEntry } from '@/api';

// Which plugin's side panel is open. Module state, not a context: AppShell mounts once per page,
// but the panel lives above the routes (PluginPanelHost in App.tsx) so its iframe is not reloaded
// on every page change. Both read this one value.

/** `permissionKeys` are the plugin's own keys, so the panel's page gets only those and CE's.
 *  `label`, `version` and `serial` come from the server's listing: the plugin's name, its active
 *  version, and whether it holds host:serial. Without them the panel's page gets no serial port. */
export interface OpenPanel { id: string; title: string; permissionKeys?: string[]; label?: string; version?: string; serial?: boolean }

let open: OpenPanel | null = null;
const listeners = new Set<() => void>();

function set(next: OpenPanel | null): void {
  open = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPluginPanel(): OpenPanel | null {
  return open;
}

export function usePluginPanel(): OpenPanel | null {
  return useSyncExternalStore(subscribe, getPluginPanel, getPluginPanel);
}

export function openPluginPanel(id: string, title: string, permissionKeys: string[] = [], plugin?: { label: string; version: string; serial: boolean }): void {
  set({ id, title, permissionKeys, ...(plugin ?? {}) });
}

export function closePluginPanel(): void {
  if (open) set(null);
}

/** Called with each fresh plugin list. Closes the panel when its plugin no longer offers one
 *  (disabled, removed, role lost, or the panel switched off), so it never shows a dead frame. */
export function syncPluginPanel(entries: PluginUiEntry[]): void {
  if (!open) return;
  const entry = entries.find((e) => e.id === open!.id);
  const panel = entry?.sites?.panel;
  if (!entry || !panel) return set(null);
  // The fresh list also says who the plugin is now: a new version, or a grant given or taken.
  const serial = entry.devices?.serial === true;
  if (panel.title !== open.title || entry.nav.label !== open.label || entry.version !== open.version || serial !== (open.serial ?? false)) {
    set({ ...open, title: panel.title, label: entry.nav.label, version: entry.version, serial });
  }
}
