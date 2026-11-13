// Runs the standalone launcher's own commands (start, stop, status, cli) as child processes. The
// app's Electron binary runs them as Node, through ELECTRON_RUN_AS_NODE=1. The app never signals
// or kills a child: it stops OpenLDR by running `stop` and waiting.

import { spawn as nodeSpawn } from 'node:child_process';
import type { Readable } from 'node:stream';

/**
 * What the launcher writes to `--events-fd`, one JSON object per line. A copy of the type in
 * apps/standalone/src/events.ts: this package does not import the launcher's source.
 */
export type LauncherEvent =
  | { event: 'starting'; step: 'postgres' | 'server' }
  | { event: 'recovering' }
  | { event: 'ready'; address: string }
  | { event: 'stopping' }
  | { event: 'stopped'; result: 'clean' | 'forced' }
  | { event: 'error'; message: string };

/** How to run the launcher: this program, the launcher's entry file, and a data folder when one is set. */
export interface LauncherTarget {
  execPath: string;
  entry: string;
  dataDir?: string;
}

export type Spawn = typeof import('node:child_process').spawn;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** One event line, or undefined for a line that is not JSON or not one of the six shapes. */
export function parseEventLine(line: string): LauncherEvent | undefined {
  const v = parseJson(line);
  if (!isRecord(v)) return undefined;
  switch (v.event) {
    case 'starting':
      return v.step === 'postgres' || v.step === 'server' ? { event: 'starting', step: v.step } : undefined;
    case 'recovering':
      return { event: 'recovering' };
    case 'ready':
      return typeof v.address === 'string' ? { event: 'ready', address: v.address } : undefined;
    case 'stopping':
      return { event: 'stopping' };
    case 'stopped':
      return v.result === 'clean' || v.result === 'forced' ? { event: 'stopped', result: v.result } : undefined;
    case 'error':
      return typeof v.message === 'string' ? { event: 'error', message: v.message } : undefined;
    default:
      return undefined;
  }
}

/** Turns text chunks into whole lines, without their line ends. Empty lines are skipped. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let rest = '';
  return (chunk) => {
    rest += chunk;
    const parts = rest.split('\n');
    rest = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.endsWith('\r') ? part.slice(0, -1) : part;
      if (line !== '') onLine(line);
    }
  };
}

/** The base environment plus ELECTRON_RUN_AS_NODE=1. The base is not changed. */
export function launcherEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, ELECTRON_RUN_AS_NODE: '1' };
}

function dataDirArgs(t: LauncherTarget): string[] {
  return t.dataDir !== undefined ? ['--data-dir', t.dataDir] : [];
}

/** Always on 127.0.0.1, with events on descriptor 3. */
export function startArgs(t: LauncherTarget, port: number): string[] {
  return [t.entry, 'start', '--host', '127.0.0.1', '--port', String(port), '--events-fd', '3', ...dataDirArgs(t)];
}

/** Runs one short launcher command and collects its output. Rejects only when it cannot be run. */
export function runLauncher(
  t: LauncherTarget,
  args: string[],
  spawn: Spawn = nodeSpawn,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(t.execPath, args, {
      env: launcherEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

export type Status =
  | { running: true; address: string; dataDir: string; host?: string }
  | { running: false; dataDir?: string; busy?: string };

/** Reads `status --json`. Output it cannot read, or a launcher it cannot run, gives `{ running: false }`. */
export async function readStatus(t: LauncherTarget, spawn: Spawn = nodeSpawn): Promise<Status> {
  let stdout: string;
  try {
    ({ stdout } = await runLauncher(t, [t.entry, 'status', '--json', ...dataDirArgs(t)], spawn));
  } catch {
    return { running: false };
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const v = parseJson(lines[lines.length - 1] ?? '');
  if (!isRecord(v)) return { running: false };
  if (v.running === true && typeof v.address === 'string' && typeof v.dataDir === 'string') {
    return {
      running: true,
      address: v.address,
      dataDir: v.dataDir,
      ...(typeof v.host === 'string' ? { host: v.host } : {}),
    };
  }
  if (v.running === false) {
    return {
      running: false,
      ...(typeof v.dataDir === 'string' ? { dataDir: v.dataDir } : {}),
      ...(typeof v.busy === 'string' ? { busy: v.busy } : {}),
    };
  }
  return { running: false };
}

/** The setupCode field of the CLI's JSON: the whole output, or else from the last line that is `{`. */
function setupCodeFrom(stdout: string): string | undefined {
  const candidates = [stdout.trim()];
  const start = stdout.lastIndexOf('\n{\n');
  if (start !== -1) candidates.push(stdout.slice(start + 1).trim());
  for (const text of candidates) {
    const v = parseJson(text);
    if (isRecord(v) && typeof v.setupCode === 'string' && v.setupCode !== '') return v.setupCode;
  }
  return undefined;
}

/**
 * Runs `cli -- auth setup-code --json` and returns the code. Every error message here is fixed
 * text: it never holds the child's output, which may hold the code.
 */
export async function requestSetupCode(t: LauncherTarget, spawn: Spawn = nodeSpawn): Promise<string> {
  let result: { code: number | null; stdout: string };
  try {
    result = await runLauncher(t, [t.entry, 'cli', ...dataDirArgs(t), '--', 'auth', 'setup-code', '--json'], spawn);
  } catch {
    throw new Error('Could not run the launcher to get a setup code.');
  }
  if (result.code !== 0) throw new Error(`The launcher gave no setup code (exit code ${String(result.code)}).`);
  const code = setupCodeFrom(result.stdout);
  if (code === undefined) throw new Error('The launcher gave no setup code the app could read.');
  return code;
}

/** Runs `stop` and gives its exit code. A stop that ends by a signal, or cannot be run, gives 1. */
export async function requestStop(t: LauncherTarget, spawn: Spawn = nodeSpawn): Promise<number> {
  try {
    const { code } = await runLauncher(t, [t.entry, 'stop', ...dataDirArgs(t)], spawn);
    return code ?? 1;
  } catch {
    return 1;
  }
}

export interface RunningLauncher {
  /** The launcher's exit code once it has ended and its pipes have closed; null if it could not start or ended by a signal. */
  exited: Promise<number | null>;
}

/**
 * Starts `start` as a long-running child. Descriptor 3 carries events; standard error carries
 * lines for the app's log. Standard output is ignored. The child is never killed from here.
 */
export function startLauncher(
  t: LauncherTarget,
  port: number,
  on: { event(e: LauncherEvent): void; stderrLine(line: string): void },
  spawn: Spawn = nodeSpawn,
): RunningLauncher {
  const child = spawn(t.execPath, startArgs(t, port), {
    env: launcherEnv(process.env),
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Detached, so the launcher outlives the app on every system: on Windows a child that is not
    // detached is ended with the app's job. Not unref'd: the app still waits for its exit on quit.
    detached: true,
  });
  const events = child.stdio[3] as Readable | null | undefined;
  events?.setEncoding('utf8');
  events?.on(
    'data',
    lineSplitter((line) => {
      const e = parseEventLine(line);
      if (e !== undefined) on.event(e);
    }),
  );
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', lineSplitter((line) => on.stderrLine(line)));

  const exited = new Promise<number | null>((resolve) => {
    let settled = false;
    child.once('error', (err) => {
      on.stderrLine(`Could not start the launcher: ${err.message}`);
      if (settled) return;
      settled = true;
      resolve(null);
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
  });
  return { exited };
}
