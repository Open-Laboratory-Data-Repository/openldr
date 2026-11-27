import { describe, expect, it } from 'vitest';
import type { Screen } from './controller';
import { makeLock, WRONG_PIN_WAIT_MS } from './lock';
import { createLockFlow, quitNeedsPin } from './lock-flow';
import type { Settings } from './settings';

type Pin = Extract<Screen, { screen: 'pin' }>;

function harness(o: { settings?: Settings; saveFails?: { now: boolean } } = {}) {
  let settings: Settings = o.settings ?? { startAtSignIn: false };
  const opened: Pin[] = [];
  const applied: boolean[] = [];
  const told: string[] = [];
  const logs: string[] = [];
  const waits: Array<() => void> = [];
  const asked: number[] = [];
  let closes = 0;
  let quits = 0;
  const flow = createLockFlow({
    loadSettings: () => ({ ...settings }),
    saveSettings: (s) => {
      if (o.saveFails?.now) throw new Error('disk full');
      settings = { ...s };
    },
    sleep: (ms) => new Promise<void>((r) => { asked.push(ms); waits.push(r); }),
    open: (screen) => void opened.push(screen),
    close: () => void closes++,
    apply: (on) => void applied.push(on),
    quit: () => void quits++,
    tell: (what) => void told.push(what),
    log: (line) => void logs.push(line),
  });
  const release = async (): Promise<void> => {
    for (const r of waits.splice(0)) r();
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
  const edit = (change: (s: Settings) => Settings): void => { settings = change(settings); };
  return { flow, edit, opened, applied, told, logs, asked, release, settle, closes: () => closes, quits: () => quits, settings: () => settings, last: () => opened.at(-1) };
}
const locked = (pin = '1234'): Settings => ({ startAtSignIn: true, lock: makeLock(pin) });

describe('quitNeedsPin', () => {
  it('asks for the PIN at the tray, the menu and the keyboard when locked', () => {
    expect(quitNeedsPin('tray', true)).toBe(true);
    expect(quitNeedsPin('menu', true)).toBe(true);
  });

  it('lets a shutdown, a sign-out and a signal through without it', () => {
    for (const why of ['shutdown', 'session-end', 'query-session-end', 'before-quit', 'SIGTERM', 'SIGINT']) expect(quitNeedsPin(why, true)).toBe(false);
  });

  it('never asks on a PC that is not locked', () => {
    expect(quitNeedsPin('tray', false)).toBe(false);
    expect(quitNeedsPin('menu', false)).toBe(false);
  });
});

describe('createLockFlow, turning the lock on', () => {
  it('asks for a PIN, and locks with one of four characters or more', async () => {
    const h = harness();
    expect(h.flow.locked()).toBe(false);
    h.flow.ask('set');
    expect(h.opened).toEqual([{ screen: 'pin', purpose: 'set' }]);
    await h.flow.submit('1234');
    expect(h.settings().lock?.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(h.applied).toEqual([true]);
    expect(h.closes()).toBe(1);
    expect(h.flow.locked()).toBe(true);
  });

  it('shows the screen again for a shorter PIN and saves nothing', async () => {
    const h = harness();
    h.flow.ask('set');
    await h.flow.submit('123');
    expect(h.last()).toEqual({ screen: 'pin', purpose: 'set', tooShort: true });
    expect(h.settings().lock).toBeUndefined();
    expect(h.applied).toEqual([]);
    expect(h.closes()).toBe(0);
  });

  it('says so and stays unlocked when the lock cannot be saved', async () => {
    const h = harness({ saveFails: { now: true } });
    h.flow.ask('set');
    await h.flow.submit('1234');
    expect(h.told).toEqual(['save-failed']);
    expect(h.applied).toEqual([]);
    expect(h.flow.locked()).toBe(false);
    expect(h.opened).toEqual([{ screen: 'pin', purpose: 'set' }, { screen: 'pin', purpose: 'set' }]);
  });

  it('does not ask for a new PIN on a PC that is already locked', () => {
    const h = harness({ settings: locked() });
    h.flow.ask('set');
    expect(h.opened).toEqual([]);
  });

  it('keeps every other setting, and never logs the PIN', async () => {
    const h = harness({ settings: { startAtSignIn: false, mode: 'connect', server: { address: 'https://labpc:3443/studio/' } } });
    h.flow.ask('set');
    await h.flow.submit('83917');
    const { lock, ...rest } = h.settings();
    expect(rest).toEqual({ startAtSignIn: false, mode: 'connect', server: { address: 'https://labpc:3443/studio/' } });
    expect(JSON.stringify([lock, h.logs, h.opened])).not.toContain('83917');
  });
});

describe('createLockFlow, unlocking', () => {
  it('takes the lock off with the right PIN', async () => {
    const h = harness({ settings: locked() });
    expect(h.flow.locked()).toBe(true);
    h.flow.ask('unlock');
    expect(h.opened).toEqual([{ screen: 'pin', purpose: 'unlock' }]);
    await h.flow.submit('1234');
    expect(h.settings().lock).toBeUndefined();
    expect(h.applied).toEqual([false]);
    expect(h.closes()).toBe(1);
    expect(h.flow.locked()).toBe(false);
  });

  it('refuses a wrong PIN after the wait, and keeps the lock', async () => {
    const h = harness({ settings: locked() });
    h.flow.ask('unlock');
    void h.flow.submit('0000');
    await h.settle();
    expect(h.asked).toEqual([WRONG_PIN_WAIT_MS]);
    expect(h.opened).toHaveLength(1);
    await h.release();
    expect(h.last()).toEqual({ screen: 'pin', purpose: 'unlock', wrong: true });
    expect(h.settings().lock).toBeDefined();
    expect(h.applied).toEqual([]);
  });

  it('does not check another PIN during the wait, even after the window was closed and opened again', async () => {
    const h = harness({ settings: locked() });
    h.flow.ask('unlock');
    void h.flow.submit('0000');
    await h.settle();
    h.flow.cancel();
    h.flow.ask('unlock');
    const before = h.opened.length;
    await h.flow.submit('1234');
    expect(h.settings().lock).toBeDefined();
    expect(h.applied).toEqual([]);
    // The page turns its buttons off when one is pressed. The screen is sent again so they come back.
    expect(h.opened.slice(before)).toEqual([{ screen: 'pin', purpose: 'unlock' }]);
    await h.release();
    // The wrong answer belongs to a window that was closed: the new one is not told.
    expect(h.last()).toEqual({ screen: 'pin', purpose: 'unlock' });
    await h.flow.submit('1234');
    expect(h.applied).toEqual([false]);
  });

  it('says so and stays locked when the change cannot be saved', async () => {
    const saveFails = { now: false };
    const h = harness({ settings: locked(), saveFails });
    saveFails.now = true;
    h.flow.ask('unlock');
    await h.flow.submit('1234');
    expect(h.told).toEqual(['save-failed']);
    expect(h.applied).toEqual([]);
    expect(h.flow.locked()).toBe(true);
    // The window stays, with its buttons back.
    expect(h.opened).toEqual([{ screen: 'pin', purpose: 'unlock' }, { screen: 'pin', purpose: 'unlock' }]);
    expect(h.closes()).toBe(0);
  });

  it('unlocks with no question when the lock is gone from the settings file', () => {
    const h = harness({ settings: locked() });
    expect(h.flow.locked()).toBe(true);
    // Someone with the PC's account removed `lock` from the file: the way back from a forgotten PIN.
    h.edit(({ lock: _gone, ...rest }) => rest);
    h.flow.ask('unlock');
    expect(h.opened).toEqual([]);
    expect(h.applied).toEqual([false]);
    expect(h.flow.locked()).toBe(false);
  });

  it('does nothing on a PC that is not locked', () => {
    const h = harness();
    h.flow.ask('unlock');
    expect(h.opened).toEqual([]);
    expect(h.applied).toEqual([]);
  });
});

describe('createLockFlow, quitting a locked PC', () => {
  it('quits with the right PIN and leaves the lock on', async () => {
    const h = harness({ settings: locked() });
    h.flow.ask('quit');
    expect(h.opened).toEqual([{ screen: 'pin', purpose: 'quit' }]);
    await h.flow.submit('1234');
    expect(h.quits()).toBe(1);
    expect(h.settings().lock).toBeDefined();
    expect(h.applied).toEqual([]);
  });

  it('does not quit with a wrong PIN', async () => {
    const h = harness({ settings: locked() });
    h.flow.ask('quit');
    void h.flow.submit('9999');
    await h.release();
    expect(h.quits()).toBe(0);
    expect(h.last()).toEqual({ screen: 'pin', purpose: 'quit', wrong: true });
  });

  it('Cancel closes the window and changes nothing', async () => {
    const h = harness({ settings: locked() });
    h.flow.ask('quit');
    h.flow.cancel();
    expect(h.closes()).toBe(1);
    await h.flow.submit('1234');
    expect(h.quits()).toBe(0);
  });
});
