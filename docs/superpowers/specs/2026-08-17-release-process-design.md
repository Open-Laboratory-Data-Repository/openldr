# A release you can point an operator at — Design

**Status:** approved, not implemented
**Project A of two.** Project B (the in-app update notice) reads what this publishes.
B is specced separately and is not started.

## The problem

There is no release. `git tag` holds two tags, neither a release. `gh release list` is empty.
Every install pins `${OPENLDR_VERSION:-latest}` (`deploy/install/docker-compose.yml:6`), and
`install/install.sh:28` defaults `VERSION="latest"`.

So a lab tracks a moving tag. `docker compose pull` jumps it to whatever was pushed last, and
the API runs pending migrations at boot with no operator present. There is no way to ask for
one specific version, and nothing to roll back to.

A second problem sits behind the first. `scripts/build-and-push.sh:31` derives the image tag
from `package.json`, which has never moved off `0.1.0`. Re-running the publish script therefore
**overwrites** `:0.1.0` with different content. A version tag that silently changes is worse
than `latest`: `latest` at least advertises that it moves. `readAppVersion()`
(`apps/server/src/version.ts:11`) reads that same `package.json`, so the About card would report
a number that no longer identifies anything.

## What this builds

A single command, `pnpm release`, that publishes a version and refuses to publish a broken one.

Semver-tagged images already work — `build-and-push.sh:43` dual-tags `:$TAG` and `:$VERSION`.
What is missing is everything that makes a version tag mean something.

## The artifacts

Four, plus one invariant.

| Artifact | Where |
|---|---|
| Five images, `:X.Y.Z` and `:latest` | `ghcr.io/open-laboratory-data-repository/openldr-{api,studio,web,gateway,keycloak}` |
| `vX.Y.Z` git tag | the repo |
| GitHub release, compose bundle attached | GitHub |
| `latest.json` | asset on that release |

**Invariant: a `vX.Y.Z` tag exists only if that release is complete and verified.**

The tag is pushed last, after the images are confirmed public and pullable. This makes the tag
list a truthful record of what shipped. It also makes the landing changelog's version chips
render, which today they never do — those need `v*` tags to exist, which is why all 271 entries
show as dated but unversioned.

### `latest.json`

Three fields. Project B reads only these.

```json
{
  "version": "0.2.0",
  "releasedAt": "2026-08-20",
  "notesUrl": "https://github.com/Open-Laboratory-Data-Repository/openldr/releases/tag/v0.2.0"
}
```

Published as a **release asset**, so it is readable at a permanent URL:

```
https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json
```

That URL always redirects to the newest release. It is a static file download, not the Releases
API — no rate limit, no API contract to track, and the file shape stays ours.

**Considered and rejected:** a `minUpgradeFrom` field for migration chains. Migrations here are
cumulative and strictly ordered, so any→newest holds today. No user action is broken without it
(AGENTS.md §4). Add it when a one-way migration actually lands.

**Considered and rejected:** hosting `latest.json` on openldr.online. More control, but it
couples every release to a droplet deploy.

## `pnpm release`

The value of this script is what it refuses to do.

### Preconditions — all checked before anything is pushed

1. Clean working tree, on `main`, in sync with `origin`.
2. `package.json` version is semver-greater than the newest `v*` tag.
3. No `vX.Y.Z` tag exists, locally or on origin.
4. `:X.Y.Z` is not already in the registry. **This is the overwrite guard.**
5. Test gate green — `pnpm turbo run test`, never piped through `tail` (CLAUDE.md).
6. Landing changelog regenerated and committed (AGENTS.md §6 item 5).

**Precondition 5 needs care, or it will block releases at random.** The gate's failures here are
usually timeouts under parallel load, not regressions — measured 2026-08-17, `@openldr/forms`
`store.test.ts` took 41 672 ms under turbo and 752 ms alone. A release script that treats any
non-zero exit as "refuse" would abort on a flake. So on failure it re-runs the failing package
alone, and refuses only if that also fails. It prints both results either way; it never
downgrades a real failure to a warning.

### Then, in this order

7. Build and push the five images, tagged `:X.Y.Z` and `:latest`.
8. Set all five packages public, **then read visibility back and verify**.
9. Pull the published `:X.Y.Z` from a clean context; confirm the stack comes up healthy.
10. `git tag vX.Y.Z`, push it, cut the GitHub release, upload `latest.json`.

**Why this order.** Local and reversible work first; irreversible work last. A pushed image
cannot be cleanly unpushed, so everything that can fail should fail before step 7. And because
the tag is step 10, a failure at step 9 leaves no tag — so no lab ever sees a half-release.

**Step 8 is not optional politeness.** New GHCR images default to private, and a single private
image 401s and aborts the *entire* pull. A release that pushes five images and misses visibility
on one is, from the lab's side, indistinguishable from a release that never happened. Setting
visibility is not enough; the script reads it back.

## What changes for installs

`install/install.sh` and `install/install.ps1` resolve `latest.json` to a concrete number and
write `OPENLDR_VERSION=0.2.0` into `.env` — never the word `latest`.

Two installs on the same day then get the same stack, and `.env` records exactly what a lab is
running, which is the first question in any support conversation.

- `--version 0.1.9` pins deliberately.
- `--version latest` opts into the moving tag, for demos.
- **If the resolve fails, the installer stops** and prints the exact `--version` command to run.

That last point is deliberate. Falling back to `latest` on a failed fetch would reintroduce the
moving tag at exactly the moment the operator cannot see it happening.

## Code placement

`scripts/release.ts` is a thin wrapper. The decisions live in a tested module.

This follows the changelog's precedent: pure logic in a package where vitest runs
(`apps/web/src/landing/changelog-model.ts`), thin script on top (`scripts/make-changelog.ts`).
Nothing under `scripts/` is currently tested.

**Semver comparison goes in one shared place.** Project A asks "is `package.json` newer than the
last tag?" Project B asks "is `latest.json` newer than what is running?" If those two disagree,
A publishes something B never announces — a silent bug with no error message.

`compareVersions` is already defined twice, in `apps/web/src/docs/content.ts` and
`apps/studio/src/docs/version.ts`. Those are **not** being refactored here; that is unrelated to
this goal (AGENTS.md §4). They are the reason to add one shared implementation both A and B
import, rather than a third private copy.

## Testing

What gets real tests:

- **Semver compare**, including the cases that bite: `0.2.0` vs `0.10.0`, equal versions, a
  malformed string.
- **Each precondition refusing** — dirty tree, version not bumped, git tag exists, registry tag
  exists. One test per refusal. These are the feature.
- **`latest.json` shape**, and the installer resolving it against a fixture.

### HONEST NON-PROOF

Nothing in the suite touches a real registry. **Step 8's visibility read-back and step 9's
verification pull are provable only by running a real release.** The first release is the test
for those two steps.

This will be stated in `RELEASE.md` rather than left to imply coverage that does not exist.

## Out of scope

- **Project B.** A publishes `latest.json`; nothing reads it yet.
- **GitHub Actions.** Deliberate — this repo has no CI at all, and introducing it is a larger
  decision. The script is written so a workflow can later *call* it, never reimplement it.
  `RELEASE.md` already names this as the intended end state under "Follow-up (Approach B)".
- **Any auto-apply.** Nothing pulls images or restarts containers.
- **The two existing `compareVersions` copies.**

## Noted, not fixed

`deploy/install/docker-compose.yml` also pins `minio/minio:latest`, `minio/mc:latest`, and
`certbot/certbot:latest`. Three images in every lab's stack still track moving tags after this
lands, so a `docker compose pull` can change MinIO underneath a running install.
`postgres:16-alpine` is fine — pinned to a major.

That is a separate slice, for the operator to scope.

## Prerequisite: a token that can do this

Steps 4 and 8 both need package scopes the current credential does not have. Measured
2026-08-17: `gh api .../packages/container/openldr-*/versions` returns
`403 — You need at least read:packages scope` for all five.

So `pnpm release` needs a GitHub token with **`read:packages`** (precondition 4, the overwrite
guard), **`write:packages`** (step 7, already required by `RELEASE.md`), and whatever scope
setting package visibility requires (step 8). Establish this before implementation — three of
the ten steps are unimplementable without it, and discovering that mid-plan would stall the work.

## Open fact

Whether any image has already been pushed to GHCR is **unknown**, for the same reason. If
`:0.1.0` is already occupied, the first release must be `0.1.1` or higher, since precondition 4
will correctly refuse to overwrite it. Confirm before the first run.
