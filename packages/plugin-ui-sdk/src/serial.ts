// Serial ports for a plugin page: the limits, the types, and the checks the studio runs.
//
// The toolkit inside the plugin frame cannot import anything, so it checks nothing and passes
// each call on. The studio does every check, with the functions here.

/** Open ports for one plugin page. */
export const SERIAL_MAX_OPEN = 2;
/** Bytes one read returns. */
export const SERIAL_READ_MAX = 65_536;
/** Bytes waiting to be read, per port. Reaching it drops everything unread. */
export const SERIAL_BUFFER_MAX = 1_048_576;
/** Bytes one write takes. */
export const SERIAL_WRITE_MAX = 65_536;
/** Bytes waiting to be sent, per port. */
export const SERIAL_WRITE_QUEUE_MAX = 1_048_576;
/** The longest wait for one read, in milliseconds. */
export const SERIAL_WAIT_MAX_MS = 30_000;

const SPEED_MIN = 300;
const SPEED_MAX = 921_600;

export interface PluginSerialSettings {
  /** A whole number from 300 to 921600. */
  baudRate: number;
  /** Default 8. */
  dataBits?: 7 | 8;
  /** Default 1. */
  stopBits?: 1 | 2;
  /** Default 'none'. */
  parity?: 'none' | 'even' | 'odd';
  /** Default 'none'. */
  flowControl?: 'none' | 'hardware';
}

/** A port as a plugin page knows it: a handle the studio made up for that one page, and a name to show. */
export interface PluginSerialPort { port: string; label: string }

/** `lost` is true once after unread bytes were dropped. The plugin then starts its framing again. */
export interface PluginSerialRead { bytes: Uint8Array; lost: boolean }

/** Why the studio refused. The text of `error` in the bridge's answer. */
export type PluginSerialRefusal =
  | 'serial-not-granted' | 'serial-unavailable' | 'serial-cancelled' | 'serial-unknown-port'
  | 'serial-busy' | 'serial-too-many' | 'serial-too-large' | 'serial-bad-settings' | 'serial-closed'
  /** The device or the system refused: an open that fails, an I/O error. */
  | 'serial-failed';

const FIELDS: Record<string, readonly unknown[]> = {
  dataBits: [7, 8],
  stopBits: [1, 2],
  parity: ['none', 'even', 'odd'],
  flowControl: ['none', 'hardware'],
};

/** Null when the settings are sound, else 'serial-bad-settings'. A field the design does not have is refused. */
export function checkSerialSettings(s: unknown): null | 'serial-bad-settings' {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return 'serial-bad-settings';
  const settings = s as Record<string, unknown>;
  const speed = settings.baudRate;
  if (typeof speed !== 'number' || !Number.isInteger(speed) || speed < SPEED_MIN || speed > SPEED_MAX) return 'serial-bad-settings';
  for (const name of Object.keys(settings)) {
    if (name === 'baudRate') continue;
    const allowed = FIELDS[name];
    if (allowed === undefined) return 'serial-bad-settings';
    if (settings[name] !== undefined && !allowed.includes(settings[name])) return 'serial-bad-settings';
  }
  return null;
}

/** Null when `bytes` is a Uint8Array of 1 to SERIAL_WRITE_MAX bytes, else 'serial-too-large'. */
export function checkSerialWrite(bytes: unknown): null | 'serial-too-large' {
  // By tag, not instanceof: the bytes come from another frame, whose Uint8Array is another one.
  if (Object.prototype.toString.call(bytes) !== '[object Uint8Array]') return 'serial-too-large';
  const length = (bytes as Uint8Array).byteLength;
  return length >= 1 && length <= SERIAL_WRITE_MAX ? null : 'serial-too-large';
}

/** A wait as the studio will use it: a whole number from 0 to SERIAL_WAIT_MAX_MS. Other values are clamped. */
export function clampSerialWait(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(Math.floor(ms), SERIAL_WAIT_MAX_MS);
}
