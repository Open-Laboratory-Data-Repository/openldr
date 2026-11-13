import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopController, pageState, type ControllerDeps, type Screen } from './controller';
import type { LauncherEvent, Status } from './launcher';
import type { Settings } from './settings';
import { STRINGS } from './strings';

const strings = STRINGS.en;
const DATA = '/tmp/openldr d-é/data';
const OWN = 'http://localhost:3990/studio/';
const OTHER = 'http://localhost:3991/studio/';

/** A launcher the fake startLauncher made. Tests drive its events and its exit. */
interface FakeLauncher {
  port: number;
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
    startLauncher: (port, on) => {
      let resolveExit!: (code: number | null) => void;
      const l: FakeLauncher = {
        port,
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
    expect(pageState({ screen: 'error', message: 'It broke.', serverLog: '/d/logs/server.log', postgresLog: '/d/logs/postgres.log' }, strings)).toEqual({
      title: strings.errorTitle,
      message: 'It broke.',
      note: strings.logsLabel,
      logs: ['/d/logs/server.log', '/d/logs/postgres.log'],
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
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
    expect(asked.every((a) => a === OTHER)).toBe(true);
    expect(h.controller.address()).toBe(OTHER);
    expect(h.controller.dataDir()).toBe(DATA);
  });

  it('2a. checks an attached launcher every pollMs, shows an error when it has gone, and starts over on retry', async () => {
    const h = harness({ statuses: [runningStatus('127.0.0.1'), runningStatus('127.0.0.1'), { running: false, dataDir: DATA }, runningStatus('127.0.0.1')] });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
    expect(h.sleeps.filter((ms) => ms !== 30_000)).toEqual([5000]);
    await h.tick();
    expect(h.statusReads()).toBe(2);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
    await h.tick();
    expect(h.statusReads()).toBe(3);
    expect(h.last()).toMatchObject({ screen: 'error', message: strings.launcherGone });
    expect(h.controller.address()).toBeUndefined();

    void h.controller.retry();
    await settle();
    expect(h.shown).toContainEqual({ screen: 'starting', note: 'checking' });
    expect(h.statusReads()).toBe(4);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
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
      expect(h.controller.bridgeAddress()).toBe(OWN);
    });

    it.each(['127.0.0.1', 'localhost', '::1'])('is the address of an attached launcher on %s', async (host) => {
      const h = harness({ statuses: [runningStatus(host)] });
      void h.controller.start();
      await settle();
      expect(h.controller.bridgeAddress()).toBe(OTHER);
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
    expect(h.last()).toEqual({ screen: 'studio', address: OWN });
    expect(h.controller.address()).toBe(OWN);
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

  describe('6. the launcher ends by itself', () => {
    const logs = { serverLog: join(DATA, 'logs', 'server.log'), postgresLog: join(DATA, 'logs', 'postgres.log') };

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

    it('leaves the log paths out when the data folder is not known', async () => {
      const h = harness({ statuses: [{ running: false }] });
      const l = await started(h);
      l.exit(1);
      await settle();
      expect(h.last()).toEqual({ screen: 'error', message: strings.launcherEnded });
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
    expect(all).toContain('3');
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

  it('a status that has not answered while attached shows the error screen, with no second status on top', async () => {
    let reads = 0;
    const h = harness({
      readStatus: () => (++reads === 1 ? Promise.resolve(runningStatus('127.0.0.1')) : new Promise<Status>(() => {})),
    });
    void h.controller.start();
    await settle();
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
    await h.tick();
    expect(reads).toBe(2);
    expect(h.last()).toEqual({ screen: 'studio', address: OTHER });
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
