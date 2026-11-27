// The lock's steps: ask for a PIN in a small window, then lock, unlock or quit. Kept apart from
// Electron so its order can be tested. main.ts opens the window and applies the lock.
//
// The PIN passes through here and nowhere else. It is never logged and never sent to a page.

import type { Screen } from './controller';
import { makeLock, MIN_PIN_LENGTH, pinGate } from './lock';
import type { Settings } from './settings';

type PinScreen = Extract<Screen, { screen: 'pin' }>;
type Purpose = PinScreen['purpose'];

/**
 * Whether a quit must wait for the PIN. The tray and the app menu (with its keyboard shortcut)
 * ask. A shutdown, a sign-out and a signal do not: Electron reports a signal as a plain
 * `before-quit`, the same way it reports the session ending, so the two cannot be told apart, and
 * a PC must be able to shut down with OpenLDR stopped cleanly.
 */
export function quitNeedsPin(why: string, locked: boolean): boolean {
  return locked && (why === 'tray' || why === 'menu');
}

export interface LockFlowDeps {
  loadSettings(): Settings;
  /** Throws when the settings cannot be written. */
  saveSettings(s: Settings): void;
  sleep(ms: number): Promise<void>;
  /** Opens the PIN window with this screen, or shows the screen in the one that is open. */
  open(screen: PinScreen): void;
  /** Closes the PIN window. */
  close(): void;
  /** Puts the lock on or takes it off: kiosk mode, the tray, start at sign-in. */
  apply(on: boolean): void;
  /** The app's real quit. */
  quit(): void;
  /** Tells the person the change could not be saved, so nothing changed. */
  tell(what: 'save-failed'): void;
  log(line: string): void;
}

export interface LockFlow {
  /** True while this PC is locked to OpenLDR. */
  locked(): boolean;
  /** 'set' on a PC that is not locked; 'unlock' and 'quit' on one that is. Anything else does nothing. */
  ask(purpose: Purpose): void;
  /** The PIN window's primary button, with what was typed. */
  submit(pin: string): Promise<void>;
  /** The PIN window's Cancel, or the window was closed. */
  cancel(): void;
}

export function createLockFlow(deps: LockFlowDeps): LockFlow {
  let locked = deps.loadSettings().lock !== undefined;
  /** The purpose of the PIN window that is open, with a number that changes for every window. */
  let asking: { purpose: Purpose; window: number } | undefined;
  let windows = 0;
  /** One gate per lock, kept across windows: closing the window does not end a wrong PIN's wait. */
  let gate: { hash: string; submit(pin: string): Promise<'ok' | 'wrong' | 'busy'> } | undefined;

  // The page turns its buttons off when one is pressed, until the next screen. So every answer
  // that keeps the window open sends a screen.
  const failed = (what: string, purpose: Purpose, err: unknown): void => {
    deps.log(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    deps.tell('save-failed');
    deps.open({ screen: 'pin', purpose });
  };
  const done = (): void => {
    asking = undefined;
    deps.close();
  };

  return {
    locked: () => locked,

    ask(purpose) {
      if (purpose === 'set') {
        if (locked) return;
      } else {
        if (!locked) return;
        if (deps.loadSettings().lock === undefined) {
          // `lock` was removed from the settings file with the PC's account. Nothing is left to ask for.
          locked = false;
          deps.log('The lock is gone from the settings file: this PC is unlocked.');
          deps.apply(false);
          if (purpose === 'quit') deps.quit();
          return;
        }
      }
      asking = { purpose, window: ++windows };
      deps.open({ screen: 'pin', purpose });
    },

    async submit(pin) {
      const now = asking;
      if (now === undefined) return;
      if (now.purpose === 'set') {
        if (pin.length < MIN_PIN_LENGTH) return deps.open({ screen: 'pin', purpose: 'set', tooShort: true });
        try {
          deps.saveSettings({ ...deps.loadSettings(), lock: makeLock(pin) });
        } catch (err) {
          return failed('The lock could not be saved', 'set', err);
        }
        locked = true;
        deps.log('This PC is now locked to OpenLDR.');
        done();
        deps.apply(true);
        return;
      }
      const lock = deps.loadSettings().lock;
      if (lock === undefined) return;
      if (gate === undefined || gate.hash !== lock.hash) gate = { hash: lock.hash, ...pinGate(lock, deps.sleep) };
      const answer = await gate.submit(pin);
      // The window this try came from was closed, or another was opened, while it waited.
      if (asking?.window !== now.window) return;
      // Not checked: a wrong PIN's wait is still running.
      if (answer === 'busy') return deps.open({ screen: 'pin', purpose: now.purpose });
      if (answer === 'wrong') return deps.open({ screen: 'pin', purpose: now.purpose, wrong: true });
      if (now.purpose === 'quit') {
        done();
        deps.quit();
        return;
      }
      try {
        const { lock: _gone, ...rest } = deps.loadSettings();
        deps.saveSettings(rest);
      } catch (err) {
        return failed('The lock could not be taken off', 'unlock', err);
      }
      locked = false;
      deps.log('This PC is unlocked.');
      done();
      deps.apply(false);
    },

    cancel() {
      if (asking === undefined) return;
      done();
    },
  };
}

/**
 * A locked PC starts OpenLDR when its user signs in. This goes by what the system holds, never by
 * the saved setting: the system's entry can be removed while the setting still says on. False when
 * the system could not be told, and then the person is told, because the PC would come up
 * unlocked onto its desktop after a restart.
 */
export function ensureStartAtSignIn(deps: {
  /** True when the system will start the app at sign-in. */
  registered(): boolean;
  /** Tells the system to. Throws when it cannot. */
  register(): void;
  /** The saved setting. */
  saved(): boolean;
  /** Saves the setting as on. Throws when it cannot. */
  save(): void;
  tell(): void;
  log(line: string): void;
}): boolean {
  if (!deps.registered()) {
    try {
      deps.register();
    } catch (err) {
      deps.log(`Start at sign-in was not turned on: ${err instanceof Error ? err.message : String(err)}`);
      deps.tell();
      return false;
    }
  }
  if (!deps.saved()) {
    try {
      deps.save();
    } catch (err) {
      // The system starts the app either way. Only the tray's tick is behind.
      deps.log(`The start at sign-in setting could not be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return true;
}
