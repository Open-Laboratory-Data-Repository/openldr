// The app's settings file. It holds the port, start at sign-in, the window size and whether
// OpenLDR is shared on the lab network, and nothing else. It never holds a secret.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Settings {
  port?: number;
  startAtSignIn: boolean;
  window?: { width: number; height: number };
  /** Present, and true, only while OpenLDR is shared on the lab network. */
  shareOnNetwork?: true;
  /** The port other PCs use. Without it, the launcher's own default. */
  sharePort?: number;
}

/** The share port the launcher uses when the settings name none. The launcher's own default. */
export const DEFAULT_SHARE_PORT = 3443;

export const DEFAULT_SETTINGS: Settings = Object.freeze({ startAtSignIn: false });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

function isSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** Keeps the known fields when each has the right type. Anything else is dropped. */
function known(value: unknown): Settings {
  const s: Settings = { startAtSignIn: false };
  if (!isRecord(value)) return s;
  if (isPort(value.port)) s.port = value.port;
  if (typeof value.startAtSignIn === 'boolean') s.startAtSignIn = value.startAtSignIn;
  const w = value.window;
  if (isRecord(w) && isSize(w.width) && isSize(w.height)) s.window = { width: w.width, height: w.height };
  if (value.shareOnNetwork === true) s.shareOnNetwork = true;
  if (isPort(value.sharePort)) s.sharePort = value.sharePort;
  return s;
}

/** Reads the settings file. A missing, unreadable or malformed file gives the defaults. Never throws. */
export function loadSettings(file: string): Settings {
  try {
    return known(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return known(undefined);
  }
}

/** Writes the known fields to a temp file next to it, then renames it into place. */
export function saveSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(known(s), null, 2)}\n`);
  renameSync(temp, file);
}
