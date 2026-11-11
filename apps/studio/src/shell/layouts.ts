import { useSyncExternalStore } from 'react';
import { listLayouts, type LayoutList, type LayoutPreset, type UserPreferences } from '@/api';

// Layout presets: the admin's named sidebars, with a default per role. Module state like
// userPreferences.ts: AppShell mounts once per page and every mount must see the same list.
// Loaded once per sign-in by UserPreferencesSync, and again after an admin edits layouts.

interface State { loaded: boolean; list: LayoutList }

const EMPTY: LayoutList = { layouts: [], roleOrder: [] };
let state: State = { loaded: false, list: EMPTY };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLayoutsState(): State {
  return state;
}

export function useLayouts(): State {
  return useSyncExternalStore(subscribe, getLayoutsState, getLayoutsState);
}

/** Read the layouts. Never throws: on failure the sidebar is simply the full one. */
export async function loadLayouts(): Promise<void> {
  try {
    const list = await listLayouts();
    set({ loaded: true, list: list && Array.isArray(list.layouts) ? list : EMPTY });
  } catch {
    set({ loaded: true, list: EMPTY });
  }
}

export function resetLayoutsForTest(): void {
  state = { loaded: false, list: EMPTY };
}

/** The layout in force for this user, or null for the full sidebar. The user's own pick wins;
 *  `full` is the full sidebar; otherwise the default of the user's first role that has one, in
 *  Roles page order. A picked layout that no longer exists falls through to the role default. */
export function layoutInForce(prefs: UserPreferences, list: LayoutList, userRoles: string[]): LayoutPreset | null {
  if (prefs.layout === 'full') return null;
  const picked = prefs.layout ? list.layouts.find((l) => l.id === prefs.layout) : undefined;
  if (picked) return picked;
  for (const role of list.roleOrder) {
    if (!userRoles.includes(role)) continue;
    const def = list.layouts.find((l) => l.roles.includes(role));
    if (def) return def;
  }
  return null;
}
