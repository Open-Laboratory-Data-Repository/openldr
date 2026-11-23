import { randomUUID } from 'node:crypto';
import { ORDER_ORIGIN_SYSTEM } from '@openldr/forms';

// Helpers lab-reception.ts and lab-rejection.ts share. Module-internal: the package root does not
// export this file, so these generic names stay off @openldr/bootstrap's API. lab-reception.ts
// re-exports LAB_DESK_ORIGIN and ReceptionError, which were public before this file existed.

/** The tag code that says an order was registered at the lab's desk (ruling 14). */
export const LAB_DESK_ORIGIN = 'lab-desk';
const DATA_OPERATION = 'http://terminology.hl7.org/CodeSystem/v3-DataOperation';
/** A request the desk has voided: it no longer holds the order's number for a new registration. */
export const VOIDED = 'entered-in-error';
/** The statuses of a request no sample may be received for and no correction touches. */
export const NOT_LIVE: ReadonlySet<string> = new Set([VOIDED, 'revoked']);
/** What a typo correction may change (ruling 12). */
export const CHANGE_KEYS: ReadonlySet<string> = new Set(['priority', 'clinician', 'note', 'patientId']);

type Json = Record<string, unknown>;

/** Why reception refused. A refusal writes nothing. */
export class ReceptionError extends Error {
  constructor(readonly reason: 'not-found' | 'invalid' | 'conflict', message: string) {
    super(message);
    this.name = 'ReceptionError';
  }
}

export function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

export function invalid(message: string): ReceptionError {
  return new ReceptionError('invalid', message);
}

export function statusOf(sr: Json): string {
  return typeof sr['status'] === 'string' ? sr['status'] : 'unknown';
}

export function isLive(sr: Json): boolean {
  return !NOT_LIVE.has(statusOf(sr));
}

/** The Provenance of a desk write: what it wrote, how, and who did it. Every desk save carries one,
 *  saved in the same call, so all of them have this one shape. */
export function deskProvenance(
  targets: string[], activity: 'CREATE' | 'UPDATE', actor: string, recorded: string, reason?: string,
): Json {
  return {
    resourceType: 'Provenance',
    id: randomUUID(),
    target: targets.map((reference) => ({ reference })),
    recorded,
    activity: { coding: [{ system: DATA_OPERATION, code: activity }] },
    agent: [{ who: { display: actor } }],
    ...(reason ? { reason: [{ text: reason }] } : {}),
  };
}

export function isDeskOrder(sr: Json): boolean {
  const meta = sr['meta'];
  const tags = isObject(meta) && Array.isArray(meta['tag']) ? meta['tag'] : [];
  return tags.some((t) => isObject(t) && t['system'] === ORDER_ORIGIN_SYSTEM && t['code'] === LAB_DESK_ORIGIN);
}
