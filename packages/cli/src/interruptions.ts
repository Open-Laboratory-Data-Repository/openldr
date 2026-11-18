import type { JobInterruption, JobInterruptionStore } from '@openldr/db';

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

/** cdr-source runs (imports, copies, checks) with each one's interruptions: the JSON gains an
 *  `interruptions` field and the text a line per cut under each run. No store, no cuts. */
export async function withCdrCuts<T extends { id: string }, J extends object>(
  store: Pick<JobInterruptionStore, 'listFor'> | undefined,
  runs: T[],
  forJson: (r: T) => J,
  format: (r: T) => string,
): Promise<{ json: Array<J & { interruptions: JobInterruption[] }>; text: string }> {
  const cuts = store && runs.length > 0 ? await store.listFor('cdr-run', runs.map((r) => r.id)) : new Map<string, JobInterruption[]>();
  return {
    json: runs.map((r) => ({ ...forJson(r), interruptions: cuts.get(r.id) ?? [] })),
    text: runs.map((r) => [format(r), ...(cuts.get(r.id) ?? []).map(describeInterruption)].join('\n')).join('\n'),
  };
}
