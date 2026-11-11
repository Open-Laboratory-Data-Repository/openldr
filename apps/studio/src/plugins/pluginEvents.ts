// A signal that installed plugins changed: one was installed, enabled, disabled, rolled back,
// removed, or had its dashboard card or side panel switched. AppShell listens and reads the plugin
// list again. It needs telling because Settings keeps one AppShell across its pages
// (SettingsShell.tsx), so a change made there would otherwise not show until the user left Settings.

const listeners = new Set<() => void>();

export function onPluginsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyPluginsChanged(): void {
  for (const l of listeners) l();
}
