import { buildClientProgram, buildProgram, SentThroughApp } from './program';
import { redactError } from './redact-error';
import { enterRunDir, readHandoff, refuseHelp, ServedRefusal, setServedHandoff, type ServedHandoff } from './served';

// The real process entry point. No is-main-module guard here: commander construction lives in
// buildProgram() so this file does not need one (see program.ts).
//
// Started by the server for one signed-in caller, it parses the command the server handed over on
// descriptor 3 (served.ts). Otherwise it parses the real process argv, as any CLI does.

/** One line on standard error and exit code 1. exitCode, not process.exit: an exit right after a
 *  write can cut the message off on a pipe. */
function stop(message: string): void {
  process.stderr.write(`${message.split('\n')[0]}\n`);
  process.exitCode = 1;
}

function main(): void {
  let handoff: ServedHandoff | null;
  try {
    handoff = readHandoff();
  } catch (err) {
    // The server said it handed a command over and it cannot be used. Stop: never fall back to argv.
    stop(err instanceof Error ? err.message : 'The hand-off could not be read.');
    return;
  }
  if (!handoff) {
    // A command sent through the app ends its parse with SentThroughApp; process.exitCode holds the
    // result. Any other rejection stays unhandled, as before.
    buildClientProgram().parseAsync(process.argv).catch((err: unknown) => {
      if (err instanceof SentThroughApp) return;
      throw err;
    });
    return;
  }
  setServedHandoff(handoff);
  let program;
  try {
    enterRunDir(handoff);
    program = buildProgram();
    refuseHelp(program, handoff.argv);
  } catch (err) {
    stop(err instanceof ServedRefusal ? err.message : redactError(err));
    return;
  }
  // The server streams standard error back to a remote caller, so no stack goes there: one
  // redacted line.
  program.parseAsync(['node', 'openldr', ...handoff.argv]).catch((err: unknown) => {
    stop(err instanceof ServedRefusal ? err.message : redactError(err));
  });
}

main();
