import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'openldr-theme';

/** Read the persisted theme, falling back to the `data-theme` attribute (dark by default). */
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage may be unavailable
  }
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

/** Stamp the theme onto <html> (drives all `data-theme` styling) and persist it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // ignore
  }
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * App-shell theme provider. Owns a single source of truth for light/dark, applies it to <html>,
 * and registers a global `d` keyboard shortcut that toggles the theme. Mounted once near the root
 * (see main.tsx) so every route shares the same theme state.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  // Global dark-mode shortcut: pressing `d` toggles between the dark and light theme. Ignored
  // while typing in inputs, textareas, selects, or contenteditable nodes (and when a modifier is
  // held) so it never hijacks a keystroke the user meant for a field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'd' && e.key !== 'D') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

/** Returns the theme context, or null when no ThemeProvider is mounted (e.g. isolated tests). */
export function useThemeContext(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
