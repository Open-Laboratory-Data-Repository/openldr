import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'openldr.web.theme';

function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // The toggle still works when browser storage is blocked.
  }
  return 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* The current page still switches. */ }
  }, [theme]);
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={label} title={label}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}
