// What the app does with the launcher: find one already running or start one, follow its events,
// show the right screen, and stop it through `stop` on quit. Every decision lives here so a test
// can reach it; main.ts only wires Electron to it. The app never signals or kills the launcher.

import { join } from 'node:path';
import type { LauncherEvent, RunningLauncher, Status } from './launcher';
import type { Settings } from './settings';
import type { AppStrings } from './strings';

export type Screen =
  | { screen: 'starting'; note: 'checking' | 'postgres' | 'recovering' | 'server' }
  | { screen: 'studio'; address: string }
  | { screen: 'stopping' }
  | { screen: 'error'; message: string; serverLog?: string; postgresLog?: string };

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
      const logs = [screen.serverLog, screen.postgresLog].filter((p): p is string => p !== undefined);
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
  lastError?: string;
  lastStderr?: string;
}

/** How long to wait between asks while waiting for an attached launcher to answer, and between `stop` asks. */
const STEP_MS = 1000;
/** A line that names the setup code may hold one. It is replaced before it is kept or shown. */
const SECRET_LINE = /setup code/i;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
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
  private host: string | undefined;
  private quitting: Promise<void> | undefined;
  /** A `status` child that has not answered yet. The next read waits on it instead of starting another. */
  private pendingStatus: Promise<Status> | undefined;

  constructor(deps: ControllerDeps) {
    this.deps = deps;
    this.pollMs = deps.pollMs ?? 5_000;
    this.stopWaitMs = deps.stopWaitMs ?? 90_000;
  }

  /** The launcher's address once OpenLDR is ready or attached to. */
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
   * The address Studio's requests may be answered for, or undefined. It is address() when this app
   * started the launcher (always on 127.0.0.1), or when the attached launcher's status names a host
   * of 127.0.0.1, localhost or ::1. An attached launcher with another host, or with no host in its
   * status, gives undefined: the app shows it and answers nothing.
   */
  bridgeAddress(): string | undefined {
    if (this.addr === undefined) return undefined;
    if (this.phase === 'own') return this.addr;
    if (this.phase === 'attached' && this.host !== undefined && LOCAL_HOSTS.has(this.host)) return this.addr;
    return undefined;
  }

  async start(): Promise<void> {
    if (this.quitting) return;
    const run = ++this.run;
    this.phase = 'checking';
    this.child = undefined;
    this.addr = undefined;
    this.host = undefined;
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

  /** The error screen. The log paths go with it when the data folder is known, unless `withLogs` is false. */
  private fail(message: string, withLogs = true): void {
    this.phase = 'error';
    this.addr = undefined;
    const logs =
      withLogs && this.dir !== undefined
        ? { serverLog: join(this.dir, 'logs', 'server.log'), postgresLog: join(this.dir, 'logs', 'postgres.log') }
        : {};
    this.show({ screen: 'error', message, ...logs });
  }

  /** Another launcher holds the data folder. Wait until it answers, then show it and keep checking it. */
  private async attach(run: number, status: Extract<Status, { running: true }>): Promise<void> {
    this.phase = 'attached';
    this.addr = status.address;
    this.host = status.host;
    this.dir = status.dataDir;
    this.deps.log(`Attached to a launcher that was already running at ${status.address}.`);
    this.show({ screen: 'starting', note: 'server' });

    // Its lock is live before its server listens, so it may still be starting. Ask once a second,
    // and read its status every pollMs in case it ends before it ever answers.
    let waited = 0;
    while (!(await this.deps.answers(status.address))) {
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
    this.show({ screen: 'studio', address: status.address });

    for (;;) {
      await this.deps.sleep(this.pollMs);
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
    child = { running, exited: false, done: Promise.resolve(), ready: false, sawStopping: false };
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
    if (logged.event === 'stopped') return;
    // A launcher on its way down may still finish its start and say so. That is stale.
    if (child.sawStopping || this.stale(run)) return;
    switch (logged.event) {
      case 'starting':
        this.show({ screen: 'starting', note: logged.step });
        return;
      case 'recovering':
        this.show({ screen: 'starting', note: 'recovering' });
        return;
      case 'ready':
        child.ready = true;
        this.addr = logged.address;
        this.show({ screen: 'studio', address: logged.address });
        return;
    }
  }

  private onExit(run: number, child: Child, code: number | null): void {
    child.exited = true;
    this.deps.log(`The launcher exited with code ${String(code)}.`);
    if (this.stale(run)) return;
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
