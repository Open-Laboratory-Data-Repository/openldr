// The app's settings file. It holds the port, start at sign-in, the window size, whether OpenLDR
// is shared on the lab network, which OpenLDR the app shows, and the lock. It never holds a
// password or a key. The lock is kept as a salted hash of its PIN, never the PIN.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseServerAddress } from './server-address';

export interface Settings {
  port?: number;
  startAtSignIn: boolean;
  window?: { width: number; height: number };
  /** Present, and true, only while OpenLDR is shared on the lab network. */
  shareOnNetwork?: true;
  /** The port other PCs use. Without it, the launcher's own default. */
  sharePort?: number;
  /** 'local' runs OpenLDR on this PC. 'connect' shows another OpenLDR. Missing means not chosen yet. */
  mode?: 'local' | 'connect';
  /**
   * The OpenLDR that connect mode shows. `address` is as parseServerAddress gives it. `fingerprint`
   * is the SHA-256 of a certificate the person accepted for that address, and only for it.
   */
  server?: { address: string; fingerprint?: string };
  /** Present means this PC is locked to OpenLDR. A salted hash of the PIN, both in hex. */
  lock?: { salt: string; hash: string };
  /** The serial port a person chose last time, by its name. Only used to mark a row in the list
   *  of ports. Never to pick one. */
  lastSerialPort?: { portName: string };
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

/** SHA-256 as 32 upper-case hex pairs joined by colons. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const HEX = /^[0-9a-f]+$/i;

function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
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
  if (value.mode === 'local' || value.mode === 'connect') s.mode = value.mode;
  const server = value.server;
  if (isRecord(server) && typeof server.address === 'string') {
    // Only an address in the one form the parser writes. Anything else was not written by this app.
    const parsed = parseServerAddress(server.address);
    if (parsed.ok && parsed.address === server.address) {
      s.server = { address: parsed.address };
      if (typeof server.fingerprint === 'string' && FINGERPRINT.test(server.fingerprint)) s.server.fingerprint = server.fingerprint;
    }
  }
  const lock = value.lock;
  if (isRecord(lock) && isHex(lock.salt) && isHex(lock.hash)) s.lock = { salt: lock.salt, hash: lock.hash };
  const lastPort = value.lastSerialPort;
  if (isRecord(lastPort) && typeof lastPort.portName === 'string' && lastPort.portName !== '' && lastPort.portName.length <= 200) {
    s.lastSerialPort = { portName: lastPort.portName };
  }
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
