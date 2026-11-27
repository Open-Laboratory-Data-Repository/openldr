// The trust file and the start of the launcher.
//
// Node reads its extra trusted certificates once, from the file NODE_EXTRA_CA_CERTS names, when the
// process starts. The server runs inside the launcher's own process. So for Settings > Network to
// manage that list, the launcher's process must be started with the variable naming the trust file
// in the data folder. A person who starts the launcher from a terminal has not set it. The launcher
// then starts itself once more with it set, and the first process only waits.
//
// Only Linux is tested. Signals and descriptor passing are unproven on Windows and macOS.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, resolve } from 'node:path';

/** Set to '1' in the process that `startAgain` starts, so it never starts itself again. */
export const TRUST_RESTARTED = 'OPENLDR_TRUST_RESTARTED';

/**
 * What `start` does about the trust file, decided before anything else is started.
 *   'go':      NODE_EXTRA_CA_CERTS already names the trust file. Start, with the trust file managed.
 *   'outside': NODE_EXTRA_CA_CERTS names another file. Start, with no managed file.
 *   'again':   NODE_EXTRA_CA_CERTS is not set. Start this program again with it set.
 * After one restart it never answers 'again', which stops a loop.
 */
export function trustStart(input: { trustFile: string; envValue: string | undefined; alreadyRestarted: boolean }): 'go' | 'outside' | 'again' {
  // Set to nothing is not set: Node reads no file for it.
  if (input.envValue === undefined || input.envValue === '') return input.alreadyRestarted ? 'outside' : 'again';
  return resolve(input.envValue) === resolve(input.trustFile) ? 'go' : 'outside';
}

/** Makes the folder and an empty file when missing. Never changes an existing file. */
export function ensureTrustFile(trustFile: string): void {
  mkdirSync(dirname(trustFile), { recursive: true });
  try {
    // Certificates are public, and the file is read by Node whoever started it.
    writeFileSync(trustFile, '', { flag: 'wx', mode: 0o644 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

type SignalSource = { on(signal: string, listener: () => void): unknown; off(signal: string, listener: () => void): unknown };

/**
 * Starts this program again with the same arguments, NODE_EXTRA_CA_CERTS set, and
 * OPENLDR_TRUST_RESTARTED=1. Standard input, output and error go straight through, and so does the
 * events descriptor, at the same number. SIGINT and SIGTERM are passed on to the child, which owns
 * the stop: this process starts nothing else and only waits. Resolves with the child's exit code,
 * 128 plus the signal number when a signal ended it, and 1 when it could not be run.
 */
export function startAgain(input: {
  trustFile: string;
  /** The program and its arguments: `process.argv.slice(1)`. */
  argv: readonly string[];
  eventsFd: number | undefined;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  execArgv?: readonly string[];
  signals?: SignalSource;
  /** Tests: do not show the child's standard error. */
  quiet?: boolean;
}): Promise<number> {
  const signals = input.signals ?? (process as unknown as SignalSource);
  // Descriptors 0 to 2, then nothing up to the events descriptor, which the child gets as it is.
  const stdio: Array<'inherit' | 'ignore' | number> = ['inherit', 'inherit', input.quiet ? 'ignore' : 'inherit'];
  if (input.eventsFd !== undefined) {
    for (let fd = 3; fd < input.eventsFd; fd++) stdio.push('ignore');
    stdio.push(input.eventsFd);
  }
  return new Promise((done) => {
    const child = spawn(input.execPath ?? process.execPath, [...(input.execArgv ?? process.execArgv), ...input.argv], {
      env: { ...(input.env ?? process.env), NODE_EXTRA_CA_CERTS: input.trustFile, [TRUST_RESTARTED]: '1' },
      stdio,
      windowsHide: true,
    });
    const pass = { SIGINT: () => void child.kill('SIGINT'), SIGTERM: () => void child.kill('SIGTERM') };
    signals.on('SIGINT', pass.SIGINT);
    signals.on('SIGTERM', pass.SIGTERM);
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      signals.off('SIGINT', pass.SIGINT);
      signals.off('SIGTERM', pass.SIGTERM);
      done(code);
    };
    child.on('error', () => finish(1));
    child.on('exit', (code, signal) => {
      if (code !== null) return finish(code);
      const number = signal ? (osConstants.signals as Record<string, number>)[signal] : undefined;
      finish(number ? 128 + number : 1);
    });
  });
}
