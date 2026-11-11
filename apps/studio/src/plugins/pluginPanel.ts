import { useSyncExternalStore } from 'react';
import type { PluginUiEntry } from '@/api';

// Which plugin's side panel is open. Module state, not a context: AppShell mounts once per page,
// but the panel lives above the routes (PluginPanelHost in App.tsx) so its iframe is not reloaded
// on every page change. Both read this one value.

export interface OpenPanel { id: string; title: string }

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

export function openPluginPanel(id: string, title: string): void {
  set({ id, title });
}

export function closePluginPanel(): void {
  if (open) set(null);
}

/** Called with each fresh plugin list. Closes the panel when its plugin no longer offers one
 *  (disabled, removed, role lost, or the panel switched off), so it never shows a dead frame. */
export function syncPluginPanel(entries: PluginUiEntry[]): void {
  if (!open) return;
  const panel = entries.find((e) => e.id === open!.id)?.sites?.panel;
  if (!panel) set(null);
  else if (panel.title !== open.title) set({ id: open.id, title: panel.title });
}
