import { buildProgram } from './program';
import { readHandoff, ServedRefusal, setServedHandoff, type ServedHandoff } from './served';

// The real process entry point. No is-main-module guard here: commander construction lives in
// buildProgram() so this file does not need one (see program.ts).
//
// Started by the server for one signed-in caller, it parses the command the server handed over on
// descriptor 3 (served.ts). Otherwise it parses the real process argv, as any CLI does.

function main(): void {
  let handoff: ServedHandoff | null;
  try {
    handoff = readHandoff();
  } catch (err) {
    // The server said it handed a command over and it cannot be used. Stop: never fall back to argv.
    process.stderr.write(`${err instanceof Error ? err.message : 'The hand-off could not be read.'}\n`);
    process.exitCode = 1;
    return;
  }
  if (!handoff) {
    buildProgram().parseAsync(process.argv);
    return;
  }
  setServedHandoff(handoff);
  // exitCode, not process.exit: an exit right after a write can cut the message off on a pipe.
  buildProgram().parseAsync(['node', 'openldr', ...handoff.argv]).catch((err: unknown) => {
    if (!(err instanceof ServedRefusal)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

main();
