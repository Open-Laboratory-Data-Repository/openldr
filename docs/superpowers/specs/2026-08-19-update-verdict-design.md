# Update verdict: telling the operator where they stand

Date: 2026-08-19
Status: approved, not implemented

## The problem

Studio Settings then General shows the running version. It never says whether that version is
current, and it never shows what the latest version is unless an update exists.

Every string the About card can show today, from `apps/studio/src/i18n/en.ts:325`:

```
updateAvailable: '{{version}} available'
lastChecked:     'Last checked {{when}}'
neverChecked:    'Never checked'
checkFailed:     'The last check failed: {{error}}. This install may not be up to date.'
```

There is no "up to date" string. The operator infers they are current from the absence of the
"available" line. `update.latestVersion` is in the payload the server already sends, but
`General.tsx:181` renders it only inside the `updateAvailable` branch.

Three states therefore look the same on screen:

1. Genuinely current.
2. Check turned off. `decideUpdate` forces `updateAvailable` to false when disabled, on purpose,
   so a stale cache cannot raise a banner. The card then reads exactly like state 1.
3. A successful check that found nothing, versus one that never ran. These differ only by a line
   below the divider that is easy to miss.

The CLI is better. `openldr update check` prints `published: 0.1.3` and says "this install is up
to date". The card drops both.

`/api/update` carries no capability guard (`apps/server/src/settings-routes.ts:460`). Every
signed in user already receives `enabled`, `latestVersion` and `lastCheckedAt`. This is a
rendering gap, not a data or permissions gap.

## Decisions taken

| Question | Decision |
|----------|----------|
| Scope | Every state gets an explicit verdict, not just the current case. |
| Check is off, cache holds something newer | Say it is off. Make no version claim. Honours the existing suppression rule. |
| Cache known, last check failed | Verdict is "cannot confirm". No new stored key, no server change. |
| Layout | A Latest row in the same definition list, directly under Version. |
| Shared or separate logic | Shared. One pure function in `@openldr/core/pure`, used by the card and the CLI. |

Two options were considered and rejected. An on demand "check now" button needs a server
endpoint that does not exist. A stored `update.lastSuccessAt` key would let the card date its
answer, but costs a bootstrap key, a server change, tests and CLI parity for a marginal gain.

## The verdict function

`@openldr/core/pure` cannot import `UpdateState`. That type lives in `@openldr/bootstrap`, which
depends on core and not the reverse. So the function takes the fields rather than the type. Both
callers pass their state directly because it is structurally compatible.

```ts
// packages/core/src/update-verdict.ts
export type UpdateVerdict =
  | { kind: 'update_available'; latest: string; releasedAt: string | null; notesUrl: string | null }
  | { kind: 'up_to_date'; latest: string }
  | { kind: 'check_off' }
  | { kind: 'cannot_confirm'; error: string; cause: 'check_failed' | 'bad_running_version' }
  | { kind: 'never_checked' };

export function updateVerdict(input: {
  enabled: boolean; running: string;
  latestVersion: string | null; releasedAt: string | null; notesUrl: string | null;
  lastCheckedAt: string | null; lastError: string | null;
}): UpdateVerdict;
```

Precedence, in order. These conditions overlap, so the order is the specification:

1. `!enabled` gives `check_off`. Absolute, matching the existing suppression rule.
2. `parseSemver(running)` fails gives `cannot_confirm`. See the trap below.
3. `isNewerVersion(latestVersion, running)` gives `update_available`. This beats a failed check on
   purpose. A known newer version is actionable whether or not today's poll succeeded, and this is
   what `decideUpdate` already does.
4. `lastError` gives `cannot_confirm`. Below the check above, so a real update is never downgraded
   to a shrug.
5. `latestVersion === null` gives `never_checked`.
6. Otherwise `up_to_date`.

### The unparseable running version trap

`isNewerVersion` returns false when either side fails to parse. Without step 2 a build whose
running version is not valid semver falls through to `up_to_date`, and the card states that it is
the latest. That is harmless today because the card makes no claim. It becomes a false statement
the moment the claim is explicit. Step 2 cannot displace `update_available`, because an
unparseable running version already forces `isNewerVersion` to false.

Step 2 fires when there is no `lastError`, so the `error` field has no natural source. Two rules
settle it. The function sets `error` to the literal string `unrecognised running version`, not a
copy of `lastError`, which may be null here. And `cannot_confirm` gains a second field so callers
can tell the two causes apart:

```ts
| { kind: 'cannot_confirm'; error: string; cause: 'check_failed' | 'bad_running_version' }
```

The card renders the same "cannot confirm" row for both. The CLI must not, because printing
`last check failed: unrecognised running version` would name a failure that did not happen. On
`cause: 'bad_running_version'` the CLI prints the version line and the verdict only, with no
`last check failed:` line.

### Invariant to pin in a test

`kind === 'update_available'` exactly when `decideUpdate` sets `updateAvailable` to true. If those
two ever disagree, the card and the notification bell contradict each other on the same install.

## The card

`apps/studio/src/pages/settings/General.tsx`. The definition list gains one row between Version
and Environment.

| Verdict | Latest row |
|---------|------------|
| `up_to_date` | `0.1.3 · up to date` |
| `update_available` | `0.1.3 available · released 19 Aug · Release notes` |
| `check_off` | `update check is off` |
| `cannot_confirm` | `cannot confirm` |
| `never_checked` | `not checked yet` |

Unchanged: the upgrade commands box still appears only on `update_available`. The admin switch
and the "Last checked" line stay below the divider. The error detail stays on the existing amber
line rather than being repeated in the row.

When `update` is null, an older server with no `/api/update` or the 500 path that sets it null,
the Latest row does not render at all. The card degrades to today's behaviour rather than showing
a bare dash.

`checkFailed` currently ends "This install may not be up to date", which the Latest row now says.
Trim that trailing sentence to "The last check failed: {{error}}."

Five new i18n keys in each of en, fr and pt: `latest`, `upToDate`, `checkOff`, `cannotConfirm`,
`notCheckedYet`. The `update_available` case reuses the existing `updateAvailable`, `released` and
`releaseNotes` strings, so it needs no new translation.

The `check_off` row also solves a permissions problem for free. The switch is hidden from anyone
without `settings.edit_general` (`General.tsx:217`), so a non admin previously had no way to learn
the check was off. The row tells everyone without exposing the control.

## The CLI

`packages/cli/src/update.ts`. `renderUpdateCheck` switches on `updateVerdict(state)` instead of
re-deriving the conditions itself. That is the point of sharing: the card and the CLI can no
longer disagree about which state an install is in, only about wording.

Exit codes are unchanged and are the contract being protected. `update_available` returns 1, every
other verdict returns 0, and the catch in `runUpdateCheck` still returns 2.

Three states keep their exact current wording. Only the two weakest gain a line:

```
# cannot_confirm, today stops after the failure line
running:   0.1.3
published: 0.1.3
last check failed: HTTP 404

cannot confirm this is the latest.

# never_checked, today stops after "published: unknown"
running:   0.1.3
published: unknown

not checked yet.
```

For `--json`, every existing field stays and one `verdict` field is added. Adding is safe for
scripts. Removing would not be.

## Tests

- `packages/core/src/update-verdict.test.ts`. All five verdicts. The four precedence collisions:
  disabled with a newer cache, newer cache with a live error, error with a null cache, and
  unparseable running. Plus the `decideUpdate` invariant above, and one asserting that an
  unparseable running version yields `cause: 'bad_running_version'` with a null `lastError`.
- `packages/cli/src/update.test.ts` also asserts that `cause: 'bad_running_version'` prints no
  `last check failed:` line.
- `apps/studio/src/pages/settings/General.test.tsx`. One render per verdict, and one asserting the
  Latest row is absent when `update` is null.
- `packages/cli/src/update.test.ts`. Revise the two assertions covering the failure and never
  checked cases. Add coverage for the new lines.
- `apps/studio/src/i18n/parity.test.ts` already exists and will fail on a missing fr or pt key.
  That is the guard against a partial translation rendering as literal braces.

## Definition of done

Against AGENTS.md section 6:

1. UI. The card as above.
2. CLI parity. Already a command. Rewritten onto the shared verdict.
3. Docs. One file: `apps/studio/src/docs/0.1.0/en/settings.md`. Its "Update checks" section says
   the card shows the newer version "when one exists", which goes stale. Verified 2026-08-19 that
   `fr/settings.md` and `pt/settings.md` do not exist and fall back to English, and that
   `apps/web` has no settings doc. The i18n keys still need all three languages.
4. Mobile. Verify the `update_available` row wraps at 375px rather than forcing sideways scroll.
   The grid is `grid-cols-[8rem_1fr]` and that row is the longest string on the card.
5. Changelog. Run `pnpm make:changelog` after merging to main.

## Out of scope

No on demand check button. No `lastSuccessAt` key. No change to the poll, the switch, the
notification bell, or the upgrade commands box. No change to the docs folder structure.

## Known limits

The mobile wrap cannot be settled from the code and needs a browser at 375px.

Rewriting `renderUpdateCheck` changes CLI text for two states. Exit codes are unchanged, but a
script grepping stdout rather than reading the exit code would see the difference.
