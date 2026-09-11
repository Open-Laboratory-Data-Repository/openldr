/** How a release run ended, as far as cleanup cares. */
export type ReleaseOutcome = 'released' | 'failed';

/** What to remove once a release run is over. */
export interface CleanupPlan {
  /** `docker compose down -v` the verification stack step 9 started. */
  teardownStack: boolean;
  /** Delete the `openldr-release-*` scratch directory. */
  removeDir: boolean;
}

/** Decide what a finished release run should clean up.
 *
 *  Step 9 installs the published tag into a fresh `openldr-release-*` directory and starts it on
 *  ports 80 and 443. Nothing used to tear it down, and two kinds of debris piled up:
 *
 *  - After a real release, a full second stack stayed running. It holds 80 and 443, so the NEXT
 *    release's verification install collides with it. Nobody needs its logs once the version is
 *    published, so it goes.
 *  - After a dry run, an EMPTY directory. `run()` skips the install under `--dry-run`, but
 *    `mkdtempSync` creates the directory regardless. No stack exists, so only the directory goes.
 *
 *  A failed run keeps everything. RELEASE.md: the stack's logs are the evidence when a release
 *  fails verification, and a live stack lets the operator inspect it. The caller prints
 *  `teardownCommand` instead, for when they are done. */
export function cleanupPlan(input: { dryRun: boolean; outcome: ReleaseOutcome }): CleanupPlan {
  if (input.outcome === 'failed') return { teardownStack: false, removeDir: false };
  return { teardownStack: !input.dryRun, removeDir: true };
}

/** The command an operator runs to remove a verification stack kept after a failure.
 *
 *  Quoted because `mkdtempSync` returns a path under the user's profile, which can contain a
 *  space, and the operator copies this straight into a shell. `-v` removes the stack's volumes
 *  too: it is a throwaway install with nothing worth keeping. */
export function teardownCommand(dir: string): string {
  return `cd "${dir}" && docker compose down -v`;
}
