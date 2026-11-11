import { useEffect, useState } from 'react';
import { setUserPreference, useUserPreferences } from './userPreferences';

const KEY = 'openldr-sidebar-collapsed';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

function store(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, String(collapsed));
  } catch {
    // ignore
  }
}

/**
 * `[collapsed, toggle]`. The user's saved state (server, see userPreferences) wins once it has
 * loaded, so the sidebar looks the same on every device. localStorage is the first-paint cache
 * and the fallback when nothing has loaded.
 */
export function useSidebar(): [boolean, () => void] {
  const { prefs } = useUserPreferences();
  const [local, setLocal] = useState<boolean>(stored);
  const saved = prefs.sidebarCollapsed;
  const collapsed = saved ?? local;

  // Keep the cache in step with the saved value, so the next page load paints it straight away.
  useEffect(() => {
    if (saved !== undefined) store(saved);
  }, [saved]);

  return [
    collapsed,
    () => {
      const next = !collapsed;
      store(next);
      setLocal(next);
      void setUserPreference({ sidebarCollapsed: next });
    },
  ];
}
