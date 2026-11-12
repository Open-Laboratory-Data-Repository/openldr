import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function snapshot() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function useWebsiteTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => 'dark');
}
