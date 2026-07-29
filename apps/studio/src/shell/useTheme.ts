import { useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, useThemeContext, type Theme } from './ThemeProvider';

export type { Theme };

/**
 * Returns `[theme, toggleTheme]`. When a {@link ThemeProvider} is mounted (the running app) this
 * proxies the shared provider state so every consumer stays in sync and the global `d` hotkey and
 * the header toggle drive the same value. With no provider (isolated component tests) it falls back
 * to a self-contained local implementation that still applies `data-theme` to <html>.
 */
export function useTheme(): [Theme, () => void] {
  const ctx = useThemeContext();
  const [localTheme, setLocalTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    if (!ctx) applyTheme(localTheme);
  }, [ctx, localTheme]);

  if (ctx) return [ctx.theme, ctx.toggleTheme];
  return [localTheme, () => setLocalTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
