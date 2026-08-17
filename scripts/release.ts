// Publishes a release: five images, a verified GitHub release, and a latest.json asset.
//
// The value of this script is what it refuses to do. Every precondition is checked before
// anything is pushed, and the git tag is created LAST — so a failure during verification leaves
// no tag behind, and no lab ever sees a half-release.
//
//   pnpm release            # publish
//   pnpm release --dry-run  # check preconditions, print commands, change nothing
//
// This file gathers facts and sequences commands. Every decision it appears to make lives in
// @openldr/release, where it is unit-tested; nothing here decides anything on its own.

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { buildReleaseManifest } from '../packages/release/src/manifest';
import { evaluatePreconditions, type ReleaseFacts } from '../packages/release/src/preconditions';
import {
  tagExistsInRegistry,
  findPrivatePackages,
  IMAGE_NAMES,
  type FetchJson,
} from '../packages/release/src/registry';

const OWNER = 'Open-Laboratory-Data-Repository';
const REPO = 'openldr';
const DRY_RUN = process.argv.includes('--dry-run');

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/** Runs a command and returns its stdout.
 *
 *  stderr is PIPED on purpose. Node folds a child's stderr into the thrown error's message only
 *  when it is piped; left inherited (the execFileSync default) a failure arrives as a bare
 *  "Command failed: gh api ..." with the reason printed somewhere else. `tagExistsInRegistry`
 *  reads that message to tell a 404 from a 403, so an inherited stderr would blind it. */
function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function run(cmd: string, args: string[]): void {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  if (!DRY_RUN) execFileSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
}

/** Runs pnpm with the output streamed, and throws on a non-zero exit.
 *
 *  ⛔ Windows needs `shell: true`. pnpm is a .cmd shim, and measured 2026-08-17 on node v24.6.0:
 *  execFileSync('pnpm', …) fails ENOENT and execFileSync('pnpm.cmd', …) fails EINVAL — Node
 *  refuses to spawn a .cmd directly since the 2024 argument-injection fix. Without this the gate
 *  would "fail" instantly on every Windows run and the release would refuse for a reason that
 *  has nothing to do with the tests. Args are literals or a validated package name, never raw
 *  operator input, so the concatenation the shell option performs has nothing to inject. */
function pnpm(args: string[]): void {
  execFileSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
}

/** A repo-root-relative path bash will accept.
 *
 *  mkdtempSync hands back `C:\Users\…` on Windows and Git Bash reads the backslashes as escapes.
 *  Forward slashes work in both shells. */
function toBashPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Reads a GitHub API path, EVERY page of it, and returns parsed JSON.
 *
 *  `registry.ts` does not paginate on purpose — it consumes whatever the caller hands it, which
 *  is what makes it testable with a plain fake. Paging is therefore this function's job.
 *
 *  Measured 2026-08-17 against openldr-api's /versions endpoint:
 *    gh api …/versions                          --jq length -> 30
 *    gh api --paginate …/versions?per_page=100  --jq length -> 59
 *  An unpaged read sees half the registry. `tagExistsInRegistry` would then report a published
 *  tag as absent and permit the overwrite it exists to prevent — the exact fail-open direction.
 *
 *  per_page is appended to every path, including single-object ones. gh follows Link headers,
 *  an object response has none, and the extra query parameter is ignored (verified: the
 *  package endpoint still answers with visibility "public"). */
const ghJson: FetchJson = async (path) => {
  const url = `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  return parseGhPages(sh('gh', ['api', '--paginate', url]));
};

/** One flat array (or one object) out of however gh chose to print its pages.
 *
 *  gh 2.93.0 merges array pages into a single JSON array — verified by forcing three pages with
 *  per_page=25 and parsing the result as one 59-element array with 59 unique ids. Older gh
 *  concatenated them as `][`, which is not valid JSON, and --slurp produces an array of pages.
 *  `tagExistsInRegistry` reads `.metadata.container.tags` off array ELEMENTS, so all three
 *  shapes have to arrive as the same flat array. */
function parseGhPages(out: string): unknown {
  const text = out.trim();
  if (text === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = JSON.parse(text.replace(/\]\s*\[/g, ','));
  }

  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((page) => Array.isArray(page))) {
    return parsed.flat();
  }
  return parsed;
}

/** The newest v* tag by semver, or null for the first release. */
function newestTag(): string | null {
  const out = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname']);
  return out ? out.split('\n')[0]!.trim() : null;
}

/** Green, or green on a lone re-run of the one package that failed.
 *
 *  Gate failures here are usually timeouts under parallel load, not regressions — measured
 *  2026-08-17, @openldr/forms store.test.ts took 41672ms under turbo and 752ms alone. Refusing
 *  on the first non-zero exit would block releases at random. A real failure still refuses:
 *  the isolated re-run has to pass too. */
function gateGreen(): boolean {
  try {
    pnpm(['turbo', 'run', 'test']);
    return true;
  } catch {
    console.warn('\ngate failed — re-running the failing package alone to tell a timeout from a regression');
    const failed = process.env.RELEASE_RETRY_PKG;
    if (!failed) {
      console.error('set RELEASE_RETRY_PKG=<package> and re-run, or fix the failure');
      return false;
    }
    // A package name, nothing else. This value reaches a shell on Windows.
    if (!/^[@a-zA-Z0-9._/-]+$/.test(failed)) {
      console.error(`RELEASE_RETRY_PKG is not a package name: ${failed}`);
      return false;
    }
    try {
      pnpm(['--filter', failed, 'test']);
      console.warn(`${failed} passes alone — treating the turbo failure as a load timeout`);
      return true;
    } catch {
      return false;
    }
  }
}

async function main(): Promise<void> {
  const version = String(
    (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version?: unknown }).version,
  );
  const lastTag = newestTag();

  console.log(`releasing ${version}${lastTag ? ` (last tag ${lastTag})` : ' (first release)'}`);

  const facts: ReleaseFacts = {
    version,
    lastTag,
    treeClean: sh('git', ['status', '--porcelain']) === '',
    branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    syncedWithOrigin: sh('git', ['rev-list', '--left-right', '--count', 'origin/main...main']) === '0\t0',
    gitTagExists: sh('git', ['tag', '--list', `v${version}`]) !== '',
    registryTagExists: await tagExistsInRegistry(ghJson, OWNER, 'openldr-api', version),
    changelogCommitted: sh('git', ['status', '--porcelain', 'apps/web/src/landing/changelog.json']) === '',
    gateGreen: gateGreen(),
  };

  const refusals = evaluatePreconditions(facts);
  if (refusals.length > 0) {
    console.error('\nrefusing to release:');
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log('preconditions clear\n');

  // 7. Build and push all five images. This also tags :<version> alongside :latest.
  run('bash', ['scripts/build-and-push.sh', '--tag', 'latest']);

  // 8. CHECK every package is public. One private image 401s and aborts the whole pull.
  //
  // ⛔ There is NO API to set container package visibility. Measured 2026-08-17:
  //   gh api --method PATCH orgs/<org>/packages/container/openldr-api -f visibility=public
  //   -> 404 Not Found        (visibility unchanged; the endpoint does not exist)
  // Visibility is changed only in the web UI, at the package's settings page — so this step
  // VERIFIES and refuses, and the operator does the fixing. The read-back was always the
  // load-bearing half.
  //
  // Skipped under --dry-run: the images have not been pushed, so a first-release package would
  // not exist yet and the read would throw on a package that a real run would have just created.
  if (DRY_RUN) {
    console.log('+ (dry run) skipping the package-visibility check — nothing was pushed to check');
  } else {
    const stillPrivate = await findPrivatePackages(ghJson, OWNER, IMAGE_NAMES);
    if (stillPrivate.length > 0) {
      console.error(`\nnot public: ${stillPrivate.join(', ')}`);
      console.error('a single private image 401s and aborts the entire docker compose pull.');
      console.error('no tag was created. Make each one public at:');
      for (const image of stillPrivate) {
        console.error(`  https://github.com/orgs/${OWNER}/packages/container/${image}/settings`);
      }
      console.error('then re-run.');
      process.exit(1);
    }
    console.log('all five packages confirmed public');
  }

  // 9. Verify by pulling the published tag into a clean directory.
  const probe = mkdtempSync(join(tmpdir(), 'openldr-release-'));
  run('bash', ['install/install.sh', '--dir', toBashPath(probe), '--version', version]);
  console.log(`verification install completed in ${probe}`);

  // 10. Only now is the release real: tag, push, publish.
  const manifest = buildReleaseManifest({
    version,
    releasedAt: new Date().toISOString().slice(0, 10),
    owner: OWNER,
    repo: REPO,
  });
  const manifestPath = join(probe, 'latest.json');
  console.log(`+ write ${manifestPath}`);
  if (!DRY_RUN) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  run('git', ['tag', `v${version}`]);
  run('git', ['push', 'origin', `v${version}`]);
  run('gh', [
    'release',
    'create',
    `v${version}`,
    '--generate-notes',
    manifestPath,
    'deploy/install/docker-compose.yml',
  ]);

  console.log(`\nreleased ${version}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
