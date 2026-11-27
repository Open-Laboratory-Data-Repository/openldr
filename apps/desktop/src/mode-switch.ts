// Switching between the two ways the app runs, from the tray. Kept apart from Electron so its
// order can be tested: ask once, save, quit the normal way, and start again only after a quit
// that ended well.

import type { Settings } from './settings';

export interface ModeSwitchDeps {
  /** The yes or no question. */
  confirm(to: 'local' | 'connect'): Promise<boolean>;
  loadSettings(): Settings;
  /** Throws when the settings cannot be written. */
  saveSettings(s: Settings): void;
  /** Tells the person the mode could not be saved, so nothing changed. */
  tell(what: 'save-failed'): void;
  /** The app's normal quit. In local mode it stops OpenLDR on this PC first. */
  quit(): void;
  /** Starts the app again once this process has ended. */
  relaunch(): void;
  log(line: string): void;
}

export interface ModeSwitch {
  request(to: 'local' | 'connect'): Promise<void>;
  /** True from the press until the change is given up. It stays true while the app shuts down. */
  busy(): boolean;
  /** main.ts calls this just before the process ends, with its exit code. */
  exiting(code: number): void;
}

export function createModeSwitch(deps: ModeSwitchDeps): ModeSwitch {
  let busy = false;
  /** Set once the new mode is on disk and the quit is asked for. Holds the mode to put back. */
  let pending: { was: Settings['mode'] } | undefined;
  return {
    busy: () => busy,
    async request(to) {
      // Taken before the question, so a second press while it is open cannot start a second switch.
      if (busy) return;
      busy = true;
      if (!(await deps.confirm(to))) {
        busy = false;
        return;
      }
      const now = deps.loadSettings();
      try {
        deps.saveSettings({ ...now, mode: to });
      } catch (err) {
        // Without the new mode on disk the app would start as before. So it is not started again.
        deps.log(`The mode was not changed: ${err instanceof Error ? err.message : String(err)}`);
        deps.tell('save-failed');
        busy = false;
        return;
      }
      pending = { was: now.mode };
      deps.quit();
    },
    exiting(code) {
      if (pending === undefined) return;
      if (code === 0) return deps.relaunch();
      // OpenLDR on this PC did not stop. It is still running, so the app must find it again at
      // its next start: the old mode goes back, and nothing is started now.
      try {
        const { mode: _new, ...rest } = deps.loadSettings();
        deps.saveSettings(pending.was === undefined ? rest : { ...rest, mode: pending.was });
      } catch (err) {
        deps.log(`The old mode could not be put back: ${err instanceof Error ? err.message : String(err)}`);
      }
      deps.log('The switch was given up: OpenLDR on this PC did not stop.');
    },
  };
}
