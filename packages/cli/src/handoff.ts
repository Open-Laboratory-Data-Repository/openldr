// What the server hands to a CLI process it starts for one signed-in caller. The server writes one
// JSON message of this shape on file descriptor SERVED_FD, and sets SERVED_FD_ENV to say so.
//
// This file imports nothing, not even a type. The server reads it through `@openldr/cli/wire`, and it
// must pull in no command code.

export interface ServedHandoff {
  /** The command the capability check was made for. */
  path: string;
  /** The caller's tokens after the program name. Path values are real paths inside runDir. */
  argv: string[];
  caller: { id: string; username: string; displayName: string | null; keyName: string | null };
  /** The folder made for this one request. */
  runDir: string;
  /** Folders outside runDir that this request may also use, for kept uploads. */
  keptDirs: string[];
}

/** The file descriptor the hand-off arrives on. */
export const SERVED_FD = 3;

/** The variable the server sets, to the text '3', for the processes it starts. */
export const SERVED_FD_ENV = 'OPENLDR_SERVED_FD';
