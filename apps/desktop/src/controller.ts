// What the app does with the launcher: find one already running or start one, follow its events,
// show the right screen, and stop it through `stop` on quit. Every decision lives here so a test
// can reach it; main.ts only wires Electron to it. The app never signals or kills the launcher.

import { join } from 'node:path';
import type { LauncherEvent, RunningLauncher, ShareInfo, Status } from './launcher';
import { windowAddress } from './locality';
import { DEFAULT_SHARE_PORT, type Settings } from './settings';
import type { AppStrings } from './strings';

export type Screen =
  | { screen: 'starting'; note: 'checking' | 'postgres' | 'recovering' | 'server' }
  | { screen: 'studio'; address: string }
  | { screen: 'stopping' }
  | { screen: 'error'; message: string; serverLog?: string; postgresLog?: string; desktopLog?: string }
  /** The first question on a PC with no data: run OpenLDR here, or show another PC's. */
  | { screen: 'choose' }
  /** Connect mode: the server's address. `fixed` means a mode is already saved, so there is no way back to 'choose'. */
  | { screen: 'connect'; value?: string; problem?: 'empty' | 'not-https' | 'unreadable' | 'no-answer' | 'certificate' | 'not-saved'; fixed?: true }
  /** Connect mode: a certificate this PC's system does not trust, for the person to compare. */
  | { screen: 'certificate'; address: string; fingerprint: string; changed: boolean }
  /** Connect mode: the server does not answer. */
  | { screen: 'unreachable'; address: string }
  /** The lock's PIN, asked in a small window of its own. Never carries the PIN. */
  | { screen: 'pin'; purpose: 'set' | 'unlock' | 'quit'; wrong?: boolean; tooShort?: boolean };

/** What a button on the app's own page asks for. */
export type PageAction =
  | 'choose-local' | 'choose-connect' | 'connect' | 'back' | 'trust' | 'no-trust' | 'retry' | 'change-server'
  | 'pin-submit' | 'pin-cancel';

/** What main sends to the app's own page. The words are already in the person's language. */
export interface PageState {
  title: string;
  note?: string;
  message?: string;
  logs?: string[];
  retryLabel?: string;
  /** Shown in a fixed-width font: a certificate fingerprint. */
  detail?: string;
  /** One line under the input that says what is wrong with what was typed. */
  problem?: string;
  input?: { label: string; value: string; placeholder: string; secret?: boolean };
  actions?: Array<{ id: PageAction; label: string; primary?: boolean }>;
}

const PROBLEMS = {
  empty: 'problemEmpty',
  'not-https': 'problemNotHttps',
  unreadable: 'problemUnreadable',
  'no-answer': 'problemNoAnswer',
  certificate: 'problemCertificate',
  'not-saved': 'problemNotSaved',
} as const;

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
    case 'choose':
      return {
        title: strings.chooseTitle,
        message: strings.chooseMessage,
        actions: [{ id: 'choose-local', label: strings.chooseLocal }, { id: 'choose-connect', label: strings.chooseConnect }],
      };
    case 'connect':
      return {
        title: strings.connectTitle,
        input: { label: strings.connectLabel, value: screen.value ?? '', placeholder: strings.connectPlaceholder },
        ...(screen.problem ? { problem: strings[PROBLEMS[screen.problem]] } : {}),
        actions: [
          { id: 'connect', label: strings.connectAction, primary: true },
          // Back goes to the mode choice, which is offered only while no mode is saved.
          ...(screen.fixed ? [] : [{ id: 'back' as const, label: strings.backAction }]),
        ],
      };
    case 'certificate':
      // For a changed certificate the safe answer is the primary one.
      return {
        title: screen.changed ? strings.certChangedTitle : strings.certFirstTitle,
        message: (screen.changed ? strings.certChangedMessage : strings.certFirstMessage).replace('{address}', screen.address),
        detail: screen.fingerprint,
        actions: [
          { id: 'trust', label: strings.trustYes, ...(screen.changed ? {} : { primary: true }) },
          { id: 'no-trust', label: strings.trustNo, ...(screen.changed ? { primary: true } : {}) },
        ],
      };
    case 'pin': {
      const words = {
        set: { title: strings.pinSetTitle, message: strings.pinSetMessage, action: strings.pinSetAction },
        unlock: { title: strings.pinUnlockTitle, message: undefined, action: strings.pinUnlockAction },
        quit: { title: strings.pinQuitTitle, message: strings.pinQuitMessage, action: strings.pinQuitAction },
      }[screen.purpose];
      const problem = screen.wrong ? strings.pinWrong : screen.tooShort ? strings.pinTooShort : undefined;
      return {
        title: words.title,
        ...(words.message !== undefined ? { message: words.message } : {}),
        // Always empty: what was typed is never sent back to the page.
        input: { label: strings.pinLabel, value: '', placeholder: '', secret: true },
        ...(problem !== undefined ? { problem } : {}),
        actions: [{ id: 'pin-submit', label: words.action, primary: true }, { id: 'pin-cancel', label: strings.pinCancel }],
      };
    }
    case 'unreachable':
      return {
        title: strings.unreachableTitle,
        message: strings.unreachableMessage.replace('{address}', screen.address),
        actions: [{ id: 'retry', label: strings.retryLabel, primary: true }, { id: 'change-server', label: strings.changeServer }],
      };
  }
}

export interface ControllerDeps {
  readStatus(): Promise<Status>;
  /** `share` is set when OpenLDR is to be shared on the lab network, with the port other PCs use. */
  startLauncher(
    port: number,
    on: { event(e: LauncherEvent): void; stderrLine(line: string): void },
    share: { port: number } | undefined,
  ): RunningLauncher;
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
  /** Called when `share()` has changed. */
  shareChanged?(): void;
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
  /** A stop of this launcher that is in flight. A quit and a restart share it. */
  stopping?: Promise<number>;
}

/** An attached launcher's status is read on every this-many polls, to see its share. With the default poll, every 30 seconds. */
const STATUS_REFRESH_POLLS = 6;

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
  /** How the launcher shown now is shared, as it reported it. */
  private shared: ShareInfo | undefined;
  /** Set while a restart runs. A second one is refused. */
  private restarting = false;
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

  /** How OpenLDR is shared on the lab network, as the launcher reported it. Undefined when it is not. */
  share(): ShareInfo | undefined {
    return this.shared;
  }

  /** Keeps the share and tells the app when it really changed, so the tray can be drawn again. */
  private setShared(next: ShareInfo | undefined): void {
    if (JSON.stringify(next) === JSON.stringify(this.shared)) return;
    this.shared = next;
    this.deps.shareChanged?.();
  }

  /**
   * Stops the app's own launcher and starts it again with the settings as they are now. For a
   * setting the launcher only reads at start, such as sharing. Gives false, and does nothing,
   * unless this app started the launcher and it is ready: a launcher started elsewhere is not the
   * app's to restart. Also false while another restart or a quit runs. Never exits the app.
   */
  async restart(): Promise<boolean> {
    const child = this.child;
    if (this.quitting || this.restarting || this.phase !== 'own' || child === undefined || !child.ready || child.exited) return false;
    this.restarting = true;
    try {
      // The start number goes up first. The old launcher's exit and its last events then count as
      // stale, so a stop the app asked for is never shown as "OpenLDR is no longer running".
      this.run += 1;
      this.addr = undefined;
      this.setShared(undefined);
      this.show({ screen: 'stopping' });
      const code = await this.stopOwn(child);
      if (this.quitting) return true;
      if (!child.exited || code !== 0) {
        // The old launcher may still hold the data folder. A second one must not be started.
        this.deps.log('The launcher did not stop for a restart.');
        this.fail(this.deps.strings.shareRestartFailed);
        return true;
      }
      this.child = undefined;
      this.phase = 'idle';
      void this.start();
      return true;
    } finally {
      this.restarting = false;
    }
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
    this.setShared(undefined);
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
    this.setShared(undefined);
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
    this.setShared(status.share);
    this.dir = status.dataDir;
    this.deps.log(`Attached to a launcher that was already running at ${address}.`);
    this.show({ screen: 'starting', note: 'server' });

    // Its lock is live before its server listens, so it may still be starting. Ask once a second,
    // and read its status every pollMs in case it ends before it ever answers.
    let waited = 0;
    let waitedForIt = false;
    while (!(await this.deps.answers(address))) {
      waitedForIt = true;
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
    // A launcher that was still starting when this app attached had not published its share yet:
    // the lock is live before the HTTPS front is. So its status is read once more, now it answers.
    if (waitedForIt) {
      const fresh = await this.boundedStatus();
      if (this.stale(run)) return;
      if (fresh?.running) this.setShared(fresh.share);
    }
    this.show({ screen: 'studio', address });

    // While the address answers, the launcher is alive and no `status` child is needed for that.
    // Only when it stops answering is the status read to learn whether the launcher has gone.
    let polls = 0;
    for (;;) {
      await this.deps.sleep(this.pollMs);
      if (this.stale(run)) return;
      polls += 1;
      if (await this.deps.answers(address)) {
        if (this.stale(run)) return;
        // An address that answers says nothing about the share. The launcher publishes it a
        // moment after its server answers, and another launcher may take the same address later.
        // So on a slow timer the status is read for the share alone. It is best effort: a read
        // that gives no answer, or an odd one, changes nothing and is tried again next time.
        // It never takes a person out of a Studio that works.
        if (polls % STATUS_REFRESH_POLLS === 0) {
          const s = await this.boundedStatus();
          if (this.stale(run)) return;
          if (s?.running) this.setShared(s.share);
        }
        continue;
      }
      if (this.stale(run)) return;
      if (!(await this.stillRunning(run))) return;
    }
  }

  /** Reads the status of an attached launcher. Shows the error screen and gives false once it has gone. */
  private async stillRunning(run: number): Promise<boolean> {
    const s = await this.boundedStatus();
    if (this.stale(run)) return false;
    if (s?.running) {
      // Its share may have started, stopped or changed since the last read.
      this.setShared(s.share);
      return true;
    }
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

    // Read at each start, so a restart picks up a setting that changed.
    const now = this.deps.loadSettings();
    const share = now.shareOnNetwork === true ? { port: now.sharePort ?? DEFAULT_SHARE_PORT } : undefined;

    this.phase = 'own';
    this.deps.log(`Starting the launcher on port ${port}${share ? `, shared on port ${share.port}` : ''}.`);
    let child!: Child;
    const running = this.deps.startLauncher(
      port,
      {
        event: (e) => this.onEvent(run, child, e),
        stderrLine: (line) => {
          const kept = this.clean(line);
          child.lastStderr = kept;
          this.deps.log(`launcher: ${kept}`);
        },
      },
      share,
    );
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
        this.setShared(logged.share);
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
    // Whatever the phase: after a restart that could not stop it, the launcher this app started
    // is on the error screen and is still this app's to stop.
    const child = this.child;
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
  private stopOwn(child: Child): Promise<number> {
    // One stop at a time for one launcher. A quit that comes during a restart waits for the
    // restart's stop and takes its result, where a second `stop` could fail and end the app early.
    child.stopping ??= this.askToStop(child).finally(() => {
      child.stopping = undefined;
    });
    return child.stopping;
  }

  private async askToStop(child: Child): Promise<number> {
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
