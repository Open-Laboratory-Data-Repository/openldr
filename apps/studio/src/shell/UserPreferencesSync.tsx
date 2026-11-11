import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components/ui/spinner';
import { NAV } from './AppShell';
import { useThemeContext } from './ThemeProvider';
import {
  loadUserPreferences, markStartPageUsed, noteEntryPath, setUserPreference, startPageUsed, useUserPreferences,
} from './userPreferences';

/**
 * Keeps the signed-in user's preferences in step with the server. Renders nothing.
 * Mounted once in App, inside AuthProvider and ThemeProvider.
 */
export function UserPreferencesSync() {
  const { user } = useAuth();
  const userId = user?.id;
  const location = useLocation();
  const themeCtx = useThemeContext();
  const { loaded, prefs } = useUserPreferences();
  const theme = themeCtx?.theme;
  const setTheme = themeCtx?.setTheme;

  // Only the path the app opened on matters, so this runs once.
  const entryPath = useRef(location.pathname);
  useEffect(() => { noteEntryPath(entryPath.current); }, []);

  // First pass after a load: the saved theme wins over this browser's. After that, a change made
  // here is saved. A user with no saved theme gets this browser's theme saved, so it travels from now on.
  const applied = useRef(false);

  useEffect(() => {
    if (!userId) return;
    // A different user's saved theme must be applied, not overwritten with the last user's.
    applied.current = false;
    void loadUserPreferences();
  }, [userId]);

  useEffect(() => {
    if (!loaded || !theme || !setTheme) return;
    if (!applied.current) {
      applied.current = true;
      if (prefs.theme && prefs.theme !== theme) { setTheme(prefs.theme); return; }
    }
    if (theme !== prefs.theme) void setUserPreference({ theme });
  }, [loaded, prefs.theme, theme, setTheme]);

  return null;
}

/**
 * Wraps the `/` route. The first time the app lands on `/`, it sends the user to their saved first
 * page instead, if that page is in their sidebar. Every later visit to `/` shows the children.
 */
export function StartPageGate({ children }: { children: ReactNode }) {
  const { user, hasCapability } = useAuth();
  const { loaded, prefs } = useUserPreferences();
  // Fixed at first render: whether this mount is the app's first landing on `/`.
  const firstLanding = useRef(!startPageUsed()).current;
  const decided = Boolean(user) && loaded;
  useEffect(() => {
    if (decided) markStartPageUsed();
  }, [decided]);

  // No user: nothing to read. The route's own guard handles it.
  if (!firstLanding || !user) return <>{children}</>;
  if (!loaded) return <LoadingState className="h-dvh" />;
  const target = prefs.startPage;
  const reachable = target && target !== '/'
    && NAV.some((n) => n.to === target && (!n.caps || n.caps.some((c) => hasCapability(c))));
  return reachable ? <Navigate to={target} replace /> : <>{children}</>;
}
