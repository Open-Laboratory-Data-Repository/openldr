# Releasing OpenLDR CE

The one-line installer (`install/install.sh`, `install/install.ps1`) pulls the
published images from GHCR. Until they are published, the installer scaffolds a
working directory but `docker compose pull` will fail — publish the images first.

**Before the images are published, run from source instead** with the developer
bootstrap (`install/development.sh` / `install/development.ps1`): it clones the
repo, `pnpm install`s, starts the dev backing services, resets the DB, and
prints the dev-run commands. See "Install from source" in the landing docs.

## Cutting a release

```
pnpm release --dry-run    # check every precondition, change nothing
pnpm release              # publish
```

The command refuses to publish a broken release. It checks all of these before anything is
pushed, and reports every problem at once:

1. Clean tree, on `main`, in sync with `origin`.
2. `package.json` version parses as `X.Y.Z` and is newer than the last `v*` tag (the first
   release has no tag to compare against, so this check is skipped).
3. No `vX.Y.Z` tag exists yet.
4. `:X.Y.Z` is not already published for **any** of the five images. All five are read, and the
   refusal names the ones that already carry the tag — a run that pushed some images and died
   before the rest leaves exactly that state.
5. `apps/web/src/landing/changelog.json` has no uncommitted changes. That is all this checks;
   it does **not** re-run the generator or compare its output, so it cannot tell a stale
   changelog from a fresh one. Precondition 1's clean-tree check already implies it. Run
   `pnpm make:changelog` and commit the result yourself before releasing.
6. Test gate green. A first failure is re-run alone, package by package, before it counts as a
   regression — this is usually a timeout under parallel load, not a real break (AGENTS.md
   `test-gate-flakiness-timeouts`). Which packages to retry is read out of turbo's own
   `Failed:` line; there is no operator-supplied override.

Then it pushes the five images, checks that every package is public (it cannot make them
public — see below), verifies by installing the published tag into a clean directory, and only
then creates the git tag, pushes it, and cuts the GitHub release with `latest.json` attached.

**The tag is last on purpose.** A `vX.Y.Z` tag exists only if that release is complete and
verified — so a failure part-way through leaves no tag, and no lab ever sees a half-release.

That last step is three commands, not one: `git tag`, `git push origin vX.Y.Z`, then
`gh release create`. If either of the last two fails, the script asks origin whether the tag is
actually there and **deletes it from origin and from your clone** before exiting non-zero,
printing what it rolled back. It asks rather than assuming, because a push can update the ref
server-side and still fail on the way back. If a rollback command itself fails, the script
prints the exact `git push origin --delete` / `git tag --delete` to run by hand — do that before
retrying, or the next run refuses on "tag already exists".

**Two windows the rollback cannot cover.** If you Ctrl-C between the push and
`gh release create`, the signal reaches the child process and the cleanup may never run. And if
`gh release create` fails partway through uploading assets, it can leave a draft release behind,
which nothing checks for. In both cases: check
`https://github.com/Open-Laboratory-Data-Repository/openldr/releases` and `git ls-remote --tags
origin` before re-running. **This rollback path has never executed** — see "What is NOT proven
by tests".

### The verification install leaves a stack running

Step 9 installs the published tag into a fresh temporary directory and starts it, on **ports 80
and 443**. Nothing tears it down — its logs are the evidence when a release fails verification.
Free the ports before releasing, and stop the stack afterwards with
`docker compose down` in the directory the script prints.

It is run with `--require-ready`, which makes install.sh's readiness timeout **fatal**. Without
that flag install.sh warns and exits 0 on a timeout — deliberate, because a real lab install must
leave a slow stack up — and the release step read only the exit code, so a crash-looping API
would have been tagged and published behind a wall of warnings. The default is unchanged;
`pnpm release` is the only caller that passes the flag.

### A failed push can leave some images published

`scripts/build-and-push.sh` builds and pushes the five images in a loop. A failure in the middle
leaves the earlier ones pushed at `:X.Y.Z`. Precondition 4 then refuses the retry and names them.

`pnpm release` has no `--allow-overwrite`; it will keep refusing that version. Two ways out:

- **Bump the version** in `package.json` and release the new number. This is the safe one.
- Only if that tag was never announced: re-push by hand with
  `bash scripts/build-and-push.sh --allow-overwrite`, then release that version by hand.

### Package visibility is not something the API can set

There is no GitHub API to change a container package's visibility. Measured 2026-08-17:
`PATCH orgs/<org>/packages/container/<image>` with `visibility=public` returns 404. New GHCR
packages default to private, and one private image 401s and aborts the whole
`docker compose pull`. So `pnpm release` only **checks** visibility after the push — it does
not and cannot set it. If any package is still private, the script refuses to tag, prints that
image's settings-page URL, and stops:

```
https://github.com/orgs/Open-Laboratory-Data-Repository/packages/container/<image>/settings
```

Flip each one to public there by hand, then re-run `pnpm release`.

### Prerequisites

Two separate credentials are needed here, and they are not interchangeable:

- **`gh` auth**, for the API checks — the overwrite guard, the visibility read-back, and
  creating the GitHub release. Run:
  `gh auth refresh -h github.com -s read:packages,write:packages`.
  `write:packages` implies read on GitHub, so a token that shows only `write:packages` in
  `gh auth status` is not a failed refresh — it already has what the release needs.
- **A `docker login ghcr.io` credential**, for the actual image push. This is a different
  credential from the `gh` CLI's own token. Log in with a PAT that has `write:packages` before
  running `pnpm release`.

### First release

`package.json` is currently at `0.1.0`, and `0.1.0` is already published: all five images
exist at `:0.1.0` and `:latest` (measured 2026-08-17; `openldr-api` alone carries 59 versions
from the old manual-publish flow). Precondition 4 will correctly refuse to re-cut `0.1.0` — so
the first `pnpm release` needs the version bumped to `0.1.1` or higher first. That refusal is
expected, not a bug.

### Releasing by hand

`scripts/build-and-push.sh` still works standalone and carries an overwrite guard of its own.
It is **not** the same one: it probes `openldr-api` only, where `pnpm release`'s precondition 4
reads all five images. Pass `--allow-overwrite` only to republish a version that was never
announced.

### What is NOT proven by tests

`scripts/release.ts` **has no unit tests, by design** — it only gathers facts and sequences
commands, and every decision it appears to make lives in `packages/release`, which is tested.
So nothing in the suite covers the code in that file: the `pnpm`/`gh` spawn helpers and their
Windows `shell: true` guard, the `gh api --paginate` wiring, the step-10 tag/push/release
sequence, or its rollback. Those are proven only by running a real release.

Nothing in the suite touches a real registry either, so the package-visibility read-back is
also real-release-only. The gate-retry loop is unproven against a genuinely red turbo run — the
tests exercise `parseFailedTasks` against captured output, not a live failing suite.

What *is* unit-tested, with injected inputs: semver comparison, each precondition's refusal,
the manifest shape, the registry probes (`tagExistsInRegistry`, `imagesWithTag`,
`findPrivatePackages`) including their fail-closed behaviour on an unreadable body, pagination
across `gh api --paginate` pages (`parseGhPages`), `build-and-push.sh`'s overwrite guard against
a fake `gh`, `install/lib/resolve-version.sh`, and `install.sh`'s readiness gate — that a
timeout warns and exits 0 by default, and exits non-zero under `--require-ready`. Those shell
tests run the real scripts against fake `gh`/`docker`/`curl` binaries on `PATH`; they are in
`packages/release/src/shell.test.ts` and take about 35s.

The installer's `--version` flag defaults to `latest`, the moving tag — no release has
published `latest.json` yet, so defaulting to `auto` would break the one-line install today.
Pass `--version auto` to resolve the newest published release into a concrete
`OPENLDR_VERSION` written to `.env`; pass `--version 0.1.9` to pin deliberately. If `auto`
cannot resolve, the installer stops rather than falling back to `latest`, so a lab never
silently ends up on a moving tag. This default flips to `auto` once the first release publishes
`latest.json` — it has not yet.

## Verifying the installer end-to-end

After the first push:

```
bash install/install.sh --dir /tmp/openldr-e2e --version 0.1.0
```

Expected: the stack pulls, comes up healthy, and https://localhost serves the
studio SPA.

## Follow-up (Approach B)

Automate build + push + a GitHub release (with the compose bundle attached) via
GitHub Actions on tag push. Not yet implemented.
