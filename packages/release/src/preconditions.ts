import { isNewerVersion, parseSemver } from '@openldr/core/pure';

export interface ReleaseFacts {
  /** The version in package.json — the single source of truth for what is being released. */
  version: string;
  /** Newest existing v* tag, or null for the very first release. */
  lastTag: string | null;
  treeClean: boolean;
  branch: string;
  syncedWithOrigin: boolean;
  gitTagExists: boolean;
  registryTagExists: boolean;
  changelogCommitted: boolean;
  gateGreen: boolean;
}

/** Every reason this release must not proceed. Empty means clear to publish.
 *
 *  All checks run — the operator sees every problem at once rather than fixing them one
 *  round-trip at a time. */
export function evaluatePreconditions(f: ReleaseFacts): string[] {
  const refusals: string[] = [];

  if (!parseSemver(f.version)) {
    refusals.push(`package.json version is not a X.Y.Z version: ${f.version}`);
  }
  if (!f.treeClean) {
    refusals.push('working tree is dirty — commit or stash before releasing');
  }
  if (f.branch !== 'main') {
    refusals.push(`releases are cut from main, not ${f.branch}`);
  }
  if (!f.syncedWithOrigin) {
    refusals.push('local main and origin/main differ — push or pull before releasing');
  }
  // Only meaningful once the version parses. Without this guard an unparseable version also
  // trips the bump check, telling the operator to "bump it first" when the real problem is
  // that the string is not a version at all.
  if (parseSemver(f.version) && f.lastTag !== null && !isNewerVersion(f.version, f.lastTag)) {
    refusals.push(
      `package.json version ${f.version} is not newer than the last tag ${f.lastTag} — bump it first`,
    );
  }
  if (f.gitTagExists) {
    refusals.push(`tag v${f.version} already exists — a released version is never re-cut`);
  }
  if (f.registryTagExists) {
    refusals.push(
      `image tag ${f.version} is already in the registry — overwriting it would change what ` +
        `that version means for every install already running it`,
    );
  }
  if (!f.changelogCommitted) {
    refusals.push('landing changelog is stale — run pnpm make:changelog and commit it (AGENTS.md §6)');
  }
  if (!f.gateGreen) {
    refusals.push('test gate is red — releases are cut from a green gate only');
  }

  return refusals;
}
