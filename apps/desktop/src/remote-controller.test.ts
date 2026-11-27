import { describe, expect, it } from 'vitest';
import type { PinnedServer, ServerCertificate } from './cert-trust';
import type { Screen } from './controller';
import { RemoteController, STUDIO_LOAD_TRIES, type RemoteDeps } from './remote-controller';
import type { Settings } from './settings';
import { STRINGS } from './strings';

const FP_A = Array.from({ length: 32 }, () => 'AA').join(':');
const FP_B = Array.from({ length: 32 }, () => 'BB').join(':');
const ADDRESS = 'https://labpc:3443/studio/';

type Probe = 'ok' | 'no-answer' | 'untrusted';

/** Lets every pending promise and immediate run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

interface Options {
  settings?: Settings;
  /** Answers to probe, in order. The last one repeats. */
  probes?: Probe[];
  /** A probe of its own, for a test that holds it open. */
  probe?: (address: string) => Promise<Probe>;
  certificate?: ServerCertificate;
}

function harness(o: Options = {}) {
  let settings: Settings = o.settings ?? { startAtSignIn: false };
  const screens: Screen[] = [];
  const pins: Array<PinnedServer | undefined> = [];
  const probed: string[] = [];
  const read: Array<[string, number]> = [];
  const exits: number[] = [];
  const logs: string[] = [];
  const saves: Settings[] = [];
  /** Waits the controller is in. A test lets one go by calling tick(). */
  const sleeps: Array<() => void> = [];
  const answers = [...(o.probes ?? ['ok'])];
  const deps: RemoteDeps = {
    probe: o.probe ?? (async (address) => {
      probed.push(address);
      return answers.length > 1 ? (answers.shift() as Probe) : (answers[0] as Probe);
    }),
    readCertificate: async (host, port) => {
      read.push([host, port]);
      return o.certificate ?? { ok: true, fingerprint: FP_A };
    },
    pin: (server) => void pins.push(server),
    loadSettings: () => ({ ...settings }),
    saveSettings: (s) => {
      settings = { ...s };
      saves.push({ ...s });
    },
    show: (screen) => void screens.push(screen),
    sleep: () => new Promise<void>((done) => void sleeps.push(done)),
    exit: (code) => void exits.push(code),
    log: (line) => void logs.push(line),
    strings: STRINGS.en,
    pollMs: 10_000,
  };
  const controller = new RemoteController(deps);
  /** Lets every wait that is open now end, as a clock moving on by one poll would. */
  const tick = async (): Promise<void> => {
    for (const done of sleeps.splice(0)) done();
    await settle();
  };
  return { controller, screens, pins, probed, read, exits, logs, saves, sleeps, tick, settings: () => settings, last: () => screens.at(-1) };
}

const saved = (fingerprint?: string): Settings => ({ startAtSignIn: false, mode: 'connect', server: { address: ADDRESS, ...(fingerprint ? { fingerprint } : {}) } });

describe('RemoteController, connecting for the first time', () => {
  it('with no saved server, shows the connect screen', async () => {
    const h = harness();
    await h.controller.start();
    expect(h.screens).toEqual([{ screen: 'connect' }]);
    expect(h.probed).toEqual([]);
    expect(h.controller.address()).toBeUndefined();
  });

  it('offers Back on the connect screen only while no mode is saved', async () => {
    const fresh = harness();
    await fresh.controller.start();
    expect(fresh.last()).toEqual({ screen: 'connect' });
    const chosen = harness({ settings: { startAtSignIn: false, mode: 'connect' } });
    await chosen.controller.start();
    expect(chosen.last()).toEqual({ screen: 'connect', fixed: true });
  });

  it.each([
    ['http://labpc', 'not-https'],
    ['', 'empty'],
    ['lab pc', 'unreadable'],
  ] as const)('shows the problem and keeps the text when %j is refused', async (typed, problem) => {
    const h = harness();
    await h.controller.connect(typed);
    expect(h.last()).toEqual({ screen: 'connect', value: typed, problem });
    expect(h.probed).toEqual([]);
    expect(h.saves).toEqual([]);
  });

  it('connects without a question when Electron already trusts the certificate', async () => {
    const h = harness({ probes: ['ok'] });
    await h.controller.connect('LabPC:3443');
    expect(h.screens).toEqual([{ screen: 'studio', address: ADDRESS }]);
    expect(h.read).toEqual([]);
    expect(h.settings().server).toEqual({ address: ADDRESS });
    expect(h.controller.address()).toBe(ADDRESS);
    expect(h.probed).toEqual([ADDRESS]);
  });

  it('never reads a certificate for the http address on this PC', async () => {
    const h = harness({ probes: ['ok'] });
    await h.controller.connect('http://127.0.0.1:3000');
    expect(h.read).toEqual([]);
    expect(h.last()).toEqual({ screen: 'studio', address: 'http://127.0.0.1:3000/studio/' });
    const off = harness({ probes: ['no-answer'] });
    await off.controller.connect('http://127.0.0.1:3000');
    expect(off.read).toEqual([]);
    expect(off.last()).toEqual({ screen: 'connect', value: 'http://127.0.0.1:3000', problem: 'no-answer' });
  });

  it('says nothing answered when the probe gets no answer, and saves nothing', async () => {
    const h = harness({ probes: ['no-answer'] });
    await h.controller.connect('labpc:3443');
    expect(h.last()).toEqual({ screen: 'connect', value: 'labpc:3443', problem: 'no-answer' });
    expect(h.settings().server).toBeUndefined();
  });

  it('says nothing answered when the certificate cannot be read', async () => {
    const h = harness({ probes: ['untrusted'], certificate: { ok: false } });
    await h.controller.connect('labpc:3443');
    expect(h.last()).toEqual({ screen: 'connect', value: 'labpc:3443', problem: 'no-answer' });
  });

  it('asks about an untrusted certificate, then saves and pins it on yes', async () => {
    const h = harness({ probes: ['untrusted', 'ok'] });
    await h.controller.connect('labpc:3443');
    expect(h.last()).toEqual({ screen: 'certificate', address: ADDRESS, fingerprint: FP_A, changed: false });
    expect(h.read).toEqual([['labpc', 3443]]);
    // Nothing is saved or pinned before the person answers.
    expect(h.settings().server).toBeUndefined();
    expect(h.pins.filter(Boolean)).toEqual([]);
    await h.controller.trust(true);
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
    expect(h.settings().server).toEqual({ address: ADDRESS, fingerprint: FP_A });
    expect(h.pins.at(-1)).toEqual({ host: 'labpc', fingerprint: FP_A });
  });

  it('goes back to the connect screen on no, and saves nothing', async () => {
    const h = harness({ probes: ['untrusted'] });
    await h.controller.connect('labpc:3443');
    await h.controller.trust(false);
    expect(h.last()).toEqual({ screen: 'connect', value: 'labpc:3443' });
    expect(h.saves).toEqual([]);
    expect(h.pins.filter(Boolean)).toEqual([]);
  });

  it('gives up after one refused try and says the certificate could not be accepted', async () => {
    const h = harness({ probes: ['untrusted', 'untrusted'] });
    await h.controller.connect('labpc:3443');
    await h.controller.trust(true);
    expect(h.last()).toEqual({ screen: 'connect', value: 'labpc:3443', problem: 'certificate' });
    expect(h.probed).toHaveLength(2);
    // The certificate the person accepted did not work, so it is not kept.
    expect(h.settings().server).toBeUndefined();
    expect(h.pins.at(-1)).toBeUndefined();
  });

  it('drops the pin of the server before it tries another one', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    await h.controller.connect('other.example:3443');
    // The old pin is for labpc. It must not be in force while another host is probed.
    const i = h.probed.indexOf('https://other.example:3443/studio/');
    expect(i).toBeGreaterThan(0);
    expect(h.pins.at(-1)).toBeUndefined();
  });

  it('answering the certificate screen twice does nothing the second time', async () => {
    const h = harness({ probes: ['untrusted', 'ok'] });
    await h.controller.connect('labpc:3443');
    await h.controller.trust(true);
    const before = h.screens.length;
    await h.controller.trust(true);
    await h.controller.trust(false);
    expect(h.screens).toHaveLength(before);
  });
});

describe('RemoteController, with a saved server', () => {
  it('pins it and shows Studio', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    expect(h.pins).toEqual([{ host: 'labpc', fingerprint: FP_A }]);
    expect(h.screens).toEqual([{ screen: 'starting', note: 'checking' }, { screen: 'studio', address: ADDRESS }]);
    expect(h.controller.address()).toBe(ADDRESS);
  });

  it('pins nothing for a saved server with no fingerprint', async () => {
    const h = harness({ settings: saved(), probes: ['ok'] });
    await h.controller.start();
    expect(h.pins).toEqual([undefined]);
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
  });

  it('at start, shows the unreachable screen, then Studio once the server answers', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['no-answer', 'no-answer', 'ok'] });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    await h.tick();
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    await h.tick();
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
    expect(h.probed).toHaveLength(3);
    // The unreachable screen is shown once, not once per try.
    expect(h.screens.filter((s) => s.screen === 'unreachable')).toHaveLength(1);
  });

  it('asks again when the saved certificate no longer matches, and keeps the old one until yes', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['untrusted', 'ok'], certificate: { ok: true, fingerprint: FP_B } });
    await h.controller.start();
    expect(h.last()).toEqual({ screen: 'certificate', address: ADDRESS, fingerprint: FP_B, changed: true });
    expect(h.settings().server).toEqual({ address: ADDRESS, fingerprint: FP_A });
    expect(h.pins.at(-1)).toEqual({ host: 'labpc', fingerprint: FP_A });
    await h.controller.trust(true);
    expect(h.settings().server).toEqual({ address: ADDRESS, fingerprint: FP_B });
    expect(h.pins.at(-1)).toEqual({ host: 'labpc', fingerprint: FP_B });
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
  });

  it('keeps the old certificate when the person says no to a changed one', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['untrusted'], certificate: { ok: true, fingerprint: FP_B } });
    await h.controller.start();
    await h.controller.trust(false);
    expect(h.settings().server).toEqual({ address: ADDRESS, fingerprint: FP_A });
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    // Nothing is tried again by itself: a refused certificate is not a server that is off.
    await h.tick();
    expect(h.probed).toHaveLength(1);
  });

  it('does not loop when the saved certificate is refused but has not changed', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['untrusted'], certificate: { ok: true, fingerprint: FP_A } });
    await h.controller.start();
    expect(h.last()).toEqual({ screen: 'connect', value: ADDRESS, problem: 'certificate', fixed: true });
    await h.tick();
    expect(h.probed).toHaveLength(1);
  });

  it('asks about a certificate that was trusted by the system before and is not now', async () => {
    const h = harness({ settings: saved(), probes: ['untrusted'], certificate: { ok: true, fingerprint: FP_B } });
    await h.controller.start();
    expect(h.last()).toEqual({ screen: 'connect', value: ADDRESS, problem: 'certificate', fixed: true });
  });

  it('runs no probe while Studio is shown', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
    for (let i = 0; i < 10; i++) await h.tick();
    expect(h.probed).toHaveLength(1);
    expect(h.sleeps).toHaveLength(0);
    expect(h.screens.filter((s) => s.screen === 'studio')).toHaveLength(1);
  });

  it('studioFailed shows the unreachable screen and brings Studio back when the server answers', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok', 'no-answer', 'ok'] });
    await h.controller.start();
    void h.controller.studioFailed();
    await settle();
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    expect(h.controller.address()).toBeUndefined();
    await h.tick();
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    await h.tick();
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
  });

  it('stops after three failed Studio loads in a row while the server answers', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    for (let i = 1; i < STUDIO_LOAD_TRIES; i++) {
      void h.controller.studioFailed();
      await settle();
      await h.tick();
      expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
    }
    await h.controller.studioFailed();
    expect(h.last()).toEqual({ screen: 'error', message: STRINGS.en.studioWillNotLoad });
    // It has stopped. Nothing more is tried by itself.
    const probes = h.probed.length;
    await h.tick();
    expect(h.probed).toHaveLength(probes);
  });

  it('a Studio page that loads resets the count of failed loads', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    for (let round = 0; round < STUDIO_LOAD_TRIES * 2; round++) {
      void h.controller.studioFailed();
      await settle();
      await h.tick();
      expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
      h.controller.studioLoaded();
    }
    expect(h.screens.some((s) => s.screen === 'error')).toBe(false);
  });

  it('retry tries at once, from the unreachable screen and from the error screen', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['no-answer', 'ok'] });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'unreachable', address: ADDRESS });
    await h.controller.retry();
    expect(h.last()).toEqual({ screen: 'studio', address: ADDRESS });
    // The wait the first try was in must not act when it ends.
    const count = h.screens.length;
    await h.tick();
    expect(h.screens).toHaveLength(count);
  });

  it('ignores a probe answer that comes back after the server was changed', async () => {
    let release: (answer: Probe) => void = () => {};
    const h = harness({ settings: saved(FP_A), probe: () => new Promise<Probe>((done) => { release = done; }) });
    void h.controller.start();
    await settle();
    h.controller.changeServer();
    expect(h.last()).toEqual({ screen: 'connect', value: ADDRESS, fixed: true });
    release('ok');
    await settle();
    expect(h.last()).toEqual({ screen: 'connect', value: ADDRESS, fixed: true });
    expect(h.controller.address()).toBeUndefined();
  });

  it('changeServer forgets the server and its pin, and fills the old address in', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    h.controller.changeServer();
    expect(h.settings().server).toBeUndefined();
    expect(h.settings().mode).toBe('connect');
    expect(h.pins.at(-1)).toBeUndefined();
    expect(h.last()).toEqual({ screen: 'connect', value: ADDRESS, fixed: true });
    expect(h.controller.address()).toBeUndefined();
  });

  it('quit exits with 0 and stops any waiting', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['no-answer'] });
    void h.controller.start();
    await settle();
    await h.controller.quit();
    expect(h.exits).toEqual([0]);
    const count = h.screens.length;
    const probes = h.probed.length;
    await h.tick();
    expect(h.screens).toHaveLength(count);
    expect(h.probed).toHaveLength(probes);
  });

  it('never gives a bridge address or a data folder', async () => {
    const h = harness({ settings: saved(FP_A), probes: ['ok'] });
    await h.controller.start();
    expect(h.controller.bridgeAddress()).toBeUndefined();
    expect(h.controller.dataDir()).toBeUndefined();
  });

  it('keeps every other setting when it saves the server', async () => {
    const h = harness({ settings: { startAtSignIn: true, window: { width: 900, height: 700 }, mode: 'connect', lock: { salt: 'ab', hash: 'cd' } }, probes: ['ok'] });
    await h.controller.connect('labpc:3443');
    expect(h.settings()).toEqual({ startAtSignIn: true, window: { width: 900, height: 700 }, mode: 'connect', lock: { salt: 'ab', hash: 'cd' }, server: { address: ADDRESS } });
  });
});
