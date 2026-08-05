import { buildProgram } from './program';

// The real process entry point: parse the real process argv, unconditionally, exactly like a
// normal CLI. No is-main-module guard here — see program.ts's buildProgram() for why: commander
// construction lives in a factory precisely so this file doesn't need one.
buildProgram().parseAsync(process.argv);
