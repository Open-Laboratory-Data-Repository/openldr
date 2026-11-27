// The one place that touches the browser's real serial feature.

import type { SerialLike } from './serial-gate';

/** navigator.serial as a SerialLike, or undefined when the browser has none or the page is not a
 *  secure context. */
export function nativeSerial(nav: Navigator, secure: boolean): SerialLike | undefined {
  if (!secure) return undefined;
  const serial = (nav as unknown as { serial?: unknown }).serial;
  return typeof serial === 'object' && serial !== null ? (serial as SerialLike) : undefined;
}

/** Which refusal an error from the real feature means, by its name:
 *   NotFoundError                  -> 'serial-cancelled'   (the person closed the list)
 *   SecurityError, NotAllowedError -> 'serial-unavailable' (a policy or the app said no)
 *   anything else                  -> 'serial-failed'      (the device or the system) */
export function refusalOf(err: unknown): 'serial-cancelled' | 'serial-unavailable' | 'serial-failed' {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === 'NotFoundError') return 'serial-cancelled';
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'serial-unavailable';
  return 'serial-failed';
}
