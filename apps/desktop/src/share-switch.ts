// Turning "Share on the lab network" on or off from the tray. Kept apart from Electron so its
// order can be tested: ask, save, restart, and say plainly when a step did not happen.

import type { Settings } from './settings';

export interface ShareSwitchDeps {
  /** The yes or no question before sharing is turned on. */
  confirm(): Promise<boolean>;
  loadSettings(): Settings;
  /** Throws when the settings cannot be written. */
  saveSettings(s: Settings): void;
  /** Restarts the app's own launcher. False when it is not the app's to restart, or not ready. */
  restart(): Promise<boolean>;
  /** Tells the person one of two things that are not errors of theirs. */
  tell(what: 'save-failed' | 'next-start'): void;
  /** The tray menu must be drawn again: the busy state or the setting changed. */
  changed(): void;
  log(line: string): void;
}

export interface ShareSwitch {
  set(on: boolean): Promise<void>;
  /** True from the press until the change is applied or given up. A press meanwhile does nothing. */
  busy(): boolean;
}

export function createShareSwitch(deps: ShareSwitchDeps): ShareSwitch {
  let busy = false;
  return {
    busy: () => busy,
    async set(on) {
      // Taken before the question, so a second press while it is open cannot start a second change.
      if (busy) return;
      busy = true;
      deps.changed();
      try {
        if (on && !(await deps.confirm())) return;
        const { shareOnNetwork: _was, ...rest } = deps.loadSettings();
        try {
          deps.saveSettings(on ? { ...rest, shareOnNetwork: true } : rest);
        } catch (err) {
          // Without the new setting on disk a restart would bring the old one back. So no restart.
          deps.log(`The sharing setting could not be saved: ${err instanceof Error ? err.message : String(err)}`);
          deps.tell('save-failed');
          return;
        }
        let applied = false;
        try {
          applied = await deps.restart();
        } catch (err) {
          deps.log(`The restart for sharing failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        // The launcher was started outside this app, or is not ready. The setting waits for the next start.
        if (!applied) deps.tell('next-start');
      } finally {
        busy = false;
        deps.changed();
      }
    },
  };
}
