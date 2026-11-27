// Connect mode: the app shows an OpenLDR that runs on another PC. It starts no launcher, no server
// and no database. This controller checks that the server answers, settles trust in the server's
// certificate, and shows Studio from the server's address. Every decision lives here so a test can
// reach it; main.ts only wires Electron to it.
//
// The rule that matters most: once Studio is on screen, this controller never replaces it by
// itself. It runs no background check while Studio is shown, because someone may be half way
// through a result. If the server goes off, Studio's own requests fail and Studio says so, with
// the typed text still there. The "cannot reach the server" screen comes only at start, or when
// main.ts reports that Studio's own page failed to load.

import type { PinnedServer, ServerCertificate } from './cert-trust';
import type { Screen } from './controller';
import { parseServerAddress } from './server-address';
import type { Settings } from './settings';
import type { AppStrings } from './strings';

/** Studio page loads that may fail in a row, with the server answering, before the app stops trying. */
export const STUDIO_LOAD_TRIES = 3;

export interface RemoteDeps {
  /**
   * GET <origin>/health with Electron's certificate check deciding, and `pin` as the one
   * certificate accepted beyond what the system trusts. 'untrusted' when that check refused the
   * certificate.
   *
   * Electron asks its check once per certificate in a session and keeps the answer until the app
   * ends. Nothing clears it (proved on Electron 45 on 2026-11-27). So a probe never runs in the
   * window's own session: main.ts runs it in a session made for that pin, whose check never
   * changes. The window's session then meets the server only once the pin is settled.
   */
  probe(address: string, pin: PinnedServer | undefined): Promise<'ok' | 'no-answer' | 'untrusted'>;
  readCertificate(host: string, port: number): Promise<ServerCertificate>;
  /** Tells the window's own certificate check which host and certificate to accept. */
  pin(server: PinnedServer | undefined): void;
  /**
   * Starts the app again. For the one case the window's session holds an old refusal of a
   * certificate the person has since accepted: only a new process forgets it.
   */
  relaunch(): void;
  /** True when this process was started by `relaunch`. It then never asks for another. */
  relaunched?: boolean;
  loadSettings(): Settings;
  saveSettings(s: Settings): void;
  show(screen: Screen): void;
  sleep(ms: number): Promise<void>;
  exit(code: number): void;
  log(line: string): void;
  strings: AppStrings;
  /** How often a server that does not answer is tried again. Default 10 000. */
  pollMs?: number;
}

/** A certificate the person is being asked about. */
interface Question {
  address: string;
  host: string;
  fingerprint: string;
  /** What the person typed, to put back on the connect screen. */
  typed: string;
  /** True when it replaces a certificate this PC accepted before. */
  changed: boolean;
}

export class RemoteController {
  /** Raised by every action. A probe or a wait from before the latest one changes nothing. */
  private run = 0;
  private shown: string | undefined;
  private question: Question | undefined;
  private failedLoads = 0;

  constructor(private readonly deps: RemoteDeps) {}

  /** With a saved server: pin, probe, then Studio. Without one: the connect screen. */
  async start(): Promise<void> {
    const run = ++this.run;
    this.failedLoads = 0;
    const server = this.deps.loadSettings().server;
    if (server === undefined) {
      this.showConnect({});
      return;
    }
    this.deps.show({ screen: 'starting', note: 'checking' });
    await this.open(server, run);
  }

  /** The person pressed Connect with this text. */
  async connect(input: string): Promise<void> {
    const run = ++this.run;
    this.question = undefined;
    this.shown = undefined;
    const parsed = parseServerAddress(input);
    if (!parsed.ok) {
      this.showConnect({ value: input, problem: parsed.reason });
      return;
    }
    const first = await this.deps.probe(parsed.address, undefined);
    if (run !== this.run) return;
    if (first === 'ok') {
      // Electron already trusts the certificate, or the address is plain http on this PC.
      if (!this.saveServer({ address: parsed.address })) {
        this.showConnect({ value: input, problem: 'not-saved' });
        return;
      }
      this.showStudio(parsed.address);
      return;
    }
    if (first === 'no-answer' || parsed.address.startsWith('http:')) {
      this.showConnect({ value: input, problem: 'no-answer' });
      return;
    }
    const cert = await this.deps.readCertificate(parsed.host, parsed.port);
    if (run !== this.run) return;
    if (!cert.ok) {
      this.showConnect({ value: input, problem: 'no-answer' });
      return;
    }
    this.question = { address: parsed.address, host: parsed.host, fingerprint: cert.fingerprint, typed: input, changed: false };
    this.deps.show({ screen: 'certificate', address: parsed.address, fingerprint: cert.fingerprint, changed: false });
  }

  /** The person answered the certificate screen. */
  async trust(yes: boolean): Promise<void> {
    const q = this.question;
    if (q === undefined) return;
    const run = ++this.run;
    this.question = undefined;
    if (!yes) {
      // A changed certificate that was refused: the server this PC knows stays as it was. Nothing
      // is tried again by itself, because a refused certificate is not a server that is off.
      if (q.changed) this.deps.show({ screen: 'unreachable', address: q.address });
      else this.showConnect({ value: q.typed });
      return;
    }
    // The check runs with this certificate accepted, away from the window's session. Nothing goes
    // on disk, and the window's own pin does not move, until the check has passed on this same
    // run: a quit or another action in the meantime leaves everything as it was.
    const answer = await this.deps.probe(q.address, { host: q.host, fingerprint: q.fingerprint });
    if (run !== this.run) return;
    if (answer === 'ok') {
      if (!this.saveServer({ address: q.address, fingerprint: q.fingerprint })) {
        this.showConnect({ value: q.typed, problem: 'not-saved' });
        return;
      }
      this.showStudio(q.address);
      return;
    }
    // One try. The certificate the person accepted did not work. The server this PC had, if any,
    // is untouched.
    this.showConnect({ value: q.typed, problem: 'certificate' });
  }

  /** Forget the server and show the connect screen with the old address filled in. */
  changeServer(): void {
    this.run++;
    this.question = undefined;
    this.shown = undefined;
    const old = this.deps.loadSettings().server?.address;
    const saved = this.saveServer(undefined);
    this.deps.pin(undefined);
    this.showConnect({ ...(old === undefined ? {} : { value: old }), ...(saved ? {} : { problem: 'not-saved' as const }) });
  }

  /**
   * main.ts calls this when Studio's own page failed to load from the server. `why` is
   * 'certificate' when the window's session refused the server's certificate.
   */
  async studioFailed(why: 'certificate' | 'other' = 'other'): Promise<void> {
    const run = ++this.run;
    this.shown = undefined;
    if (why === 'certificate' && !this.deps.relaunched) {
      // The window's session refused a certificate. If a check with the saved pin passes, that
      // session is holding an answer from before the person accepted it, and only a new process
      // forgets it. If the check does not pass, the certificate really is refused: go on below.
      const server = this.deps.loadSettings().server;
      const parsed = server === undefined ? undefined : parseServerAddress(server.address);
      if (server !== undefined && parsed?.ok) {
        const pin = server.fingerprint === undefined ? undefined : { host: parsed.host, fingerprint: server.fingerprint };
        const answer = await this.deps.probe(parsed.address, pin);
        if (run !== this.run) return;
        if (answer === 'ok') {
          this.deps.log('the window holds an old refusal of an accepted certificate: starting again');
          this.deps.relaunch();
          return;
        }
      }
    }
    this.failedLoads++;
    if (this.failedLoads >= STUDIO_LOAD_TRIES) {
      this.deps.log(`Studio did not load ${this.failedLoads} times in a row while the server answered`);
      this.deps.show({ screen: 'error', message: this.deps.strings.studioWillNotLoad });
      return;
    }
    const server = this.deps.loadSettings().server;
    if (server === undefined) {
      this.showConnect({});
      return;
    }
    this.deps.show({ screen: 'unreachable', address: server.address });
    // Wait first: the server may answer its health check and still not serve Studio.
    await this.deps.sleep(this.pollMs());
    if (run !== this.run) return;
    await this.open(server, run, true);
  }

  /** main.ts calls this when Studio's own page has loaded. */
  studioLoaded(): void {
    this.failedLoads = 0;
  }

  /** The person pressed Try again. */
  async retry(): Promise<void> {
    const run = ++this.run;
    this.failedLoads = 0;
    this.question = undefined;
    const server = this.deps.loadSettings().server;
    if (server === undefined) {
      this.showConnect({});
      return;
    }
    await this.open(server, run);
  }

  /** There is no launcher to stop. */
  async quit(): Promise<void> {
    this.run++;
    this.deps.exit(0);
  }

  /** The server's address once Studio is shown. */
  address(): string | undefined {
    return this.shown;
  }

  /** Never: the app's bridge calls stay off for a server on another PC. */
  bridgeAddress(): undefined {
    return undefined;
  }

  /** Never: connect mode has no data folder. */
  dataDir(): undefined {
    return undefined;
  }

  private pollMs(): number {
    return this.deps.pollMs ?? 10_000;
  }

  /** Pins the saved certificate, then tries the saved server until it answers. */
  private async open(server: NonNullable<Settings['server']>, run: number, unreachableShown = false): Promise<void> {
    const parsed = parseServerAddress(server.address);
    if (!parsed.ok) {
      this.showConnect({ value: server.address, problem: parsed.reason });
      return;
    }
    const pin = server.fingerprint === undefined ? undefined : { host: parsed.host, fingerprint: server.fingerprint };
    let waiting = unreachableShown;
    for (;;) {
      const answer = await this.deps.probe(parsed.address, pin);
      if (run !== this.run) return;
      if (answer === 'ok') {
        this.showStudio(parsed.address);
        return;
      }
      if (answer === 'untrusted') {
        const cert = await this.deps.readCertificate(parsed.host, parsed.port);
        if (run !== this.run) return;
        if (cert.ok) {
          if (server.fingerprint !== undefined && cert.fingerprint !== server.fingerprint) {
            // The saved one stays until the person says yes to this one.
            this.question = { address: parsed.address, host: parsed.host, fingerprint: cert.fingerprint, typed: server.address, changed: true };
            this.deps.show({ screen: 'certificate', address: parsed.address, fingerprint: cert.fingerprint, changed: true });
          } else {
            // The same certificate is refused, or none was accepted here before. Asking again
            // would loop, so the person is sent to the connect screen with the address filled in.
            this.showConnect({ value: server.address, problem: 'certificate' });
          }
          return;
        }
        // The certificate could not be read: the server went off between the two calls.
      }
      if (!waiting) {
        waiting = true;
        this.deps.show({ screen: 'unreachable', address: parsed.address });
      }
      await this.deps.sleep(this.pollMs());
      if (run !== this.run) return;
    }
  }

  /** Sets the window's own pin to the saved server's, then shows Studio from it. */
  private showStudio(address: string): void {
    this.pinSaved();
    this.shown = address;
    this.deps.show({ screen: 'studio', address });
  }

  /** `fixed` marks a connect screen with no way back to the mode choice: a mode is already saved. */
  private showConnect(parts: { value?: string; problem?: Extract<Screen, { screen: 'connect' }>['problem'] }): void {
    this.shown = undefined;
    const fixed = this.deps.loadSettings().mode !== undefined;
    this.deps.show({ screen: 'connect', ...parts, ...(fixed ? { fixed: true } : {}) });
  }

  /** Writes the server, or its absence, with every other setting kept. False when the file could not be written. */
  private saveServer(server: Settings['server']): boolean {
    try {
      const { server: _old, ...rest } = this.deps.loadSettings();
      // The first server that works also settles the mode. Until then the person can go back.
      this.deps.saveSettings(server === undefined ? rest : { ...rest, mode: rest.mode ?? 'connect', server });
      return true;
    } catch (err) {
      this.deps.log(`could not save the settings: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Puts the pin back to the server on disk: its accepted certificate, or none. */
  private pinSaved(): void {
    const server = this.deps.loadSettings().server;
    const parsed = server === undefined ? undefined : parseServerAddress(server.address);
    this.deps.pin(server?.fingerprint !== undefined && parsed?.ok ? { host: parsed.host, fingerprint: server.fingerprint } : undefined);
  }
}
