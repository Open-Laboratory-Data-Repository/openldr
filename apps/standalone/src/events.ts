// What the launcher tells a program that runs it, such as the desktop app. With
// `start --events-fd <n>`, each event is one JSON object on one line, written to descriptor n.
// An event never holds a password, a key, a token or a setup code.

import { writeSync } from 'node:fs';

export type LauncherEvent =
  | { event: 'starting'; step: 'postgres' | 'server' }
  | { event: 'recovering' }
  | { event: 'ready'; address: string }
  | { event: 'stopping' }
  | { event: 'stopped'; result: 'clean' | 'forced' }
  | { event: 'error'; message: string };

/** Writes one JSON object and a newline per event to the descriptor. A failed write is ignored. */
export function eventSink(
  fd: number,
  write: (fd: number, text: string) => void = (d, text) => void writeSync(d, text),
): (e: LauncherEvent) => void {
  return (e) => {
    try {
      write(fd, `${JSON.stringify(e)}\n`);
    } catch {
      // The reader has gone, for example the app was killed. The launcher keeps running.
    }
  };
}
