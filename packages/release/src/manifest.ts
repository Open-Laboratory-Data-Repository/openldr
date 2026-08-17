import { parseSemver } from '@openldr/core/pure';

/** The published `latest.json`. Exactly three fields — Project B reads only these. */
export interface ReleaseManifest {
  version: string;
  releasedAt: string;
  notesUrl: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildReleaseManifest(input: {
  version: string;
  releasedAt: string;
  owner: string;
  repo: string;
}): ReleaseManifest {
  if (!parseSemver(input.version)) throw new Error(`not a version: ${input.version}`);
  if (!DATE_RE.test(input.releasedAt)) throw new Error(`releasedAt must be YYYY-MM-DD: ${input.releasedAt}`);
  return {
    version: input.version,
    releasedAt: input.releasedAt,
    notesUrl: `https://github.com/${input.owner}/${input.repo}/releases/tag/v${input.version}`,
  };
}

/** Parse a manifest fetched from the network. Returns null rather than throwing: a malformed
 *  file must degrade to "no update known", never to a crash in the consumer.
 *
 *  Unknown keys are ignored on purpose — adding a fourth field in a future release must not
 *  break installs running today's parser. */
export function parseReleaseManifest(raw: unknown): ReleaseManifest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || typeof r.releasedAt !== 'string' || typeof r.notesUrl !== 'string') {
    return null;
  }
  if (!parseSemver(r.version)) return null;
  if (!DATE_RE.test(r.releasedAt)) return null;
  return { version: r.version, releasedAt: r.releasedAt, notesUrl: r.notesUrl };
}
