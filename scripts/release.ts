// Publishes a release: five images, a verified GitHub release, and a latest.json asset.
//
// The value of this script is what it refuses to do. Every precondition is checked before
// anything is pushed, and the git tag is created LAST — so a failure during verification leaves
// no tag behind, and no lab ever sees a half-release. The tag/push/release sequence at the end
// is three commands, so it unwinds the tag itself if a later one fails (see step 10).
//
//   pnpm release            # publish
//   pnpm release --dry-run  # check preconditions, print commands, change nothing
//
// This file gathers facts and sequences commands. Every decision it appears to make lives in
// @openldr/release, where it is unit-tested; nothing here decides anything on its own.
//
// The consequence: this file has NO tests. The sequencing, the spawn helpers, and the step-10
// rollback are proven only by a real release. RELEASE.md says so under "What is NOT proven by
// tests" — keep that list honest when editing here.

import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { resolveGitBash } from '../packages/release/src/git-bash';
import { buildReleaseManifest } from '../packages/release/src/manifest';
import { evaluatePreconditions, type ReleaseFacts } from '../packages/release/src/preconditions';
import {
  imagesWithTag,
  findPrivatePackages,
  parseGhPages,
  IMAGE_NAMES,
  type FetchJson,
} from '../packages/release/src/registry';
import { parseFailedTasks, formatFailedTask } from '../packages/release/src/gate';

const OWNER = 'Open-Laboratory-Data-Repository';
const REPO = 'openldr';
const DRY_RUN = process.argv.includes('--dry-run');

// ⛔ Not the literal 'bash'. On Windows with WSL installed that is the WSL launcher,
// which cannot run these scripts — it stopped a release dead at step 7 with every
// precondition already green.
const BASH = resolveGitBash();

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

/** Runs pnpm, prints its output as it arrives, AND returns that output with the exit code.
 *
 *  The gate needs both: the operator has to watch a seven-minute run, and `gateGreen` has to
 *  read which packages turbo said failed. Inheriting the streams gives the first and not the
 *  second, so this tees them instead.
 *
 *  ⛔ Windows needs `shell: true`. pnpm is a .cmd shim, and measured 2026-08-17 on node v24.6.0:
 *  execFileSync('pnpm', …) fails ENOENT and execFileSync('pnpm.cmd', …) fails EINVAL — Node
 *  refuses to spawn a .cmd directly since the 2024 argument-injection fix. Without this the gate
 *  would "fail" instantly on every Windows run and the release would refuse for a reason that
 *  has nothing to do with the tests. Args are literals or a package name `parseFailedTasks`
 *  matched against a package-name pattern, never raw operator input, so the concatenation the
 *  shell option performs has nothing to inject. */
function pnpm(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ] as const) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        output += chunk;
        sink.write(chunk);
      });
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
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

/** The newest v* tag by semver, or null for the first release. */
function newestTag(): string | null {
  const out = sh('git', ['tag', '--list', 'v*', '--sort=-v:refname']);
  return out ? out.split('\n')[0]!.trim() : null;
}

/** Green, or green on a lone re-run of exactly the tasks turbo said failed.
 *
 *  Gate failures here are usually timeouts under parallel load, not regressions — measured
 *  2026-08-17, @openldr/forms store.test.ts took 41672ms under turbo and 752ms alone. Refusing
 *  on the first non-zero exit would block releases at random. A real failure still refuses:
 *  every isolated re-run has to pass too.
 *
 *  ⛔ The operator does not name the package to retry, and never did have the right to. The
 *  name is read out of turbo's own summary. The env var this replaced was never checked against
 *  what actually failed, and `pnpm --filter <typo> test` EXITS 0 — measured 2026-08-17,
 *  `pnpm --filter @openldr/does-not-exist test` -> exit 0 — so one mistyped character turned a
 *  regression into "passes alone" and shipped five images off a red tree.
 *
 *  --fail-if-no-match makes that impossible a second way: measured on pnpm 11.13.0, the same
 *  filter exits 1 with it and 0 without. */
async function gateGreen(): Promise<boolean> {
  // ⛔ --concurrency=4, not turbo's default. This box has 12 CPUs and 35 test tasks, each
  // spawning its own vitest with workers up to the core count, so the default oversubscribes and
  // tests fail on `Test timed out` rather than on anything real. Measured 2026-08-19 on a cold
  // cache: the default failed 4 of 4 runs, each on a DIFFERENT package, every one passing when
  // run alone; --concurrency=4 passed 35/35.
  //
  // ⚠ The five releases before this one passed at the default only because 29 to 33 of the 35
  // tasks came from cache, so almost nothing ran concurrently. That is luck, not evidence, and it
  // runs out on exactly the release that changes the most packages. The retry loop below would
  // have caught it, but a release should not depend on its own recovery path.
  const gate = await pnpm(['turbo', 'run', 'test', '--concurrency=4']);
  if (gate.code === 0) return true;

  const failed = parseFailedTasks(gate.output);
  if (failed.length === 0) {
    console.error('\ngate failed and no "Failed:" line could be read from turbo’s output.');
    console.error('an unreadable failure is not a timeout — refusing.');
    return false;
  }

  const names = failed.map(formatFailedTask).join(', ');
  console.warn(`\ngate failed — re-running ${names} alone to tell a timeout from a regression`);
  for (const t of failed) {
    const retry = await pnpm(['--filter', t.pkg, '--fail-if-no-match', 'run', t.task]);
    if (retry.code !== 0) {
      console.error(`\n${formatFailedTask(t)} fails alone too — that is a regression, not a load timeout`);
      return false;
    }
  }
  console.warn(`\n${names} pass alone — treating the turbo failure as a load timeout`);
  return true;
}

async function main(): Promise<void> {
  const version = String(
    (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version?: unknown }).version,
  );
  // ⛔ `newestTag()` must be read AFTER the fetch below, not before. It reads local tags, and the
  // "version is not newer than the last tag" refusal depends on it. Unfetched, an operator whose
  // origin already carries v0.2.0 sees only v0.1.0 locally, the refusal never fires, and 0.1.5
  // publishes on top of 0.2.0. `gitTagExists` and the registry check do not cover this — both
  // test equality, not ordering.
  //
  // `origin/main...main` reads a LOCAL tracking ref. Without a fetch it holds whatever the last
  // fetch left there, so an operator who has not fetched gets 0<TAB>0 — "synced" — while origin
  // is ahead.
  //
  // This runs under --dry-run too, and uses sh() rather than run() to make sure of it. Fetching
  // is read-only — it moves no local branch and touches no working tree — and a dry run whose
  // whole job is checking preconditions must not check this one against a stale ref.
  console.log('+ git fetch origin');
  sh('git', ['fetch', 'origin', '--tags']);

  const lastTag = newestTag();
  console.log(`releasing ${version}${lastTag ? ` (last tag ${lastTag})` : ' (first release)'}`);

  const facts: ReleaseFacts = {
    version,
    lastTag,
    treeClean: sh('git', ['status', '--porcelain']) === '',
    branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    syncedWithOrigin: sh('git', ['rev-list', '--left-right', '--count', 'origin/main...main']) === '0\t0',
    gitTagExists: sh('git', ['tag', '--list', `v${version}`]) !== '',
    // ⛔ All FIVE images, not openldr-api alone. build-and-push.sh pushes them in a loop, so a
    // run that died part-way — or a hand push — leaves the tag on some images and not others.
    // Probing one of them reported the version free and the next run silently overwrote the
    // rest. The refusal names which images are already published so the operator can act.
    registryTagImages: await imagesWithTag(ghJson, OWNER, IMAGE_NAMES, version),
    changelogCommitted: sh('git', ['status', '--porcelain', 'apps/web/src/landing/changelog.json']) === '',
    gateGreen: await gateGreen(),
  };

  const refusals = evaluatePreconditions(facts);
  if (refusals.length > 0) {
    console.error('\nrefusing to release:');
    for (const r of refusals) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log('preconditions clear\n');

  // 7. Build and push all five images. This also tags :<version> alongside :latest.
  run(BASH, ['scripts/build-and-push.sh', '--tag', 'latest']);

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
  //
  // ⛔ --require-ready is what makes this step a check at all. install.sh's readiness wait is
  // non-fatal by default — it prints `! api still starting` and exits 0 — so without the flag
  // this step read the exit code of a script that cannot fail, and an API that crash-loops on a
  // bad migration would have been tagged and published behind a wall of warnings.
  //
  // The stack it starts is left RUNNING on ports 80/443 (see RELEASE.md); nothing here tears it
  // down, because its logs are the evidence when the verification fails.
  const probe = mkdtempSync(join(tmpdir(), 'openldr-release-'));
  run(BASH, ['install/install.sh', '--dir', toBashPath(probe), '--version', version, '--require-ready']);
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

  // ⛔ Three irreversible commands, not one. `git tag` then `git push` then `gh release create`:
  // if the last one fails — asset upload, network, rate limit — a PUBLIC tag exists with no
  // release and no latest.json, and every re-run then refuses forever on gitTagExists. That is
  // exactly the half-release the "tag last" design exists to prevent, so the tag is unwound.
  //
  // Deletion is ordered remote-then-local: the remote tag is the one labs and the releases page
  // can see. If a rollback step itself fails the operator is told the exact commands, because at
  // that point only a human can finish it.
  let taggedLocally = false;
  let pushedToOrigin = false;
  try {
    run('git', ['tag', `v${version}`]);
    taggedLocally = !DRY_RUN;
    run('git', ['push', 'origin', `v${version}`]);
    pushedToOrigin = !DRY_RUN;
    run('gh', [
      'release',
      'create',
      `v${version}`,
      '--generate-notes',
      manifestPath,
      'deploy/install/docker-compose.yml',
    ]);
  } catch (err) {
    console.error(`\nrelease of v${version} failed: ${err instanceof Error ? err.message : String(err)}`);
    const rolledBack: string[] = [];
    const stuck: string[] = [];
    // ⛔ Ask the REMOTE, do not trust `pushedToOrigin`. `git push` can update the ref
    // server-side and then die reading the response (RPC failed / early EOF), leaving the flag
    // false while a public tag exists. Ctrl-C between the push and `gh release create` does the
    // same — execFileSync inherits the signal, so this catch may not even run. A stale `false`
    // there would skip the remote delete AND print "no tag survives", which is the opposite of
    // the truth. Asking costs one network round-trip on a path that has already failed.
    let onOrigin = pushedToOrigin;
    if (!DRY_RUN) {
      try {
        onOrigin = sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`]) !== '';
      } catch {
        // Cannot reach origin to ask. Assume the worst — a tag we cannot see is still a tag.
        onOrigin = true;
      }
    }
    if (onOrigin) {
      try {
        run('git', ['push', 'origin', '--delete', `v${version}`]);
        rolledBack.push('the tag on origin');
      } catch {
        stuck.push(`git push origin --delete v${version}`);
      }
    }
    if (taggedLocally) {
      try {
        run('git', ['tag', '--delete', `v${version}`]);
        rolledBack.push('the local tag');
      } catch {
        stuck.push(`git tag --delete v${version}`);
      }
    }
    console.error(
      rolledBack.length > 0 ? `rolled back: ${rolledBack.join(' and ')}` : 'nothing to roll back — no tag was created',
    );
    if (stuck.length > 0) {
      console.error('⛔ rollback did not finish. Run these by hand before retrying:');
      for (const cmd of stuck) console.error(`  ${cmd}`);
    } else {
      console.error(`no v${version} tag survives, so this release can be re-run once the cause is fixed.`);
    }
    // The images ARE pushed by this point — step 7 ran. So the registry precondition will now
    // refuse this same version on the next run, and `pnpm release` has no way past it.
    console.error(`the five images at :${version} were already pushed, so a re-run refuses on the registry check.`);
    console.error('bump the version, or — only if this tag was never announced — re-push by hand with');
    console.error('  bash scripts/build-and-push.sh --allow-overwrite');
    process.exit(1);
  }

  console.log(`\nreleased ${version}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
