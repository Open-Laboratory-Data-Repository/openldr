import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/AuthProvider';
import { LoadingState } from '@/components/ui/spinner';
import { hasStoredLanguage, isSupported, setLanguage } from '@/i18n/language';
import { visibleNav } from './AppShell';
import { layoutInForce, loadLayouts, useLayouts } from './layouts';
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
  // useTranslation re-renders this component when the language changes.
  const { i18n } = useTranslation();
  const language = i18n.language;

  // Only the path the app opened on matters, so this runs once.
  const entryPath = useRef(location.pathname);
  useEffect(() => { noteEntryPath(entryPath.current); }, []);

  // First pass after a load: the saved theme wins over this browser's. After that, a change made
  // here is saved. A user with no saved theme gets this browser's theme saved, so it travels from now on.
  const applied = useRef(false);
  const appliedLanguage = useRef(false);

  useEffect(() => {
    if (!userId) return;
    // A different user's saved theme and language must be applied, not overwritten with the last user's.
    applied.current = false;
    appliedLanguage.current = false;
    void loadUserPreferences();
    void loadLayouts();
  }, [userId]);

  useEffect(() => {
    if (!loaded || !theme || !setTheme) return;
    if (!applied.current) {
      applied.current = true;
      if (prefs.theme && prefs.theme !== theme) { setTheme(prefs.theme); return; }
    }
    if (theme !== prefs.theme) void setUserPreference({ theme });
  }, [loaded, prefs.theme, theme, setTheme]);

  // Language works like the theme, with one difference. A browser where no language was ever
  // picked shows the default, and a default is not a choice: saving it would overwrite, at the
  // next sign-in elsewhere, the language the user did pick on another device. So with nothing
  // saved, only a language that was picked in this browser is saved.
  useEffect(() => {
    if (!loaded || !isSupported(language)) return;
    if (!appliedLanguage.current) {
      appliedLanguage.current = true;
      if (prefs.language) {
        if (prefs.language !== language) void setLanguage(prefs.language);
        return;
      }
      if (hasStoredLanguage()) void setUserPreference({ language });
      return;
    }
    if (language !== prefs.language) void setUserPreference({ language });
  }, [loaded, prefs.language, language]);

  return null;
}

/**
 * Wraps the `/` route. The first time the app lands on `/`, it sends the user to their saved first
 * page instead, if that page is in their sidebar. Every later visit to `/` shows the children.
 */
export function StartPageGate({ children }: { children: ReactNode }) {
  const { user, hasCapability } = useAuth();
  const { loaded: prefsLoaded, prefs } = useUserPreferences();
  const { loaded: layoutsLoaded, list } = useLayouts();
  const loaded = prefsLoaded && layoutsLoaded;
  // Fixed at first render: whether this mount is the app's first landing on `/`.
  const firstLanding = useRef(!startPageUsed()).current;
  const decided = Boolean(user) && loaded;
  useEffect(() => {
    if (decided) markStartPageUsed();
  }, [decided]);

  // No user: nothing to read. The route's own guard handles it.
  if (!firstLanding || !user) return <>{children}</>;
  if (!loaded) return <LoadingState className="h-dvh" />;
  // The user's own first page, else their layout's. Only a page in their sidebar counts.
  const layout = layoutInForce(prefs, list);
  const target = prefs.startPage ?? layout?.startPage ?? undefined;
  const reachable = target && target !== '/' && visibleNav(hasCapability, layout).some((n) => n.to === target);
  return reachable ? <Navigate to={target} replace /> : <>{children}</>;
}
