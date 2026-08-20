# No update found: stop showing a version number that cannot be acted on

Date: 2026-08-20
Status: approved, not implemented

Supersedes the `runningIsNewer` half of
`docs/superpowers/specs/2026-08-19-update-verdict-design.md`, which shipped in 0.1.5 and lasted
one release.

## The problem

`openldr update check` on a 0.1.6 install printed:

```
running:   0.1.6
published: 0.1.5

this install is newer than the last release it saw.
nothing to upgrade to.
```

The operator read that as being told to roll back. That reading is reasonable. `published: 0.1.5`
is a version number lower than the one they are running, placed directly beneath it, under a label
that claims to state what has been released.

It is also false as a statement about the world. Measured 2026-08-20:

```
GitHub serves right now:   0.1.6
this install had cached:   0.1.5
its last check ran:        05:19:38, before v0.1.6 was tagged
```

`published` never meant "the newest release that exists". It meant "the newest release this
install saw the last time it checked". That is a fact about the check, not about releases, and the
label asserted authority the value does not have.

## Why it was wrong every single time

This is not flakiness. The release script's ordering guarantees it:

```
step 7   build and push the images
step 8   check package visibility
step 9   verification install          <- this stack boots and polls latest.json HERE
step 10  git tag, push, gh release create  <- latest.json only exists HERE
```

The verification install always polls before the release it is verifying exists, then caches that
answer for 24 hours. Every install inspected during this investigation was one of these.

A real operator does not hit this. A fresh install polls after the release exists. An upgrade
recreates the api container, which polls again on start. Verified 2026-08-20: restarting the api on
the 0.1.6 stack moved its cache from 0.1.5 to 0.1.6 and the CLI then read
`running: 0.1.6 / published: 0.1.6 / this install is up to date`.

The remaining real-operator exposure is GitHub's `releases/latest/download/` alias, which was
measured serving the previous manifest for over ten minutes after v0.1.3. An operator who upgrades
inside that window sees the same confusing output until their next poll.

## Two problems, previously treated as one

- **R1.** The release script manufactures a stack guaranteed to show stale data.
- **R2.** A published version *lower* than the running one carries no information an operator can
  act on. It cannot mean "upgrade" and must not mean "roll back".

Two earlier passes reworded the sentence beneath the number and left the number itself in place.
Both failed for the same reason: the type still carried the version, so every surface remained free
to render it, and only wording discipline in two places stopped them.

## Decisions taken

| Question | Decision |
|----------|----------|
| Scope | Fix both. R2 first, because it makes R1 cosmetic rather than misleading. |
| Cache older than running | Show no version number at all. Say "no update found" and when the check last ran. |
| Cache equal to running | Unchanged. Keep showing the matching number; seeing the two agree is real reassurance. |
| Verdict shape | Split the kind so the stale number is unrepresentable, rather than flagged. |
| Release script | Verify the published manifest through the DIRECT asset URL, then restart the verification stack's api best-effort. |

Rejected: gating the release on the `releases/latest/download/` alias. It is the URL installs
actually fetch, so it is the honest thing to test, but it lagged over ten minutes after v0.1.3 and
this check runs AFTER the tag is public. A lagging alias would fail a release that is already
released.

## The verdict shape

`up_to_date` currently carries `latest: string` and `runningIsNewer: boolean`. Replace that one
kind with two:

```ts
| { kind: 'up_to_date'; latest: string }   // cache agrees with running
| { kind: 'no_update_found' }              // cache is OLDER than running
```

`no_update_found` carries no version. Not a nullable one, not a flagged one. A surface that wanted
to print the stale number has nothing to print, so the defect cannot return through a later edit to
the card or the CLI. `runningIsNewer` is deleted.

Precedence is unchanged except that the final line splits in two:

```
1. !enabled                          -> check_off
2. parseSemver(running) fails        -> cannot_confirm (cause bad_running_version)
3. isNewerVersion(latest, running)   -> update_available
4. lastError                         -> cannot_confirm (cause check_failed)
5. latestVersion === null            -> never_checked
6. isNewerVersion(running, latest)   -> no_update_found
7. otherwise                         -> up_to_date
```

Step 6 sits above 7 so the equal case still reaches `up_to_date`.

The `decideUpdate` agreement invariant in `packages/bootstrap/src/update-check.test.ts` should hold
unchanged, because `no_update_found` is not `update_available`. The plan must verify this rather
than assume it.

## What each surface renders

### CLI

The `published:` line is currently printed unconditionally before the switch. It becomes
conditional, because in the `no_update_found` case there is nothing honest to put there.

```
# up_to_date, unchanged
running:   0.1.6
published: 0.1.6

this install is up to date.

# no_update_found
running:   0.1.6
no update found (last checked 2026-08-20T05:32:24Z)
```

`lastCheckedAt` is non-null whenever this state is reached, because `no_update_found` requires a
cached version, which only a successful poll writes. The CLI must still tolerate a null rather than
printing "last checked null": omit the parenthetical entirely in that case.

The timestamp is the raw ISO value, not a relative phrase. `packages/cli` has no date-formatting
dependency and has never rendered `lastCheckedAt` at all. Adding one for a single string is not
worth it, and hand-rolled relative time means untested, unlocalized date logic. ISO is also better
for anyone scripting against the output.

Exit codes do not move. `no_update_found` returns 0, the same as `up_to_date`. Only
`update_available` returns 1; only a failed run returns 2.

### Card

```
up_to_date        Latest    0.1.6 · up to date
no_update_found   Latest    no update found
```

No inline timestamp. The card already shows "Last checked 4 minutes ago" below the divider, in the
user's locale, through the date-fns the studio already carries.

### i18n

Remove `nothingNewer`, added in 0.1.5. Add `noUpdateFound` to en, fr and pt. Rename rather than
edit the value in place: the meaning changed, and a stale key name is how the next reader
misunderstands it. `apps/studio/src/i18n/parity.test.ts` fails if any language is missed.

## The release script

Both parts run after step 10 succeeds, in this order.

**1. Verify the published manifest.** Fetch
`https://github.com/OWNER/REPO/releases/download/v<version>/latest.json`, parse it, and confirm it
names the version just released. Three attempts, five seconds apart, so a blip does not fail a real
release. That direct URL was correct immediately in every measurement taken during this
investigation; only the `latest` alias lagged.

This closes a real gap: nothing currently checks that the manifest the release just uploaded is
readable. A broken asset would silently disable the update check on every install in the field while
the release reported success.

On failure the script exits non-zero and prints the fix:

```
gh release upload v<version> latest.json --clobber
```

**It does not roll back, deliberately.** By this point the images are public, `:latest` has moved,
and the release page exists. Deleting the tag would not unpublish any of that; it would remove the
record and leave the artifacts. A loud failure naming the fix is more honest than a rollback that
undoes the wrong half. This departs from the tag-last rollback in step 10, and the reasoning must
live in the code so it is not "fixed" later.

**2. Restart the verification stack's api.** Best-effort. A failure logs a warning and never fails
the release.

**This restart may not change what that stack shows, and must not be written up as if it does.** It
makes the stack repoll, but installs poll the `latest` alias, which can lag. The stack may still
read "no update found" afterwards. That is now an honest thing for it to say, which is why R2 comes
first. This is a cheap improvement to a cosmetic problem, not a guarantee.

## Tests

- `packages/core/src/update-verdict.test.ts`. Both new kinds. Precedence step 6 above step 7, so
  the equal case still reaches `up_to_date`. And `toEqual({ kind: 'no_update_found' })`, which pins
  the absence of a version field structurally: reintroducing one requires deleting a test.
- `packages/cli/src/update.test.ts`. That **no** `published:` line is emitted in the
  `no_update_found` case, asserted with `not.toMatch`. This is the regression being prevented. Plus
  the ISO timestamp appearing, and exit 0.
- `packages/bootstrap/src/update-check.test.ts`. Confirm the `decideUpdate` agreement test still
  passes unchanged.
- `apps/studio/src/pages/settings/General.test.tsx`. The row reads "no update found", and does
  **not** contain the stale version number.
- `apps/studio/src/i18n/parity.test.ts` already exists and catches a missing fr or pt key.

`scripts/release.ts` has no tests, by its own design note: it sequences commands, and every decision
it appears to make lives in `@openldr/release` where it is unit-tested. Both changes there are
sequencing. Neither is proven until the next real release.

## Definition of done

Against AGENTS.md section 6:

1. UI. The card.
2. CLI parity. Already a command.
3. Docs. One file, `apps/studio/src/docs/0.1.0/en/settings.md`. Still six readings, but one changes
   wording and its explanatory paragraph needs rewriting, including stating plainly that the version
   number is withheld on purpose. `fr/settings.md` and `pt/settings.md` do not exist and fall back
   to English, verified 2026-08-19.
4. Mobile. No new risk, and it will not be re-verified. `no update found` is shorter than the
   `update_available` row already measured wrapping cleanly at 375x812, and no other layout changes.
5. Changelog. `pnpm make:changelog` after merging to main.

## Out of scope

No manual "check now" control. No change to the 24-hour interval, the poll, the notification bell,
or the switch. No change to which URL installs fetch.

## Known limits

The release-script changes cannot be proven before the next real release.

An operator who upgrades during the `latest` alias lag still gets a cache older than their running
version. After this change they see "no update found" instead of a lower version number, which is
honest, but their check is still stale until it next runs.
