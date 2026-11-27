import { describe, expect, it, vi } from 'vitest';
import type { Settings } from './settings';
import { createShareSwitch, type ShareSwitchDeps } from './share-switch';

interface Harness {
  deps: ShareSwitchDeps;
  settings: () => Settings;
  calls: string[];
}

function harness(o: { confirm?: () => Promise<boolean>; restart?: () => Promise<boolean>; saveFails?: boolean; start?: Settings } = {}): Harness {
  let settings: Settings = o.start ?? { startAtSignIn: false };
  const calls: string[] = [];
  const deps: ShareSwitchDeps = {
    confirm: async () => {
      calls.push('confirm');
      return o.confirm ? o.confirm() : true;
    },
    loadSettings: () => settings,
    saveSettings: (s) => {
      calls.push('save');
      if (o.saveFails) throw new Error('disk full');
      settings = s;
    },
    restart: async () => {
      calls.push('restart');
      return o.restart ? o.restart() : true;
    },
    tell: (what) => void calls.push(`tell:${what}`),
    changed: () => void calls.push('changed'),
    log: vi.fn(),
  };
  return { deps, settings: () => settings, calls };
}

describe('createShareSwitch', () => {
  it('asks, saves, restarts and stays quiet when turning sharing on', async () => {
    const h = harness();
    const sw = createShareSwitch(h.deps);
    await sw.set(true);
    expect(h.calls.filter((c) => c !== 'changed')).toEqual(['confirm', 'save', 'restart']);
    expect(h.settings()).toEqual({ startAtSignIn: false, shareOnNetwork: true });
    expect(sw.busy()).toBe(false);
  });

  it('does not ask when turning sharing off, and removes the setting', async () => {
    const h = harness({ start: { startAtSignIn: true, shareOnNetwork: true, sharePort: 8443 } });
    await createShareSwitch(h.deps).set(false);
    expect(h.calls.filter((c) => c !== 'changed')).toEqual(['save', 'restart']);
    expect(h.settings()).toEqual({ startAtSignIn: true, sharePort: 8443 });
  });

  it('changes nothing when the person says no', async () => {
    const h = harness({ confirm: async () => false });
    await createShareSwitch(h.deps).set(true);
    expect(h.calls.filter((c) => c !== 'changed')).toEqual(['confirm']);
    expect(h.settings()).toEqual({ startAtSignIn: false });
  });

  it('says so and does not restart when the setting cannot be saved', async () => {
    const h = harness({ saveFails: true });
    await createShareSwitch(h.deps).set(true);
    expect(h.calls.filter((c) => c !== 'changed')).toEqual(['confirm', 'save', 'tell:save-failed']);
    expect(h.calls).not.toContain('restart');
  });

  it('does not restart with the old setting when turning sharing off cannot be saved', async () => {
    const h = harness({ saveFails: true, start: { startAtSignIn: false, shareOnNetwork: true } });
    await createShareSwitch(h.deps).set(false);
    expect(h.calls).not.toContain('restart');
    expect(h.calls).toContain('tell:save-failed');
  });

  it('says the change waits for the next start when the launcher is not the app\'s to restart', async () => {
    const h = harness({ restart: async () => false });
    await createShareSwitch(h.deps).set(true);
    expect(h.calls.filter((c) => c !== 'changed')).toEqual(['confirm', 'save', 'restart', 'tell:next-start']);
    expect(h.settings().shareOnNetwork).toBe(true);
  });

  it('is busy from the first press, and refuses a second press while the question is open', async () => {
    let answer!: (yes: boolean) => void;
    const h = harness({ confirm: () => new Promise<boolean>((r) => (answer = r)) });
    const sw = createShareSwitch(h.deps);
    const first = sw.set(true);
    expect(sw.busy()).toBe(true);
    await sw.set(true);
    await sw.set(false);
    expect(h.calls.filter((c) => c === 'confirm')).toHaveLength(1);
    expect(h.calls).not.toContain('save');
    answer(true);
    await first;
    expect(h.calls.filter((c) => c === 'restart')).toHaveLength(1);
    expect(sw.busy()).toBe(false);
  });

  it('stops being busy when the person says no, when the save fails and when the restart throws', async () => {
    for (const o of [{ confirm: async () => false }, { saveFails: true }, { restart: async () => Promise.reject(new Error('boom')) }]) {
      const h = harness(o);
      const sw = createShareSwitch(h.deps);
      await sw.set(true);
      expect(sw.busy()).toBe(false);
      // The menu is drawn again at the end, so the box shows the real state.
      expect(h.calls.at(-1)).toBe('changed');
    }
  });

  it('draws the menu again when it becomes busy', async () => {
    const h = harness();
    await createShareSwitch(h.deps).set(false);
    expect(h.calls[0]).toBe('changed');
  });
});
