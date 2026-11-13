// What the app does with the launcher: find one already running or start one, follow its events,
// show the right screen, and stop it through `stop` on quit. Every decision lives here so a test
// can reach it; main.ts only wires Electron to it. The app never signals or kills the launcher.

import { join } from 'node:path';
import type { LauncherEvent, RunningLauncher, Status } from './launcher';
import { windowAddress } from './locality';
import type { Settings } from './settings';
import type { AppStrings } from './strings';

export type Screen =
  | { screen: 'starting'; note: 'checking' | 'postgres' | 'recovering' | 'server' }
  | { screen: 'studio'; address: string }
  | { screen: 'stopping' }
  | { screen: 'error'; message: string; serverLog?: string; postgresLog?: string; desktopLog?: string };

/** What main sends to the app's own page. The words are already in the person's language. */
export interface PageState {
  title: string;
  note?: string;
  message?: string;
  logs?: string[];
  retryLabel?: string;
}

const NOTES = {
  checking: 'checkingNote',
  postgres: 'postgresNote',
  recovering: 'recoveringNote',
  server: 'serverNote',
} as const;

export function pageState(screen: Exclude<Screen, { screen: 'studio' }>, strings: AppStrings): PageState {
  switch (screen.screen) {
    case 'starting':
      return { title: strings.startingTitle, note: strings[NOTES[screen.note]] };
    case 'stopping':
      return { title: strings.stoppingTitle, note: strings.stoppingNote };
    case 'error': {
      const logs = [screen.serverLog, screen.postgresLog, screen.desktopLog].filter((p): p is string => p !== undefined);
      return {
        title: strings.errorTitle,
        message: screen.message,
        ...(logs.length > 0 ? { note: strings.logsLabel, logs } : {}),
        retryLabel: strings.retryLabel,
      };
    }
  }
}

export interface ControllerDeps {
  readStatus(): Promise<Status>;
  startLauncher(port: number, on: { event(e: LauncherEvent): void; stderrLine(line: string): void }): RunningLauncher;
  requestStop(): Promise<number>;
  /** True once an HTTP request to the address gets any answer. */
  answers(address: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  /** How often an attached launcher is checked. Default 5 000. */
  pollMs?: number;
  choosePort(remembered: number | undefined): Promise<{ port: number; remember: boolean }>;
  /** OPENLDR_DESKTOP_PORT */
  fixedPort?: number;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  show(screen: Screen): void;
  exit(code: number): void;
  log(line: string): void;
  /** The app's own log file, named on the error screen. */
  desktopLog: string;
  strings: AppStrings;
  /** How long a quit waits for the launcher to end. Default 90 000. */
  stopWaitMs?: number;
}

/** A launcher this app started, and what it has said so far. */
interface Child {
  running: RunningLauncher;
  exited: boolean;
  /** Set once the exit has been handled, so the quit path can wait for it. */
  done: Promise<void>;
  ready: boolean;
  sawStopping: boolean;
  /** The launcher said `stopped`: something stopped it on purpose, such as `stop` from a terminal. */
  sawStopped: boolean;
  lastError?: string;
  lastStderr?: string;
}

/** How long to wait between asks while waiting for an attached launcher to answer, and between `stop` asks. */
const STEP_MS = 1000;
/** A line that names the setup code may hold one. It is replaced before it is kept or shown. */
const SECRET_LINE = /setup code/i;
/** The app always starts its launcher with `--host 127.0.0.1`. */
const OWN_HOST = '127.0.0.1';
/** A `status` child that has not answered by then counts as no answer for that round. It is not killed. */
const STATUS_WAIT_MS = 30_000;

export class DesktopController {
  private readonly deps: ControllerDeps;
  private readonly pollMs: number;
  private readonly stopWaitMs: number;
  /** Goes up on each start, so a loop from an earlier start sees that it is stale and ends. */
  private run = 0;
  private phase: 'idle' | 'checking' | 'own' | 'attached' | 'error' = 'idle';
  private child: Child | undefined;
  private addr: string | undefined;
  private dir: string | undefined;
  private quitting: Promise<void> | undefined;
  /** A `status` child that has not answered yet. The next read waits on it instead of starting another. */
  private pendingStatus: Promise<Status> | undefined;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.pollMs = deps.pollMs ?? 5_000;
    this.stopWaitMs = deps.stopWaitMs ?? 90_000;
  }

  /**
   * The address the window loads once OpenLDR is ready or attached to. A `localhost` address from
   * the launcher is turned into the IP literal it is bound to (see `windowAddress`).
   */
  address(): string | undefined {
    return this.addr;
  }

  /** The data folder, as `status --json` reported it. */
  dataDir(): string | undefined {
    return this.dir;
  }

  /** True when this app did not start the launcher it shows. */
  attached(): boolean {
    return this.phase === 'attached';
  }

  /**
   * The address Studio's requests may be answered for, or undefined. It is address() only when this
   * app started the launcher (always on 127.0.0.1). An attached launcher always gives undefined,
   * whatever its host: after an unclean stop another account may answer on the dead launcher's
   * control port. The app shows an attached launcher and answers nothing.
   */
  bridgeAddress(): string | undefined {
    if (this.addr === undefined || this.phase !== 'own') return undefined;
    return this.addr;
  }

  async start(): Promise<void> {
    if (this.quitting) return;
    const run = ++this.run;
    this.phase = 'checking';
    this.child = undefined;
    this.addr = undefined;
    this.show({ screen: 'starting', note: 'checking' });
    try {
      const status = await this.boundedStatus();
      if (this.stale(run)) return;
      if (status === undefined) return this.fail(this.deps.strings.statusNoAnswer);
      if (status.dataDir !== undefined) this.dir = status.dataDir;
      if (status.running) return await this.attach(run, status);
      if (status.busy !== undefined) return this.fail(status.busy, false);
      await this.launch(run);
    } catch (err) {
      if (this.stale(run)) return;
      const message = this.clean(err instanceof Error ? err.message : String(err));
      this.deps.log(`The app could not start OpenLDR: ${message}`);
      this.fail(message);
    }
  }

  /** Starts again from the status. Only from the error screen. */
  async retry(): Promise<void> {
    if (this.phase !== 'error' || this.quitting) return;
    await this.start();
  }

  quit(): Promise<void> {
    this.quitting ??= this.stopAndExit();
    return this.quitting;
  }

  // ------------------------------------------------------------------------------------------

  private stale(run: number): boolean {
    return run !== this.run || this.quitting !== undefined;
  }

  /**
   * The launcher's status, or undefined when it has not answered within STATUS_WAIT_MS. A read
   * that has not answered is reused, so a slow `status` child never has a second one stacked on it.
   */
  private async boundedStatus(): Promise<Status | undefined> {
    if (this.pendingStatus === undefined) {
      const read = this.deps.readStatus();
      this.pendingStatus = read;
      const clear = (): void => {
        if (this.pendingStatus === read) this.pendingStatus = undefined;
      };
      read.then(clear, clear);
    }
    const timedOut = Symbol('timed out');
    const result = await Promise.race([this.pendingStatus, this.deps.sleep(STATUS_WAIT_MS).then(() => timedOut)]);
    if (result !== timedOut) return result as Status;
    this.deps.log(`status gave no answer within ${STATUS_WAIT_MS / 1000} s.`);
    return undefined;
  }

  private show(screen: Screen): void {
    this.deps.show(screen);
  }

  /** A line from the launcher, with a line that names the setup code replaced. */
  private clean(line: string): string {
    return SECRET_LINE.test(line) ? this.deps.strings.lineHidden : line;
  }

  /** A settings file that cannot be written never stops the app. One line goes to the log. */
  private saveSettings(s: Settings): void {
    try {
      this.deps.saveSettings(s);
    } catch (err) {
      this.deps.log(`The settings could not be saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The error screen. Unless `withLogs` is false, the app's own log goes with it, and the
   * launcher's two logs too when the data folder is known.
   */
  private fail(message: string, withLogs = true): void {
    this.phase = 'error';
    this.addr = undefined;
    const dataLogs =
      withLogs && this.dir !== undefined
        ? { serverLog: join(this.dir, 'logs', 'server.log'), postgresLog: join(this.dir, 'logs', 'postgres.log') }
        : {};
    const logs = withLogs ? { ...dataLogs, desktopLog: this.deps.desktopLog } : {};
    this.show({ screen: 'error', message, ...logs });
  }

  /** Another launcher holds the data folder. Wait until it answers, then show it and keep checking it. */
  private async attach(run: number, status: Extract<Status, { running: true }>): Promise<void> {
    const address = windowAddress(status.address, status.host);
    this.phase = 'attached';
    this.addr = address;
    this.dir = status.dataDir;
    this.deps.log(`Attached to a launcher that was already running at ${address}.`);
    this.show({ screen: 'starting', note: 'server' });

    // Its lock is live before its server listens, so it may still be starting. Ask once a second,
    // and read its status every pollMs in case it ends before it ever answers.
    let waited = 0;
    while (!(await this.deps.answers(address))) {
      if (this.stale(run)) return;
      await this.deps.sleep(STEP_MS);
      if (this.stale(run)) return;
      waited += STEP_MS;
      if (waited >= this.pollMs) {
        waited = 0;
        if (!(await this.stillRunning(run))) return;
      }
    }
    if (this.stale(run)) return;
    this.show({ screen: 'studio', address });

    // An address that answers needs no `status` child. Only when it stops answering is the status read.
    for (;;) {
      await this.deps.sleep(this.pollMs);
      if (this.stale(run)) return;
      if (await this.deps.answers(address)) continue;
      if (this.stale(run)) return;
      if (!(await this.stillRunning(run))) return;
    }
  }

  /** Reads the status of an attached launcher. Shows the error screen and gives false once it has gone. */
  private async stillRunning(run: number): Promise<boolean> {
    const s = await this.boundedStatus();
    if (this.stale(run)) return false;
    if (s?.running) return true;
    if (s === undefined) {
      this.fail(this.deps.strings.statusNoAnswer);
      return false;
    }
    this.deps.log('The launcher this app was attached to is no longer running.');
    this.fail(this.deps.strings.launcherGone);
    return false;
  }

  private async launch(run: number): Promise<void> {
    let port: number;
    if (this.deps.fixedPort !== undefined) {
      port = this.deps.fixedPort;
    } else {
      const settings = this.deps.loadSettings();
      const chosen = await this.deps.choosePort(settings.port);
      if (this.stale(run)) return;
      port = chosen.port;
      if (chosen.remember) this.saveSettings({ ...settings, port });
    }

    this.phase = 'own';
    this.deps.log(`Starting the launcher on port ${port}.`);
    let child!: Child;
    const running = this.deps.startLauncher(port, {
      event: (e) => this.onEvent(run, child, e),
      stderrLine: (line) => {
        const kept = this.clean(line);
        child.lastStderr = kept;
        this.deps.log(`launcher: ${kept}`);
      },
    });
    child = { running, exited: false, done: Promise.resolve(), ready: false, sawStopping: false, sawStopped: false };
    child.done = running.exited.then((code) => this.onExit(run, child, code));
    this.child = child;
  }

  private onEvent(run: number, child: Child, e: LauncherEvent): void {
    const logged = e.event === 'error' ? { ...e, message: this.clean(e.message) } : e;
    this.deps.log(`event: ${JSON.stringify(logged)}`);
    if (logged.event === 'error') {
      child.lastError = logged.message;
      return;
    }
    if (logged.event === 'stopping') {
      child.sawStopping = true;
      if (!this.stale(run)) this.show({ screen: 'stopping' });
      return;
    }
    if (logged.event === 'stopped') {
      child.sawStopped = true;
      return;
    }
    // A launcher on its way down may still finish its start and say so. That is stale.
    if (child.sawStopping || this.stale(run)) return;
    switch (logged.event) {
      case 'starting':
        this.show({ screen: 'starting', note: logged.step });
        return;
      case 'recovering':
        this.show({ screen: 'starting', note: 'recovering' });
        return;
      case 'ready': {
        child.ready = true;
        const address = windowAddress(logged.address, OWN_HOST);
        this.addr = address;
        this.show({ screen: 'studio', address });
        return;
      }
    }
  }

  private onExit(run: number, child: Child, code: number | null): void {
    child.exited = true;
    this.deps.log(`The launcher exited with code ${String(code)}.`);
    if (this.stale(run)) return;
    // A launcher stopped on purpose (`stop` from a terminal) ends with `stopped`. That is not unexpected.
    if (child.sawStopped) return this.fail(this.deps.strings.launcherGone);
    this.fail(child.lastError ?? child.lastStderr ?? this.deps.strings.launcherEnded);
  }

  private async stopAndExit(): Promise<void> {
    const child = this.phase === 'own' ? this.child : undefined;
    if (child !== undefined && !child.exited) {
      this.show({ screen: 'stopping' });
      return this.deps.exit(await this.stopOwn(child));
    }
    if (this.phase === 'attached') {
      this.show({ screen: 'stopping' });
      const code = await this.deps.requestStop();
      this.deps.log(`stop exited with code ${code}.`);
      return this.deps.exit(code === 0 ? 0 : 1);
    }
    this.deps.exit(0);
  }

  /**
   * Stops a launcher this app started and gives the app's exit code. While the launcher has not
   * taken its lock, `stop` says "not running" with code 0, so until the launcher is ready or says
   * it is stopping, the stop is asked for again each second.
   */
  private async stopOwn(child: Child): Promise<number> {
    let waited = 0;
    for (;;) {
      const code = await this.deps.requestStop();
      this.deps.log(`stop exited with code ${code}.`);
      if (child.exited) return 0;
      if (code !== 0 && !child.sawStopping) return 1;
      if (child.ready || child.sawStopping) break;
      await Promise.race([child.done, this.deps.sleep(STEP_MS)]);
      if (child.exited) return 0;
      waited += STEP_MS;
      if (waited >= this.stopWaitMs) return 1;
    }
    await Promise.race([child.done, this.deps.sleep(this.stopWaitMs - waited)]);
    return child.exited ? 0 : 1;
  }
}
