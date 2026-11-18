import type { JobInterruption } from '@openldr/db';

const CAUSE: Record<JobInterruption['cause'], string> = {
  'server-restart': 'the server restarted',
  'lease-expired': 'it stopped answering',
  'attempts-exhausted': 'it ran out of attempts',
};

/** One interruption as a CLI line, the same words as the studio badge:
 *  "  interrupted 2026-11-18T05:00:00.000Z (the server restarted); carried on by itself 2026-11-18T05:02:10.000Z". */
export function describeInterruption(r: JobInterruption): string {
  const how = r.resumedBy === 'self' ? `carried on by itself ${r.resumedAt}`
    : r.resumedBy === 'person' ? `continued by a person ${r.resumedAt}${r.continuedAs ? ` as ${r.continuedAs}` : ''}`
      : 'waiting for Continue';
  return `  interrupted ${r.at} (${CAUSE[r.cause]}); ${how}`;
}
