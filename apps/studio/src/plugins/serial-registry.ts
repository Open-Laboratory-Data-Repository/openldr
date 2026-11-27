// The serial ports held anywhere on this studio page. Each plugin frame adds its own list, so a
// gate can tell that another frame already holds a port. One physical port is never opened twice.

import type { SerialPortLike } from './serial-gate';

type Source = () => readonly SerialPortLike[];

const sources = new Set<Source>();

/** Adds a frame's list of held ports. Returns the function that removes it. */
export function registerOpenPorts(source: Source): () => void {
  sources.add(source);
  return () => { sources.delete(source); };
}

/** True when a source other than `self` holds `port`. Each source is read now. */
export function isOpenElsewhere(port: SerialPortLike, self: Source): boolean {
  for (const source of sources) {
    if (source === self) continue;
    try {
      if (source().includes(port)) return true;
    } catch { /* a frame that is going away holds nothing */ }
  }
  return false;
}
