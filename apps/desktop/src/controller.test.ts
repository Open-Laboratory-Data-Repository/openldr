import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopController, pageState, type ControllerDeps, type Screen } from './controller';
import type { LauncherEvent, Status } from './launcher';
import type { Settings } from './settings';
import { STRINGS } from './strings';

const strings = STRINGS.en;
const DATA = '/tmp/openldr d-é/data';
/** What a launcher's `ready` event and its status say. */
const OWN = 'http://localhost:3990/studio/';
const OTHER = 'http://localhost:3991/studio/';
/** What the window loads: the same address on the host the launcher is bound to. */
const OWN_WINDOW = 'http://127.0.0.1:3990/studio/';
const OTHER_WINDOW = 'http://127.0.0.1:3991/studio/';
const DESKTOP_LOG = '/home/someone/.config/OpenLDR Desktop/desktop.log';

/** A launcher the fake startLauncher made. Tests drive its events and its exit. */
interface FakeLauncher {
  port: number;
  share: { port: number } | undefined;
  on: { event(e: LauncherEvent): void; stderrLine(line: string): void };
  exited: Promise<number | null>;
  exit(code: number | null): void;
  /** The controller must never reach for this. */
  kill: ReturnType<typeof vi.fn>;
}

const everyLauncher: FakeLauncher[] = [];

afterEach(() => {
  for (const l of everyLauncher.splice(0)) expect(l.kill).not.toHaveBeenCalled();
});

/** Lets every pending promise and immediate run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

interface Options {
  /** Answers to readStatus, in order. The last one repeats. */
  statuses?: Status[];
  /** A readStatus of its own, for a test that holds it open. */
  readStatus?: () => Promise<Status>;
  answers?: (address: string) => Promise<boolean>;
  requestStop?: (h: Harness) => Promise<number>;
  choosePort?: (remembered: number | undefined) => Promise<{ port: number; remember: boolean }>;
  fixedPort?: number;
  settings?: Settings;
  pollMs?: number;
  stopWaitMs?: number;
}

interface Harness {
  controller: DesktopController;
  deps: ControllerDeps;
  shown: Screen[];
  logs: string[];
  exits: number[];
  saved: Settings[];
  launchers: FakeLauncher[];
  sleeps: number[];
  stops: () => number;
  statusReads: () => number;
  /** The order of show and readStatus calls. */
  calls: string[];
  /** Resolves every pending sleep, then lets the controller run. */
  tick(): Promise<void>;
  last(): Screen | undefined;
}

function harness(o: Options = {}): Harness {
  const shown: Screen[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const saved: Settings[] = [];
  const launchers: FakeLauncher[] = [];
  const sleeps: number[] = [];
  const calls: string[] = [];
  let pending: Array<() => void> = [];
  let stops = 0;
  let reads = 0;
  const statuses = [...(o.statuses ?? [{ running: false, dataDir: DATA }])];

  const h = {} as Harness;
  const deps: ControllerDeps = {
    readStatus: async () => {
      reads++;
      calls.push('readStatus');
      if (o.readStatus) return o.readStatus();
      return statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    },
    startLauncher: (port, on, share) => {
      let resolveExit!: (code: number | null) => void;
      const l: FakeLauncher = {
        port,
        share,
        on,
        exited: new Promise((r) => (resolveExit = r)),
        exit: (code) => resolveExit(code),
        kill: vi.fn(),
      };
      launchers.push(l);
      everyLauncher.push(l);
      return l;
    },
    requestStop: async () => {
      stops++;
      return o.requestStop ? o.requestStop(h) : 0;
    },
    answers: o.answers ?? (async () => true),
    sleep: (ms) =>
      new Promise<void>((r) => {
        sleeps.push(ms);
        pending.push(r);
      }),
    choosePort: o.choosePort ?? (async (remembered) => ({ port: remembered ?? 3000, remember: false })),
    loadSettings: () => o.settings ?? { startAtSignIn: false },
    saveSettings: (s) => saved.push(s),
    show: (s) => {
      calls.push(`show:${s.screen}`);
      shown.push(s);
    },
    exit: (code) => exits.push(code),
    log: (line) => logs.push(line),
    desktopLog: DESKTOP_LOG,
    strings,
    ...(o.fixedPort !== undefined ? { fixedPort: o.fixedPort } : {}),
    ...(o.pollMs !== undefined ? { pollMs: o.pollMs } : {}),
    ...(o.stopWaitMs !== undefined ? { stopWaitMs: o.stopWaitMs } : {}),
  };
  Object.assign(h, {
    controller: new DesktopController(deps),
    deps,
    shown,
    logs,
    exits,
    saved,
    launchers,
    sleeps,
    calls,
    stops: () => stops,
    statusReads: () => reads,
    tick: async () => {
      const now = pending;
      pending = [];
      for (const r of now) r();
      await settle();
    },
    last: () => shown[shown.length - 1],
  });
  return h;
}

/** Starts the controller on a free data folder and returns the launcher it started. */
async function started(h: Harness): Promise<FakeLauncher> {
  void h.controller.start();
  await settle();
  const l = h.launchers[h.launchers.length - 1];
  if (!l) throw new Error('no launcher was started');
  return l;
}

async function ready(h: Harness): Promise<FakeLauncher> {
  const l = await started(h);
  l.on.event({ event: 'starting', step: 'postgres' });
  l.on.event({ event: 'starting', step: 'server' });
  l.on.event({ event: 'ready', address: OWN });
  await settle();
  return l;
}

const runningStatus = (host?: string): Status => ({
  running: true,
  address: OTHER,
  dataDir: DATA,
  ...(host !== undefined ? { host } : {}),
});

describe('pageState', () => {
  it('gives the pin screen its words for each purpose, and the wrong and too short lines', () => {
    const set = pageState({ screen: 'pin', purpose: 'set' }, strings);
    expect(set).toEqual({
      title: strings.pinSetTitle,
      message: strings.pinSetMessage,
      input: { label: strings.pinLabel, value: '', placeholder: '', secret: true },
      actions: [{ id: 'pin-submit', label: strings.pinSetAction, primary: true }, { id: 'pin-cancel', label: strings.pinCancel }],
    });
    const unlock = pageState({ screen: 'pin', purpose: 'unlock' }, strings);
    expect(unlock.title).toBe(strings.pinUnlockTitle);
    expect(unlock.message).toBeUndefined();
    expect(unlock.actions?.[0]).toEqual({ id: 'pin-submit', label: strings.pinUnlockAction, primary: true });
    const quit = pageState({ screen: 'pin', purpose: 'quit' }, strings);
    expect(quit.title).toBe(strings.pinQuitTitle);
    expect(quit.message).toBe(strings.pinQuitMessage);
    expect(quit.actions?.[0]).toEqual({ id: 'pin-submit', label: strings.pinQuitAction, primary: true });
    expect(pageState({ screen: 'pin', purpose: 'unlock', wrong: true }, strings).problem).toBe(strings.pinWrong);
    expect(pageState({ screen: 'pin', purpose: 'set', tooShort: true }, strings).problem).toBe(strings.pinTooShort);
    expect(pageState({ screen: 'pin', purpose: 'unlock' }, strings).problem).toBeUndefined();
    // The PIN is never sent back to the page.
    expect(pageState({ screen: 'pin', purpose: 'unlock', wrong: true }, strings).input?.value).toBe('');
  });

  it('gives the starting title and the note for each step', () => {
    expect(pageState({ screen: 'starting', note: 'checking' }, strings)).toEqual({
      title: strings.startingTitle,
      note: strings.checkingNote,
    });
    expect(pageState({ screen: 'starting', note: 'postgres' }, strings).note).toBe(strings.postgresNote);
    expect(pageState({ screen: 'starting', note: 'recovering' }, strings).note).toBe(strings.recoveringNote);
    expect(pageState({ screen: 'starting', note: 'server' }, strings).note).toBe(strings.serverNote);
  });

  it('gives the stopping title and note', () => {
    expect(pageState({ screen: 'stopping' }, strings)).toEqual({ title: strings.stoppingTitle, note: strings.stoppingNote });
  });

  it('gives the error title, the message, the log paths and the retry label', () => {
    expect(
      pageState(
        { screen: 'error', message: 'It broke.', serverLog: '/d/logs/server.log', postgresLog: '/d/logs/postgres.log', desktopLog: '/u/desktop.log' },
        strings,
      ),
    ).toEqual({
      title: strings.errorTitle,
      message: 'It broke.',
      note: strings.logsLabel,
      logs: ['/d/logs/server.log', '/d/logs/postgres.log', '/u/desktop.log'],
      retryLabel: strings.retryLabel,
    });
  });

  it('leaves the log lines out of an error with no log paths', () => {
    expect(pageState({ screen: 'error', message: 'It broke.' }, strings)).toEqual({
      title: strings.errorTitle,
      message: 'It broke.',
      retryLabel: strings.retryLabel,
    });
  });

  it('uses the words it is given', () => {
    expect(pageState({ screen: 'stopping' }, STRINGS.fr).title).toBe(STRINGS.fr.stoppingTitle);
  });
});

describe('DesktopController', () => {
  it('1. shows the checking page, then reads the status', async () => {
    const h = harness();
    void h.controller.start();
    await settle();
    expect(h.shown[0]).toEqual({ screen: 'starting', note: 'checking' });
    expect(h.calls.slice(0, 2)).toEqual(['show:starting', 'readStatus']);
  });

  it('2. attaches to a running launcher, waits until it answers, then shows Studio', async () => {
    const answers = [false, false, true];
    const asked: string[] = [];
    const h = harness({
      statuses: [runningStatus('127.0.0.1')],
      answers: async (a) => {
        asked.push(a);
        return answers.shift() ?? true;
      },
    });
    void h.controller.start();
    await settle();
    expect(h.launchers).toHaveLength(0);
    expect(h.controller.attached()).toBe(true);
    expect(h.last()).toEqual({ screen: 'starting', note: 'server' });
    expect(h.sleeps).toContain(1000);
    await h.tick();
    expect(h.last()).toEqual({ screen: 'starting', note: 'server' });
    await h.tick();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((a) => a === OTHER_WINDOW)).toBe(true);
    expect(h.controller.address()).toBe(OTHER_WINDOW);
    expect(h.controller.dataDir()).toBe(DATA);
  });

  it('2a. checks an attached launcher every pollMs, shows an error when it has gone, and starts over on retry', async () => {
    let up = true;
    const h = harness({
      statuses: [runningStatus('127.0.0.1'), runningStatus('127.0.0.1'), { running: false, dataDir: DATA }, runningStatus('127.0.0.1')],
      answers: async () => up,
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    expect(h.sleeps.filter((ms) => ms !== 30_000)).toEqual([5000]);
    up = false;
    await h.tick();
    expect(h.statusReads()).toBe(2);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    await h.tick();
    expect(h.statusReads()).toBe(3);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.launcherGone });
    expect(h.controller.address()).toBeUndefined();

    up = true;
    void h.controller.retry();
    await settle();
    expect(h.shown).toContainEqual({ screen: 'starting', note: 'checking' });
    expect(h.statusReads()).toBe(4);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
  });

  it('A8. the poll of an attached launcher that answers starts no status child', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')] });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    expect(h.statusReads()).toBe(1);
    for (let i = 0; i < 4; i++) await h.tick();
    expect(h.sleeps.filter((ms) => ms === 5000).length).toBeGreaterThanOrEqual(4);
    expect(h.statusReads()).toBe(1);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
  });

  it('A8. the poll reads the status once the address stops answering, and shows the error when it has gone', async () => {
    let up = true;
    const h = harness({ statuses: [runningStatus('127.0.0.1'), { running: false, dataDir: DATA }], answers: async () => up });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    up = false;
    await h.tick();
    expect(h.statusReads()).toBe(2);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.launcherGone });
  });

  it('2a. uses the given pollMs', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')], pollMs: 250 });
    void h.controller.start();
    await settle();
    expect(h.sleeps.filter((ms) => ms !== 30_000)).toEqual([250]);
  });

  it('2a. stops checking an attached launcher on quit', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')] });
    void h.controller.start();
    await settle();
    await h.tick();
    const reads = h.statusReads();
    void h.controller.quit();
    await settle();
    await h.tick();
    await h.tick();
    expect(h.statusReads()).toBe(reads);
  });

  it('2a. shows an error when an attached launcher goes before it ever answers', async () => {
    const h = harness({
      statuses: [runningStatus('127.0.0.1'), { running: false, dataDir: DATA }],
      answers: async () => false,
      pollMs: 3000,
    });
    void h.controller.start();
    await settle();
    for (let i = 0; i < 3; i++) await h.tick();
    expect(h.statusReads()).toBe(2);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.launcherGone });
  });

  describe('2b. bridgeAddress', () => {
    it('is the address of a launcher this app started', async () => {
      const h = harness();
      await ready(h);
      expect(h.controller.attached()).toBe(false);
      expect(h.controller.bridgeAddress()).toBe(OWN_WINDOW);
    });

    it.each([
      ['127.0.0.1', OTHER_WINDOW],
      ['::1', 'http://[::1]:3991/studio/'],
      ['localhost', OTHER],
    ])('is undefined for an attached launcher on %s, which the app still shows', async (host, shown) => {
      const h = harness({ statuses: [runningStatus(host)] });
      void h.controller.start();
      await settle();
      expect(h.controller.attached()).toBe(true);
      expect(h.last()).toEqual({ screen: 'studio', address: shown });
      expect(h.controller.address()).toBe(shown);
      expect(h.controller.bridgeAddress()).toBeUndefined();
    });

    it('is undefined for an attached launcher on 0.0.0.0', async () => {
      const h = harness({ statuses: [runningStatus('0.0.0.0')] });
      void h.controller.start();
      await settle();
      expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
      expect(h.controller.bridgeAddress()).toBeUndefined();
    });

    it('is undefined for an attached launcher whose status names no host', async () => {
      const h = harness({ statuses: [runningStatus()] });
      void h.controller.start();
      await settle();
      expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
      expect(h.controller.bridgeAddress()).toBeUndefined();
    });

    it('is undefined before anything is ready', () => {
      expect(harness().controller.bridgeAddress()).toBeUndefined();
    });
  });

  it('3. shows the busy line as it is, and reads the status again on retry', async () => {
    const busy = 'OpenLDR is not running. A recovery command holds the data folder (process 42).';
    const h = harness({ statuses: [{ running: false, dataDir: DATA, busy }, { running: false, dataDir: DATA }] });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'error', message: busy });
    expect(h.launchers).toHaveLength(0);
    void h.controller.retry();
    await settle();
    expect(h.statusReads()).toBe(2);
    expect(h.launchers).toHaveLength(1);
  });

  describe('4. the port', () => {
    it('uses fixedPort when it is set and remembers nothing', async () => {
      const choosePort = vi.fn(async () => ({ port: 4100, remember: true }));
      const h = harness({ fixedPort: 3990, choosePort });
      await started(h);
      expect(choosePort).not.toHaveBeenCalled();
      expect(h.launchers[0]!.port).toBe(3990);
      expect(h.saved).toEqual([]);
    });

    it('asks choosePort with the remembered port and saves a new one, keeping the other fields', async () => {
      const choosePort = vi.fn(async () => ({ port: 4100, remember: true }));
      const settings: Settings = { port: 4000, startAtSignIn: true, window: { width: 1000, height: 700 } };
      const h = harness({ choosePort, settings });
      await started(h);
      expect(choosePort).toHaveBeenCalledWith(4000);
      expect(h.saved).toEqual([{ port: 4100, startAtSignIn: true, window: { width: 1000, height: 700 } }]);
      expect(h.launchers[0]!.port).toBe(4100);
    });

    it('saves nothing when choosePort says not to remember', async () => {
      const h = harness({ choosePort: async () => ({ port: 3000, remember: false }) });
      await started(h);
      expect(h.saved).toEqual([]);
      expect(h.launchers[0]!.port).toBe(3000);
    });
  });

  it('5. moves the screen with the events, and shows Studio at the ready address', async () => {
    const h = harness();
    const l = await started(h);
    l.on.event({ event: 'starting', step: 'postgres' });
    expect(h.last()).toEqual({ screen: 'starting', note: 'postgres' });
    l.on.event({ event: 'recovering' });
    expect(h.last()).toEqual({ screen: 'starting', note: 'recovering' });
    l.on.event({ event: 'starting', step: 'server' });
    expect(h.last()).toEqual({ screen: 'starting', note: 'server' });
    expect(h.controller.address()).toBeUndefined();
    l.on.event({ event: 'ready', address: OWN });
    expect(h.last()).toEqual({ screen: 'studio', address: OWN_WINDOW });
    expect(h.controller.address()).toBe(OWN_WINDOW);
    expect(h.controller.attached()).toBe(false);
  });

  it('ruling 1. never shows Studio for a launcher that said it is stopping', async () => {
    const h = harness();
    const l = await started(h);
    l.on.event({ event: 'stopping' });
    l.on.event({ event: 'starting', step: 'server' });
    l.on.event({ event: 'ready', address: OWN });
    await settle();
    expect(h.shown.some((s) => s.screen === 'studio')).toBe(false);
    expect(h.shown).not.toContainEqual({ screen: 'starting', note: 'server' });
    expect(h.controller.address()).toBeUndefined();
  });

  it('ruling 1. never shows Studio for a ready that comes after a quit began and before stopping', async () => {
    const h = harness();
    const l = await started(h);
    l.on.event({ event: 'starting', step: 'server' });
    void h.controller.quit();
    await settle();
    expect(h.stops()).toBe(1);
    l.on.event({ event: 'ready', address: OWN });
    await settle();
    expect(h.shown.some((s) => s.screen === 'studio')).toBe(false);
    expect(h.last()).toEqual({ screen: 'stopping' });
    l.on.event({ event: 'stopping' });
    l.exit(0);
    await settle();
    expect(h.exits).toEqual([0]);
  });

  describe('6. the launcher ends by itself', () => {
    const logs = { serverLog: join(DATA, 'logs', 'server.log'), postgresLog: join(DATA, 'logs', 'postgres.log'), desktopLog: DESKTOP_LOG };

    it('shows the last error event, with the log paths', async () => {
      const h = harness();
      const l = await started(h);
      l.on.stderrLine('a line');
      l.on.event({ event: 'error', message: 'Port 3990 is taken.' });
      l.on.stderrLine('a later line');
      l.exit(1);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: 'Port 3990 is taken.', ...logs });
      expect(h.exits).toEqual([]);
    });

    it('shows the last standard error line when there was no error event', async () => {
      const h = harness();
      const l = await started(h);
      l.on.stderrLine('first');
      l.on.stderrLine('OpenLDR stopped after an error.');
      l.exit(1);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: 'OpenLDR stopped after an error.', ...logs });
    });

    it('ruling 2. shows a plain line when a launcher that was ready ends with no event and no line', async () => {
      const h = harness();
      const l = await ready(h);
      l.exit(null);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: strings.launcherEnded, ...logs });
      expect(h.controller.address()).toBeUndefined();
    });

    it('names only the app\'s own log when the data folder is not known', async () => {
      const h = harness({ statuses: [{ running: false }] });
      const l = await started(h);
      l.exit(1);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: strings.launcherEnded, desktopLog: DESKTOP_LOG });
      expect(h.controller.dataDir()).toBeUndefined();
    });

    it('ends a failed start (stopping, then error, then the exit) on the error screen, not as a quit', async () => {
      const h = harness();
      const l = await started(h);
      l.on.event({ event: 'starting', step: 'postgres' });
      l.on.event({ event: 'stopping' });
      l.on.event({ event: 'error', message: 'Postgres did not start.' });
      l.exit(1);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: 'Postgres did not start.', ...logs });
      expect(h.exits).toEqual([]);
      expect(h.stops()).toBe(0);
    });

    it('A7. says plainly that OpenLDR has stopped when the launcher was stopped from elsewhere, not that it stopped unexpectedly', async () => {
      const h = harness();
      const l = await ready(h);
      l.on.event({ event: 'stopping' });
      l.on.event({ event: 'stopped', result: 'clean' });
      l.exit(0);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: strings.launcherGone, ...logs });
      expect(h.exits).toEqual([]);
      expect(h.stops()).toBe(0);
    });

    it('A6. the error screen names the app\'s own log', async () => {
      const h = harness();
      const l = await started(h);
      l.exit(1);
      await settle();
      expect(h.last()).toMatchObject({ screen: 'error', desktopLog: DESKTOP_LOG });
      const state = pageState(h.last() as Exclude<Screen, { screen: 'studio' }>, strings);
      expect(state.logs).toEqual([logs.serverLog, logs.postgresLog, DESKTOP_LOG]);
    });

    it('starts again from the status on retry', async () => {
      const h = harness();
      const l = await started(h);
      l.exit(1);
      await settle();
      void h.controller.retry();
      await settle();
      expect(h.statusReads()).toBe(2);
      expect(h.shown.filter((s) => s.screen === 'starting' && s.note === 'checking')).toHaveLength(2);
      expect(h.launchers).toHaveLength(2);
    });

    it('does nothing on retry while not on the error screen', async () => {
      const h = harness();
      await ready(h);
      void h.controller.retry();
      await settle();
      expect(h.statusReads()).toBe(1);
      expect(h.launchers).toHaveLength(1);
    });
  });

  it('7. quit once ready: shows stopping, asks to stop once, waits for the exit, then exits 0', async () => {
    const h = harness();
    const l = await ready(h);
    void h.controller.quit();
    await settle();
    expect(h.last()).toEqual({ screen: 'stopping' });
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([]);
    l.on.event({ event: 'stopped', result: 'clean' });
    l.exit(0);
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([0]);
    expect(h.shown.some((s) => s.screen === 'error')).toBe(false);
  });

  it('7a. quit while starting: asks again each second until the launcher exits', async () => {
    const h = harness({
      requestStop: async (hh) => {
        if (hh.stops() === 3) hh.launchers[0]!.exit(0);
        return 0;
      },
    });
    await started(h);
    void h.controller.quit();
    await settle();
    for (let i = 0; i < 5; i++) await h.tick();
    expect(h.stops()).toBe(3);
    expect(h.sleeps.filter((ms) => ms === 1000).length).toBeGreaterThanOrEqual(2);
    expect(h.exits).toEqual([0]);
  });

  it('7a. quit while starting gives up after stopWaitMs and exits 1', async () => {
    const h = harness({ stopWaitMs: 3000 });
    await started(h);
    void h.controller.quit();
    await settle();
    for (let i = 0; i < 6; i++) await h.tick();
    expect(h.stops()).toBe(3);
    expect(h.exits).toEqual([1]);
  });

  it('7a. stops asking once the launcher says it is stopping, and waits for its exit', async () => {
    const h = harness();
    const l = await started(h);
    l.on.event({ event: 'stopping' });
    void h.controller.quit();
    await settle();
    expect(h.stops()).toBe(1);
    l.exit(0);
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('8. quit when attached: shows stopping, asks to stop, then exits 0', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')] });
    void h.controller.start();
    await settle();
    void h.controller.quit();
    await settle();
    expect(h.shown).toContainEqual({ screen: 'stopping' });
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  it('8. quit when attached exits 1 when the stop fails', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')], requestStop: async () => 1 });
    void h.controller.start();
    await settle();
    await h.controller.quit();
    expect(h.exits).toEqual([1]);
  });

  describe('9. quit when nothing runs', () => {
    it('exits 0 from the error screen without asking to stop', async () => {
      const h = harness({ statuses: [{ running: false, dataDir: DATA, busy: 'OpenLDR is not running. Busy.' }] });
      void h.controller.start();
      await settle();
      await h.controller.quit();
      expect(h.stops()).toBe(0);
      expect(h.exits).toEqual([0]);
    });

    it('exits 0 after the launcher ended by itself, without asking to stop', async () => {
      const h = harness();
      const l = await started(h);
      l.exit(1);
      await settle();
      await h.controller.quit();
      expect(h.stops()).toBe(0);
      expect(h.exits).toEqual([0]);
    });

    it('exits 0 while still checking, and starts nothing after', async () => {
      let answer!: (s: Status) => void;
      const h = harness({ readStatus: () => new Promise((r) => (answer = r)) });
      void h.controller.start();
      await settle();
      await h.controller.quit();
      expect(h.stops()).toBe(0);
      expect(h.exits).toEqual([0]);
      answer({ running: false, dataDir: DATA });
      await settle();
      expect(h.launchers).toHaveLength(0);
      expect(h.exits).toEqual([0]);
    });
  });

  it('10. quit twice asks to stop once and exits once', async () => {
    const h = harness();
    const l = await ready(h);
    const first = h.controller.quit();
    const second = h.controller.quit();
    await settle();
    l.exit(0);
    await Promise.all([first, second]);
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([0]);
  });

  describe('11. a stop that fails', () => {
    it('exits 1 when stop gives a non-zero code, and leaves the launcher running', async () => {
      const h = harness({ requestStop: async () => 1 });
      const l = await ready(h);
      await h.controller.quit();
      expect(h.exits).toEqual([1]);
      expect(l.kill).not.toHaveBeenCalled();
    });

    it('exits 1 when the launcher has not exited after stopWaitMs', async () => {
      const h = harness({ stopWaitMs: 90_000 });
      const l = await ready(h);
      void h.controller.quit();
      await settle();
      expect(h.exits).toEqual([]);
      expect(h.sleeps).toContain(90_000);
      await h.tick();
      expect(h.exits).toEqual([1]);
      expect(h.stops()).toBe(1);
      expect(l.kill).not.toHaveBeenCalled();
    });

    it('waits 90 s by default', async () => {
      const h = harness();
      await ready(h);
      void h.controller.quit();
      await settle();
      expect(h.sleeps).toContain(90_000);
    });
  });

  it('12. never logs or shows a line that names the setup code', async () => {
    const secret = 'K7QX-PLANTED-9F2M';
    const h = harness();
    const l = await started(h);
    l.on.stderrLine(`No administrator exists yet. Open the address and enter this setup code: ${secret}`);
    l.exit(1);
    await settle();
    const everything = JSON.stringify(h.shown) + h.logs.join('\n');
    expect(everything).not.toContain(secret);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.lineHidden });
    expect(h.logs.some((line) => line.includes(strings.lineHidden))).toBe(true);
  });

  it('12. hides an error event that names the setup code too', async () => {
    const secret = 'Z3RT-PLANTED-4H8N';
    const h = harness();
    const l = await started(h);
    l.on.event({ event: 'error', message: `The Setup Code ${secret} could not be made.` });
    l.exit(1);
    await settle();
    expect(JSON.stringify(h.shown) + h.logs.join('\n')).not.toContain(secret);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.lineHidden });
  });

  it('logs the events, the standard error lines and the exit code', async () => {
    const h = harness();
    const l = await ready(h);
    l.on.stderrLine('a warning');
    l.exit(3);
    await settle();
    const all = h.logs.join('\n');
    expect(all).toContain('"event":"ready"');
    expect(all).toContain('a warning');
    expect(h.logs).toContain('The launcher exited with code 3.');
  });

  it('a status that has not answered after 30 s shows the error screen, and a retry does not stack a second one', async () => {
    let reads = 0;
    const h = harness({
      readStatus: () => {
        reads++;
        return new Promise<Status>(() => {});
      },
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'starting', note: 'checking' });
    expect(h.sleeps).toEqual([30_000]);
    await h.tick();
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.statusNoAnswer });
    expect(h.launchers).toHaveLength(0);
    void h.controller.retry();
    await settle();
    expect(h.last()).toEqual({ screen: 'starting', note: 'checking' });
    expect(reads).toBe(1);
  });

  it('a status that has not answered while attached shows the error screen', async () => {
    let reads = 0;
    let asks = 0;
    const h = harness({
      readStatus: () => (++reads === 1 ? Promise.resolve(runningStatus('127.0.0.1')) : new Promise<Status>(() => {})),
      answers: async () => ++asks === 1,
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    await h.tick();
    expect(reads).toBe(2);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    await h.tick();
    expect(reads).toBe(2);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.statusNoAnswer });
  });

  it('starts the launcher even when the settings cannot be saved, and logs one line', async () => {
    const h = harness({ choosePort: async () => ({ port: 4100, remember: true }) });
    h.deps.saveSettings = () => {
      throw new Error('EACCES: permission denied');
    };
    await started(h);
    expect(h.launchers[0]!.port).toBe(4100);
    expect(h.logs.filter((l) => l.includes('could not be saved'))).toHaveLength(1);
  });

  it('shows an error when choosing a port fails', async () => {
    const h = harness({
      choosePort: async () => {
        throw new Error('The system gave no port.');
      },
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toMatchObject({ screen: 'error', message: 'The system gave no port.' });
    expect(h.launchers).toHaveLength(0);
  });
});

describe('sharing on the lab network', () => {
  const share = { addresses: ['https://labpc:3443/studio/'], fingerprint: 'AB:CD', certFile: '/d/share/cert.pem' };
  /** A stop that the launcher obeys: it says it is stopping, then stopped, then exits. */
  const obeys = async (h: Harness): Promise<number> => {
    const l = h.launchers[h.launchers.length - 1]!;
    l.on.event({ event: 'stopping' });
    l.on.event({ event: 'stopped', result: 'clean' });
    l.exit(0);
    return 0;
  };

  it('starts the launcher with the default share port when the setting is on', async () => {
    const h = harness({ settings: { startAtSignIn: false, shareOnNetwork: true } });
    expect((await started(h)).share).toEqual({ port: 3443 });
  });

  it('uses the share port from the settings', async () => {
    const h = harness({ settings: { startAtSignIn: false, shareOnNetwork: true, sharePort: 8443 } });
    expect((await started(h)).share).toEqual({ port: 8443 });
  });

  it('passes no share when the setting is off, whatever the share port', async () => {
    const h = harness({ settings: { startAtSignIn: false, sharePort: 8443 } });
    expect((await started(h)).share).toBeUndefined();
  });

  it('reports the share from the ready event, and none before it', async () => {
    const h = harness({ settings: { startAtSignIn: false, shareOnNetwork: true } });
    const l = await started(h);
    expect(h.controller.share()).toBeUndefined();
    l.on.event({ event: 'ready', address: OWN, share });
    await settle();
    expect(h.controller.share()).toEqual(share);
  });

  it('reports the share of a launcher it attached to', async () => {
    const h = harness({ statuses: [{ ...runningStatus('127.0.0.1'), share } as Status] });
    void h.controller.start();
    await settle();
    expect(h.controller.share()).toEqual(share);
  });

  it('forgets the share when the launcher ends', async () => {
    const h = harness({ settings: { startAtSignIn: false, shareOnNetwork: true } });
    const l = await started(h);
    l.on.event({ event: 'ready', address: OWN, share });
    l.exit(null);
    await settle();
    expect(h.controller.share()).toBeUndefined();
  });

  it('restart stops its own launcher and starts again, with no error screen', async () => {
    const h = harness({ requestStop: obeys });
    await ready(h);
    h.shown.length = 0;
    const done = h.controller.restart();
    await settle();
    expect(await done).toBe(true);
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.launchers).toHaveLength(2);
    expect(h.shown.map((x) => x.screen)).not.toContain('error');
    expect(h.shown[0]).toEqual({ screen: 'stopping' });
    expect(h.exits).toEqual([]);
    h.launchers[1]!.on.event({ event: 'ready', address: OWN_WINDOW });
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OWN_WINDOW });
  });

  it('restart reads the settings again, so the new launcher gets the new share', async () => {
    let settings: Settings = { startAtSignIn: false };
    const h = harness({ requestStop: obeys });
    h.deps.loadSettings = () => settings;
    await ready(h);
    expect(h.launchers[0]!.share).toBeUndefined();
    settings = { startAtSignIn: false, shareOnNetwork: true };
    await h.controller.restart();
    await settle();
    expect(h.launchers[1]!.share).toEqual({ port: 3443 });
  });

  it('restart returns false when attached to a launcher it did not start', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1')] });
    void h.controller.start();
    await settle();
    expect(await h.controller.restart()).toBe(false);
    expect(h.stops()).toBe(0);
  });

  it('restart returns false while starting', async () => {
    const h = harness();
    await started(h);
    expect(await h.controller.restart()).toBe(false);
    expect(h.stops()).toBe(0);
  });

  it('a second restart during a restart returns false', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const h = harness({
      requestStop: async (hh) => {
        await held;
        return obeys(hh);
      },
    });
    await ready(h);
    const first = h.controller.restart();
    await settle();
    expect(await h.controller.restart()).toBe(false);
    release();
    expect(await first).toBe(true);
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.launchers).toHaveLength(2);
  });

  it('restart starts no second launcher when the first did not stop, and shows the error', async () => {
    const h = harness({ requestStop: async () => 1, stopWaitMs: 2000 });
    await ready(h);
    const done = h.controller.restart();
    await settle();
    expect(await done).toBe(true);
    await settle();
    expect(h.launchers).toHaveLength(1);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.shareRestartFailed });
  });

  it('restart does nothing once a quit has begun', async () => {
    const h = harness({ requestStop: obeys });
    await ready(h);
    void h.controller.quit();
    expect(await h.controller.restart()).toBe(false);
    await settle();
    expect(h.launchers).toHaveLength(1);
    expect(h.exits).toEqual([0]);
  });

  it('refreshes the share of an attached launcher once it answers', async () => {
    // The launcher's lock is live before its HTTPS front is up, so the first status has no share.
    let up = false;
    const h = harness({
      statuses: [runningStatus('127.0.0.1'), { ...runningStatus('127.0.0.1'), share } as Status],
      answers: async () => up,
    });
    void h.controller.start();
    await settle();
    expect(h.controller.share()).toBeUndefined();
    up = true;
    await h.tick();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    expect(h.controller.share()).toEqual(share);
  });

  it('takes the share from a later status read of an attached launcher', async () => {
    let up = true;
    const h = harness({
      statuses: [runningStatus('127.0.0.1'), { ...runningStatus('127.0.0.1'), share } as Status],
      answers: async () => up,
      pollMs: 1000,
    });
    void h.controller.start();
    await settle();
    expect(h.controller.share()).toBeUndefined();
    // The address stops answering for one poll, so the status is read again.
    up = false;
    await h.tick();
    expect(h.controller.share()).toEqual(share);
  });

  it('a quit during a restart shares the one stop, and exits by its result', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const h = harness({
      requestStop: async (hh) => {
        await held;
        return obeys(hh);
      },
    });
    await ready(h);
    const restarting = h.controller.restart();
    await settle();
    const quitting = h.controller.quit();
    await settle();
    // One stop was asked for, not two. The quit waits for it.
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([]);
    release();
    await restarting;
    await quitting;
    await settle();
    expect(h.stops()).toBe(1);
    expect(h.exits).toEqual([0]);
    expect(h.launchers).toHaveLength(1);
  });

  it('after a restart that could not stop the launcher, a quit still stops that launcher', async () => {
    let obey = false;
    const h = harness({ requestStop: async (hh) => (obey ? obeys(hh) : 1), stopWaitMs: 2000 });
    await ready(h);
    await h.controller.restart();
    await settle();
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.shareRestartFailed });
    obey = true;
    await h.controller.quit();
    await settle();
    // The launcher this app started is still its to stop: it asks again and waits for the exit.
    expect(h.stops()).toBe(2);
    expect(h.exits).toEqual([0]);
  });

  it('picks up a share that an attached launcher publishes after it already answers', async () => {
    // The server answers before the launcher has published its share. Nothing fails, so only a
    // status read on a slow timer can see it.
    const later = { ...share, fingerprint: 'EF:01' };
    const h = harness({
      statuses: [runningStatus('127.0.0.1'), { ...runningStatus('127.0.0.1'), share } as Status, { ...runningStatus('127.0.0.1'), share: later } as Status],
      pollMs: 1000,
    });
    const changes: Array<unknown> = [];
    h.deps.shareChanged = () => changes.push(h.controller.share());
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    expect(h.controller.share()).toBeUndefined();
    for (let i = 0; i < 5; i++) await h.tick();
    expect(h.controller.share()).toBeUndefined();
    expect(h.statusReads()).toBe(1);
    await h.tick();
    expect(h.statusReads()).toBe(2);
    expect(h.controller.share()).toEqual(share);
    expect(changes).toEqual([share]);
    // A launcher that replaced it on the same address, with another certificate.
    for (let i = 0; i < 6; i++) await h.tick();
    expect(h.controller.share()).toEqual(later);
    expect(changes).toEqual([share, later]);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
  });

  it('says so when the share of its own launcher comes and goes', async () => {
    const h = harness({ settings: { startAtSignIn: false, shareOnNetwork: true } });
    const changes: Array<unknown> = [];
    h.deps.shareChanged = () => changes.push(h.controller.share());
    const l = await started(h);
    l.on.event({ event: 'ready', address: OWN, share });
    await settle();
    l.exit(null);
    await settle();
    expect(changes).toEqual([share, undefined]);
  });

  it('does not say so when a status read gives the same share again', async () => {
    const withShare = { ...runningStatus('127.0.0.1'), share } as Status;
    const h = harness({ statuses: [withShare], pollMs: 1000 });
    const changes: Array<unknown> = [];
    h.deps.shareChanged = () => changes.push(h.controller.share());
    void h.controller.start();
    await settle();
    for (let i = 0; i < 12; i++) await h.tick();
    expect(changes).toEqual([share]);
  });

  it('keeps Studio when the slow status read for the share gets no answer, and tries again later', async () => {
    let reads = 0;
    let finish!: (s: Status) => void;
    const slow = new Promise<Status>((r) => (finish = r));
    const h = harness({
      pollMs: 1000,
      readStatus: () => {
        reads += 1;
        if (reads === 1) return Promise.resolve(runningStatus('127.0.0.1'));
        // The second read is slow: it outlasts its time limit. The third answers, with the share.
        if (reads === 2) return slow;
        return Promise.resolve({ ...runningStatus('127.0.0.1'), share } as Status);
      },
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    // Six polls bring the first refresh, which hangs. More ticks let its time limit pass.
    for (let i = 0; i < 9; i++) await h.tick();
    expect(h.shown.map((x) => x.screen)).not.toContain('error');
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER_WINDOW });
    // The slow status child ends at last. A read still in flight is reused, never stacked.
    finish(runningStatus('127.0.0.1'));
    for (let i = 0; i < 8; i++) await h.tick();
    expect(h.controller.share()).toEqual(share);
    expect(h.shown.map((x) => x.screen)).not.toContain('error');
  });

  it('still shows the error when the address stops answering and the launcher has gone', async () => {
    let up = true;
    const h = harness({ statuses: [runningStatus('127.0.0.1'), { running: false, dataDir: DATA }], answers: async () => up, pollMs: 1000 });
    void h.controller.start();
    await settle();
    up = false;
    await h.tick();
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.launcherGone });
  });
});

describe('pageState for the connect mode screens', () => {
  const FP = Array.from({ length: 32 }, () => 'AB').join(':');
  const SERVER = 'https://labpc:3443/studio/';

  it('gives the mode choice its two answers', () => {
    expect(pageState({ screen: 'choose' }, strings)).toEqual({
      title: 'How will this PC use OpenLDR?',
      message: "This PC holds the lab's data: OpenLDR and its database run here. Connect to the lab's server: this PC only shows OpenLDR from another PC.",
      actions: [{ id: 'choose-local', label: "This PC holds the lab's data" }, { id: 'choose-connect', label: "Connect to the lab's server" }],
    });
  });

  it('gives the connect screen its input, and Back only while no mode is saved', () => {
    expect(pageState({ screen: 'connect' }, strings)).toEqual({
      title: "Connect to the lab's server",
      input: { label: 'Server address', value: '', placeholder: 'labpc:3443' },
      actions: [{ id: 'connect', label: 'Connect', primary: true }, { id: 'back', label: 'Back' }],
    });
    expect(pageState({ screen: 'connect', value: 'labpc', fixed: true }, strings)).toEqual({
      title: "Connect to the lab's server",
      input: { label: 'Server address', value: 'labpc', placeholder: 'labpc:3443' },
      actions: [{ id: 'connect', label: 'Connect', primary: true }],
    });
  });

  it.each([
    ['empty', "Type the server's address."],
    ['not-https', 'The address must start with https.'],
    ['unreadable', 'That is not an address OpenLDR can use.'],
    ['no-answer', 'Nothing answered at that address. Check it and that the server is on.'],
    ['certificate', "The server's certificate could not be accepted. Check the address, or ask whoever looks after the server."],
    ['not-saved', 'The server could not be saved on this PC. Try again.'],
  ] as const)('says what is wrong on the connect screen for %s, and keeps what was typed', (problem, line) => {
    const state = pageState({ screen: 'connect', value: 'what was typed', problem }, strings);
    expect(state.problem).toBe(line);
    expect(state.input?.value).toBe('what was typed');
  });

  it('asks about a first certificate with "It matches" as the main answer', () => {
    expect(pageState({ screen: 'certificate', address: SERVER, fingerprint: FP, changed: false }, strings)).toEqual({
      title: "Check the server's certificate",
      message: `This is the first time this PC connects to ${SERVER}. Compare this fingerprint with the one shown on the server.`,
      detail: FP,
      actions: [{ id: 'trust', label: 'It matches', primary: true }, { id: 'no-trust', label: 'Cancel' }],
    });
  });

  it('asks about a changed certificate with Cancel as the main answer', () => {
    expect(pageState({ screen: 'certificate', address: SERVER, fingerprint: FP, changed: true }, strings)).toEqual({
      title: "The server's certificate has changed",
      message: `The certificate of ${SERVER} is not the one this PC accepted before. Compare this fingerprint with the one shown on the server. If you did not expect a change, stop here.`,
      detail: FP,
      actions: [{ id: 'trust', label: 'It matches' }, { id: 'no-trust', label: 'Cancel', primary: true }],
    });
  });

  it('says the server is not answering, with Try again and Change server', () => {
    expect(pageState({ screen: 'unreachable', address: SERVER }, strings)).toEqual({
      title: 'Cannot reach the server',
      message: `${SERVER} is not answering. OpenLDR will come back by itself when it does.`,
      actions: [{ id: 'retry', label: 'Try again', primary: true }, { id: 'change-server', label: 'Change server' }],
    });
  });

  it('puts the address into the words in French and Portuguese too', () => {
    for (const lang of ['fr', 'pt'] as const) {
      for (const screen of [
        { screen: 'certificate', address: SERVER, fingerprint: FP, changed: false },
        { screen: 'certificate', address: SERVER, fingerprint: FP, changed: true },
        { screen: 'unreachable', address: SERVER },
      ] as const) {
        const message = pageState(screen, STRINGS[lang]).message ?? '';
        expect(message).toContain(SERVER);
        expect(message).not.toContain('{address}');
      }
    }
  });
});
