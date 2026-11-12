// The openldr-standalone command. Runs from the built bundle, never under the tsx command.

import {
  STOPPED,
  STOPPED_FORCED,
  USAGE,
  UsageError,
  launcherFiles,
  parseCommandLine,
  runCli,
  runStart,
  runStatus,
  runStop,
  type Launcher,
} from './commands.js';
import { startPostgres, stopLeftoverPostgres } from './postgres.js';

const print = (line: string): void => void process.stdout.write(`${line}\n`);
const printError = (line: string): void => void process.stderr.write(`${line}\n`);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function start(opts: { dataDir?: string; port: number; host: string }): Promise<void> {
  let launcher: Launcher | undefined;
  let signals = 0;
  // The first Ctrl+C or SIGTERM stops in order and waits for the server. The second skips the
  // wait. During the start there is no launcher to stop yet: the first signal stops it as soon
  // as the start finishes, and a second one exits at once. The exit hook then tells Postgres to
  // stop, and the lock left behind no longer answers, so the next start replaces it.
  // SIGTERM on Windows is unproven.
  const onSignal = (): void => {
    signals += 1;
    if (!launcher) {
      if (signals > 1) process.exit(130);
      return;
    }
    void launcher.stop(signals > 1);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

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

  if (signals > 0) void launcher.stop(signals > 1);
  const result = await launcher.done;
  print(result === 'clean' ? STOPPED : STOPPED_FORCED);
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
      process.exitCode = await runStop(cmd);
      return;
    case 'status':
      process.exitCode = await runStatus(cmd, print);
      return;
    case 'cli':
      // The CLI exits by itself once its command has finished, as it does in Docker.
      process.exitCode = await runCli(cmd);
      return;
  }
}

main().catch((err: unknown) => {
  printError(messageOf(err));
  process.exit(1);
});
