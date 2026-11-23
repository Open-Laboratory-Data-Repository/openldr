import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Tracks the app theme (set as `data-theme` on <html>) so toasts match light/dark. */
function useThemeAttr(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function Toaster(props: ToasterProps) {
  const theme = useThemeAttr();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      // Load and save errors carry the server's message, which can hold a path or id with no space
      // to wrap on. Without this it runs off a phone screen.
      toastOptions={{ classNames: { title: '[overflow-wrap:anywhere]', description: '[overflow-wrap:anywhere]' } }}
      {...props}
    />
  );
}
