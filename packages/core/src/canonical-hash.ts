import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json';

/** SHA-256 hex digest of the canonical JSON form. Stable across key reordering.
 *
 *  ⚠ Node-only (`node:crypto`) — split out of `./canonical-json` so that file can be re-exported
 *  browser-safe via `./pure` without dragging this in. Server-side stores import it via the main
 *  `@openldr/core` barrel, unaffected by this split. */
export function canonicalHash(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex');
}
