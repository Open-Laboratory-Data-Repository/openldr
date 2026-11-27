import { describe, expect, it } from 'vitest';
import { createModeSwitch } from './mode-switch';
import type { Settings } from './settings';

function harness(o: { settings?: Settings; answer?: boolean; saveFails?: { now: boolean } } = {}) {
  let settings: Settings = o.settings ?? { startAtSignIn: false, mode: 'local' };
  const asked: string[] = [];
  const told: string[] = [];
  const logs: string[] = [];
  let quits = 0;
  let relaunches = 0;
  /** The question stays open until the test answers it. */
  const open: Array<(yes: boolean) => void> = [];
  const sw = createModeSwitch({
    confirm: (to) => {
      asked.push(to);
      return o.answer === undefined ? new Promise<boolean>((r) => open.push(r)) : Promise.resolve(o.answer);
    },
    loadSettings: () => ({ ...settings }),
    saveSettings: (s) => {
      if (o.saveFails?.now) throw new Error('disk full');
      settings = { ...s };
    },
    tell: (what) => void told.push(what),
    quit: () => void quits++,
    relaunch: () => void relaunches++,
    log: (line) => void logs.push(line),
  });
  return { sw, asked, told, logs, open, quits: () => quits, relaunches: () => relaunches, settings: () => settings };
}

describe('createModeSwitch', () => {
  it('asks, saves the new mode, then quits the normal way', async () => {
    const h = harness({ answer: true });
    await h.sw.request('connect');
    expect(h.asked).toEqual(['connect']);
    expect(h.settings().mode).toBe('connect');
    expect(h.quits()).toBe(1);
    // The app is started again only once the quit has ended well.
    expect(h.relaunches()).toBe(0);
    h.sw.exiting(0);
    expect(h.relaunches()).toBe(1);
  });

  it('changes nothing when the person says no', async () => {
    const h = harness({ answer: false });
    await h.sw.request('connect');
    expect(h.settings().mode).toBe('local');
    expect(h.quits()).toBe(0);
    expect(h.sw.busy()).toBe(false);
    h.sw.exiting(0);
    expect(h.relaunches()).toBe(0);
  });

  it('asks once, however often the item is pressed', async () => {
    const h = harness();
    const first = h.sw.request('connect');
    void h.sw.request('connect');
    void h.sw.request('connect');
    expect(h.asked).toEqual(['connect']);
    h.open[0]?.(true);
    await first;
    // Still taken while the app shuts down: another press starts nothing.
    await h.sw.request('local');
    expect(h.asked).toEqual(['connect']);
    expect(h.quits()).toBe(1);
    expect(h.sw.busy()).toBe(true);
  });

  it('says so and does not quit when the mode cannot be saved', async () => {
    const saveFails = { now: true };
    const h = harness({ answer: true, saveFails });
    await h.sw.request('connect');
    expect(h.told).toEqual(['save-failed']);
    expect(h.quits()).toBe(0);
    expect(h.settings().mode).toBe('local');
    expect(h.sw.busy()).toBe(false);
    // It can be tried again.
    saveFails.now = false;
    await h.sw.request('connect');
    expect(h.quits()).toBe(1);
  });

  it('puts the old mode back, and starts nothing again, when OpenLDR on this PC did not stop', async () => {
    const h = harness({ answer: true });
    await h.sw.request('connect');
    h.sw.exiting(1);
    expect(h.relaunches()).toBe(0);
    expect(h.settings().mode).toBe('local');
  });

  it('keeps every other setting', async () => {
    const h = harness({ answer: true, settings: { startAtSignIn: true, mode: 'connect', server: { address: 'https://labpc:3443/studio/' }, port: 3990 } });
    await h.sw.request('local');
    expect(h.settings()).toEqual({ startAtSignIn: true, mode: 'local', server: { address: 'https://labpc:3443/studio/' }, port: 3990 });
  });

  it('does nothing at an exit that no switch asked for', () => {
    const h = harness({ answer: true });
    h.sw.exiting(0);
    h.sw.exiting(1);
    expect(h.relaunches()).toBe(0);
    expect(h.settings().mode).toBe('local');
  });
});
