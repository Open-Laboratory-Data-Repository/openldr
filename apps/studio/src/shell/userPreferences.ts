import { useSyncExternalStore } from 'react';
import { getMyPreferences, saveMyPreferences, type UserPreferences, type UserPreferencesPatch } from '@/api';

// The signed-in user's studio preferences (theme, sidebar state, first page), kept on the server
// so they follow the login to another browser or a phone. localStorage stays as a first-paint
// cache in ThemeProvider and useSidebar; this store is the copy that travels.
//
// Module state, not a context: AppShell is mounted once per page, and every mount must see the
// same values without a provider above the router.

interface State { loaded: boolean; prefs: UserPreferences }

let state: State = { loaded: false, prefs: {} };
// True only after a successful read. Nothing is saved before that: a failed read means the server
// copy is unknown, and writing over it could wipe what another device saved.
let synced = false;
// The saved first page applies once per app load, and only on landing at `/`.
let startUsed = false;
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getUserPreferencesState(): State {
  return state;
}

export function useUserPreferences(): State {
  return useSyncExternalStore(subscribe, getUserPreferencesState, getUserPreferencesState);
}

/** Read the user's preferences. Never throws: on failure the app carries on with local values. */
export async function loadUserPreferences(): Promise<void> {
  try {
    const prefs = await getMyPreferences();
    synced = true;
    set({ loaded: true, prefs: prefs ?? {} });
  } catch {
    synced = false;
    set({ loaded: true, prefs: {} });
  }
}

/** Apply a change now and save it. Resolves false when it was not saved. A null value clears the key. */
export async function setUserPreference(patch: UserPreferencesPatch): Promise<boolean> {
  if (!synced) return false;
  const prefs: Record<string, unknown> = { ...state.prefs };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete prefs[key];
    else if (value !== undefined) prefs[key] = value;
  }
  set({ loaded: true, prefs: prefs as UserPreferences });
  try {
    await saveMyPreferences(patch);
    return true;
  } catch {
    return false;
  }
}

/** Called once with the path the app opened on. A deep link uses up the first-page choice, so a
 *  later click on Dashboard shows the Dashboard. `/auth/callback` does not: sign-in lands on `/` next. */
export function noteEntryPath(pathname: string): void {
  if (pathname !== '/' && pathname !== '/auth/callback') startUsed = true;
}

export function startPageUsed(): boolean {
  return startUsed;
}

export function markStartPageUsed(): void {
  startUsed = true;
}

export function resetUserPreferencesForTest(): void {
  synced = false;
  startUsed = false;
  set({ loaded: false, prefs: {} });
}
