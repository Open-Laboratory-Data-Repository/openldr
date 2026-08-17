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
4. `:X.Y.Z` is not already published for any of the five images.
5. Landing changelog regenerated and committed.
6. Test gate green. A first failure is re-run alone, package by package, before it counts as a
   regression — this is usually a timeout under parallel load, not a real break (AGENTS.md
   `test-gate-flakiness-timeouts`). Which packages to retry is read out of turbo's own
   `Failed:` line; there is no operator-supplied override.

Then it pushes the five images, checks that every package is public (it cannot make them
public — see below), verifies by installing the published tag into a clean directory, and only
then creates the git tag, pushes it, and cuts the GitHub release with `latest.json` attached.

**The tag is last on purpose.** A `vX.Y.Z` tag exists only if that release is complete and
verified — so a failure part-way through leaves no tag, and no lab ever sees a half-release.

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

`scripts/build-and-push.sh` still works standalone and carries the same overwrite guard. Pass
`--allow-overwrite` only to republish a version that was never announced.

### What is NOT proven by tests

Nothing in the suite touches a real registry, so two steps are proven only by running a real
release: the package-visibility read-back, and the verification install. The gate-retry loop is
also unproven against a genuinely red turbo run — the tests exercise `parseFailedTasks` against
captured output, not a live failing suite.

Everything else is unit-tested with injected inputs: semver comparison, each precondition's
refusal, the manifest shape, the registry probes (`tagExistsInRegistry`, `findPrivatePackages`),
pagination across `gh api --paginate` pages (`parseGhPages`), and the Windows/shell guards
around spawning `pnpm` and `gh`.

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
