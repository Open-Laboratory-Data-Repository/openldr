// The openldr-standalone command. Runs from the built bundle, never under the tsx command.

import {
  STOPPED,
  STOPPED_FORCED,
  USAGE,
  UsageError,
  handleSignals,
  launcherFiles,
  parseCommandLine,
  runCli,
  runStart,
  runStatus,
  runStop,
  type Launcher,
} from './commands.js';
import { startPostgres, stopLeftoverPostgres } from './postgres.js';

// After a hangup (the terminal was closed) writes to the terminal fail. A failed write must not
// end the process before the stop has finished: the stop closes the server, waits for Postgres
// and removes the lock, and a crash would skip all of that and leave only the exit hook. So
// write errors are ignored, both the ones a stream emits later and the ones it throws at once.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const write = (stream: NodeJS.WriteStream, line: string): void => {
  try {
    stream.write(`${line}\n`);
  } catch {
    // The terminal is gone. Nothing to tell.
  }
};
const print = (line: string): void => write(process.stdout, line);
const printError = (line: string): void => write(process.stderr, line);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function start(opts: { dataDir?: string; port: number; host: string }): Promise<void> {
  const signals = handleSignals({ source: process, print, exit: (code) => process.exit(code) });

  let launcher: Launcher;
  try {
    launcher = await runStart(opts, {
      startPostgres,
      stopLeftoverPostgres,
      // Loaded only now, after runStart has set the environment the server reads when it loads.
      startServer: async (cfg, logger) => (await import('@openldr/server/start')).startServer(cfg, logger),
      print,
      now: () => new Date(),
      ...launcherFiles(),
    });
  } catch (err) {
    printError(messageOf(err));
    // A failed start leaves the server's update check running for a few seconds. Do not wait.
    process.exit(1);
  }

  signals.attach(launcher);
  try {
    const result = await launcher.done;
    print(result === 'clean' ? STOPPED : STOPPED_FORCED);
  } catch (err) {
    // A stop that left something behind is a failure, not a clean stop.
    printError(messageOf(err));
    process.exit(1);
  }
  // Shutdown has finished. Exit now rather than wait for timers the server leaves behind.
  process.exit(0);
}

async function main(): Promise<void> {
  let cmd;
  try {
    cmd = parseCommandLine(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    printError(err.message);
    printError('');
    printError(USAGE);
    process.exitCode = 2;
    return;
  }
  switch (cmd.command) {
    case 'help':
      print(USAGE);
      return;
    case 'start':
      return start(cmd);
    case 'stop':
      process.exitCode = await runStop(cmd, print);
      return;
    case 'status':
      process.exitCode = await runStatus(cmd, print);
      return;
    case 'cli':
      // The CLI exits by itself once its command has finished, as it does in Docker.
      process.exitCode = await runCli(cmd, print);
      return;
  }
}

main().catch((err: unknown) => {
  printError(messageOf(err));
  process.exit(1);
});
