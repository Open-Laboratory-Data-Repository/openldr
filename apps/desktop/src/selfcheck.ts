// The builder's self-check. When OPENLDR_DESKTOP_SELFCHECK names a file, the app waits until it
// shows the error screen, or until Studio has drawn its setup page or its sign-in form. It then
// writes one JSON object about what it shows to that file. It reports whether things exist, never
// a field's value. The setup code field is hidden by a style rule before anything else is done.

import { renameSync, writeFileSync } from 'node:fs';

export type SelfcheckThen = 'quit' | 'close' | 'stay';

export interface SelfcheckConfig {
  file: string;
  /** After writing: quit through the normal quit, close the window and keep running, or do nothing. */
  then: SelfcheckThen;
}

/** The self-check settings from the environment, or undefined when no file is named. */
export function selfcheckConfig(env: NodeJS.ProcessEnv): SelfcheckConfig | undefined {
  const file = env.OPENLDR_DESKTOP_SELFCHECK?.trim();
  if (!file) return undefined;
  const then = env.OPENLDR_DESKTOP_SELFCHECK_THEN;
  return { file, then: then === 'close' || then === 'stay' ? then : 'quit' };
}

export interface SelfcheckReport {
  screen: 'studio' | 'error';
  address: string | null;
  title: string;
  setupPage: boolean;
  attached: boolean;
  electron: string;
  node: string;
  platform: string;
}

/** Hides the setup code field, so a window on a real screen never shows a code. */
export const HIDE_SETUP_CODE_CSS = '#local-setup-code { visibility: hidden !important; }';

/** Reads only the title and whether two elements exist. */
const PROBE_SCRIPT = `({
  title: document.title,
  setupPage: document.getElementById('local-setup-code') !== null,
  signIn: document.getElementById('local-sign-in-username') !== null,
})`;

interface Facts {
  title: string;
  setupPage: boolean;
  signIn: boolean;
}

/** How long to wait for React to draw the setup page or the sign-in form. */
const STUDIO_WAIT_MS = 20_000;
/** How long to wait for the app's own page to show the error title. */
const PAGE_WAIT_MS = 5_000;
const STEP_MS = 250;

export interface SelfcheckDeps {
  config: SelfcheckConfig;
  insertCss(css: string): Promise<unknown>;
  /** Runs a script in the window's page and gives its result. */
  run(script: string): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  address(): string | undefined;
  attached(): boolean;
  log(line: string): void;
  /** What to do once the file is written. */
  after(then: SelfcheckThen): void;
}

export class Selfcheck {
  private readonly deps: SelfcheckDeps;
  private finished = false;
  private studioStarted = false;
  private errorStarted = false;

  constructor(deps: SelfcheckDeps) {
    this.deps = deps;
  }

  /** The error screen is on its way. Waits until the page shows `title`, then reports. */
  onError(title: string): void {
    if (this.finished || this.errorStarted) return;
    this.errorStarted = true;
    void this.checkPage(title);
  }

  /** Studio has loaded at the launcher's address. */
  onStudioLoaded(): void {
    if (this.finished || this.studioStarted) return;
    this.studioStarted = true;
    void this.checkStudio();
  }

  private async probe(): Promise<Facts> {
    const none: Facts = { title: '', setupPage: false, signIn: false };
    try {
      const v = await Promise.race([this.deps.run(PROBE_SCRIPT), this.deps.sleep(2000).then(() => none)]);
      if (typeof v !== 'object' || v === null) return none;
      const r = v as Record<string, unknown>;
      return { title: typeof r.title === 'string' ? r.title : '', setupPage: r.setupPage === true, signIn: r.signIn === true };
    } catch {
      return none;
    }
  }

  private async checkStudio(): Promise<void> {
    try {
      await this.deps.insertCss(HIDE_SETUP_CODE_CSS);
    } catch (err) {
      this.deps.log(`self-check: the style rule was not added: ${err instanceof Error ? err.message : String(err)}`);
    }
    let facts = await this.probe();
    for (let waited = 0; !facts.setupPage && !facts.signIn && waited < STUDIO_WAIT_MS; waited += STEP_MS) {
      if (this.finished) return;
      await this.deps.sleep(STEP_MS);
      facts = await this.probe();
    }
    this.finish('studio', facts);
  }

  private async checkPage(title: string): Promise<void> {
    let facts = await this.probe();
    for (let waited = 0; facts.title !== title && waited < PAGE_WAIT_MS; waited += STEP_MS) {
      if (this.finished) return;
      await this.deps.sleep(STEP_MS);
      facts = await this.probe();
    }
    this.finish('error', facts);
  }

  private finish(screen: 'studio' | 'error', facts: Facts): void {
    if (this.finished) return;
    this.finished = true;
    const report: SelfcheckReport = {
      screen,
      address: this.deps.address() ?? null,
      title: facts.title,
      setupPage: facts.setupPage,
      attached: this.deps.attached(),
      electron: process.versions.electron ?? '',
      node: process.versions.node,
      platform: process.platform,
    };
    try {
      const temp = `${this.deps.config.file}.tmp`;
      writeFileSync(temp, `${JSON.stringify(report)}\n`);
      renameSync(temp, this.deps.config.file);
      this.deps.log(`self-check: wrote ${screen}.`);
    } catch (err) {
      this.deps.log(`self-check: the file was not written: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.deps.after(this.deps.config.then);
  }
}
