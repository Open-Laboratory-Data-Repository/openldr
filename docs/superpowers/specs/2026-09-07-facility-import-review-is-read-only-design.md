# Facility import: Review reviews, Mapping decides

Design, 2026-09-07. Closes finding S-8 from the screenshot pass of the same date.

## The problem, in the operator's words

> "I think Review page should be for Review, cause if I do map, how do I review again in case there
> are other issues... I don't want them to accidentally think they are still reviewing then they
> accidentally start uploading."

Review currently carries editable controls. `ReconciliationSummary` renders the value-mapping panel,
the `onConflict` / `onAbsent` / `onDeleted` policy selects, and the allow-overrides
(`ImportFacilitiesSheet.tsx:1862-1888`). So the step named Review is where most of the deciding
happens, and after deciding there is nowhere to review the result of the decision.

Two consequences, both real:

1. **A decision has no re-check.** Saving a value mapping re-parses and lands the operator back on
   the same page, so the page both asks the question and reports the answer.
2. **Mode confusion next to a write.** Apply lives on that same page. A page of live controls next
   to the one irreversible action is how somebody clicks the irreversible one.

**Operator decision, 2026-09-07.** A national facility list is tied to too much downstream to trade
correctness for speed. If there are a hundred issues, the operator goes back and fixes a hundred
issues. Review earns its name or it should not have it.

## RULE 0 pass

Six premises. Each was checked before anything below was designed.

| Premise | Finding |
|---|---|
| Review holds editable controls | **CONFIRMED.** `ReconciliationSummary` takes `onValueMappingsSaved`, `onDeletedChange`, `onAbsentChange`, `onConflictChange` and three allow-toggles (`ImportFacilitiesSheet.tsx:1862-1888`). |
| Mapping cannot show unmapped values, so this needs a new discovery route | **REFUTED, and this is what makes the slice affordable.** `unmapped` comes from a parse (`FacilityImportResult`), and under the loop below a parse has always run by the time Mapping needs to show the panel. The panel is a worklist that appears once there is work. No discovery route. |
| The streamed door can re-parse without re-uploading | **CONFIRMED as feasible, and it does not exist yet.** `facility_import_runs.blob_key` retains the file (`080_facility_import_runs.ts:23`), the worker's validate phase reads it (`facility-import-worker.ts:383-384`) and so does apply (`:453-454`), and options come off the run row (`:254`, `:293`, `:320`). The import routes are upload, runs, confirm, cancel only (`facilities-routes.ts:2328-2840`). There is no re-validate. |
| The step model already supports going back | **CONFIRMED.** `canGoBack` allows any step but the first while no run is active (`stepModel.ts`), and `clampStep` never lets a requested step exceed what was earned. |
| Apply is unguarded | **REFUTED.** Apply already goes through `ConfirmDialog` (`ImportFacilitiesSheet.tsx:2018-2025`). The hazard is mode confusion on a busy page, not a missing confirm. |
| The allow-overrides behave the same on both doors | **REFUTED.** They are checkboxes on the inline door only; the background door replaces them with `reupload`, because the confirm route's refusal points at re-uploading (`ImportFacilitiesSheet.tsx:1869-1874`). The background door therefore already has the "you must send the file again" problem this design removes. |

## Scope

**In.**

- Review becomes read-only: an issues report plus Apply, and nothing else clickable.
- Every decision moves to Mapping: value mappings, `onConflict`, `onAbsent`, `onDeleted`, and the
  allow-overrides.
- Two lifetimes, the worklist and the summary, so a stale summary is never on screen.
- A re-validate route, so the streamed door re-parses a stored upload under a new map instead of
  re-uploading it.
- CLI parity for re-validate.

**Out, deliberately.**

- **Ordering inside the value picker** (finding S-6) and **case-sensitive canonical matching**
  (S-7). Both shorten this loop and both are the next two slices. Doing them here would hide their
  own measurements inside a structural change.
- **Removing the inline Preview door** (open slice 2). See Sequencing.
- **Changing what Apply writes.** This slice moves where decisions are made, never what the import
  does with them.
- **A fourth Apply step.** Considered and rejected by the operator: with Review stripped of editable
  controls there is nothing left to confuse Apply with, so a fourth step buys a click and no safety.

## Design

### 1. The rule

**Mapping owns every decision about the import. Review owns none.**

Review reports what a parse found and offers exactly one action, Apply, behind the existing
`ConfirmDialog`. Nothing else on the page is interactive.

The cost is accepted, not overlooked: the operator sets a conflict policy before seeing the conflict
count, discovers the count on Review, and goes back to change it. That round trip is the deliberate
shape of the flow.

### 2. The loop

```
Source  ->  Mapping  ->  parse  ->  Review (read-only)  ->  Apply
              ^                        |
              +------- go back --------+
```

**First pass.** Mapping shows columns and fixed values. It does not show a value-map panel, because
nothing has parsed the file and no raw values are known. This is not a gap to fill; there is nothing
to fill it with.

**After the first parse.** Review reports the issues, including unmapped values per controlled
field. The operator goes back to Mapping, where the value-map panel is now present and populated
from that parse. They fix what they choose to fix and go forward, which re-parses.

Both doors follow the same loop. The inline door re-parses with a preview call; the streamed door
re-parses with the new re-validate route against the stored blob.

### 3. Two lifetimes, which is the safety half

One state cannot serve both roles. Splitting them is what keeps a false number off the screen.

**The worklist.** The `unmapped` values from the last parse. It survives while the operator works on
it at Mapping, so saving one mapping does not make the remaining nineteen rows vanish mid-edit.

**The summary.** Everything Review reports. It is discarded the moment any input changes: file,
register, format, complete-release flag, release version, column map, a fixed value, an allow-override,
a policy select, or a saved value mapping. Review is not reachable again until a fresh parse has run.

So Review is either current or absent. It is never stale.

The worklist is invalidated by a narrower set: a change that alters which raw values exist at all,
namely the file, the register, the format, or the column map. Choosing a mapping does not invalidate
it.

Rejected alternatives:

- **Keep the summary with a "stale" banner.** Leaves a wrong number on screen, which is the exact
  failure the operator named.
- **Auto re-parse on every edit.** Spends a full validate of a national register every time a
  dropdown moves.

### 4. What moves, concretely

| Control | Today | After |
|---|---|---|
| Value-map panel | Review, inside `ReconciliationSummary` | Mapping, below Fixed values |
| `onConflict` / `onAbsent` / `onDeleted` | Review | Mapping |
| Allow unknown columns / invalid coordinates / malformed rows | Review, inline door only | Mapping, both doors |
| Counts, quarantined rows, unknown columns, conflicts, absent, deleted, unmapped | Review | Review, read-only |
| Apply | Review, in the dots menu | Unchanged |

`ReconciliationSummary` loses every callback prop and becomes a presentational component. That is
the measurable end state: if it still takes an `on*Change`, this slice is not done.

**Saving a value mapping no longer re-parses.** Today `onValueMappingsSaved` re-runs the preview and
carries the operator to Review. Under this design saving is a local edit; moving forward stays the
operator's decision.

### 5. The re-validate route

`POST /api/facilities/import/runs/:id/revalidate`, guarded by `MANAGE`.

⛔ `MANAGE`, `IMPORT` and `UPLOAD` in `facilities-routes.ts` are the SAME capability,
`facilities.manage` (`:38`, `:57`, `:145`). They differ only in `bodyLimit`. So the choice here is a
body-size decision, not an access decision: this route's body is a column map and a few booleans,
not a file, so it takes the plain guard rather than either raised limit. Do not read the three names
as three permission levels.

It takes the operator-supplied parts of the run's options, primarily `columnMap` and the
allow-overrides, writes them onto the run row, and re-runs the validate phase against the existing
`blob_key`. It never re-reads identity fields from the request: `nationalSystem`, `format` and
`completeRelease` stay whatever the upload declared, for the same reason the worker reads them off
the run row rather than off operator-supplied JSON (`facility-import-worker.ts:249-254`).

**Refusals.** A run with no `blob_key`, a run in a terminal or applied state, and a run whose blob
was deleted by cancel (`facility-import-worker.ts:363-365`) are all 400s that say which.

**Why a route and not a re-upload.** The blob is already stored and already re-read by apply. Sending
a 3788-row national register again to change one mapping is work the system does not need to do, and
the background door's existing `reupload` affordance exists only because this route was missing.

**CLI parity** (`AGENTS.md` §6 item 2). `openldr facilities import revalidate --run <id>
--column-map <file.json>`, sharing the same `@openldr/bootstrap` function as the route, auditing as
`actorName: 'cli'`.

### 6. Step gating

`stepModel.ts` keeps its shape. `hasReview` stops meaning "an upload was started or a summary
exists" and starts meaning "a summary that matches the current inputs exists". The invalidation in
§3 is what flips it back to false, which drops the operator to Mapping through the existing
`clampStep`. No new step, no new gate function.

`canGoBack` is unchanged: back is offered on any step but the first, never during an active run.

## Error handling

- **A parse that refuses** keeps the operator on Mapping, as `blockedReason === 'column-map'` already
  does today (`ImportFacilitiesSheet.tsx:1047`). With every decision now on Mapping, that path
  generalises: any refusal the operator can act on lands where the controls are.
- **A failed re-validate** leaves the previous run row's status truthful and surfaces the server's
  own message. It must not leave a run looking validated when it is not.
- **An unmapped value never blocks.** Unchanged and load-bearing
  (`facility-controlled-fields.ts:169-171`). Review reports unmapped values as an issue; Apply still
  proceeds if the operator chooses. This slice makes the issue easier to find, never fatal.

## Testing

State which layer each proves, per `AGENTS.md` §7.

- **`stepModel.ts` unit tests.** The new `hasReview` meaning, as arithmetic. Proves the gate, not the
  wiring.
- **`ImportFacilitiesSheet` tests.** Changing each input discards the summary and drops to Mapping;
  saving a value mapping does not; the worklist appears at Mapping only after a parse. jsdom, so it
  proves the state machine and not the layout.
- **`ReconciliationSummary` tests.** It renders every issue and exposes no callback that changes
  import behaviour.
- **Route tests for re-validate.** The wire shape, the three refusals, and that identity fields are
  read off the run row and not the request. Route tests are the only thing that pins a wire shape;
  `typecheck` green does not.
- **CLI test** for the new command, including the `--force`-free read path.
- **Mobile at 375x812.** Mapping grows: it now carries columns, fixed values, the worklist and four
  policy controls. That is the longest pane in the sheet and it has never been seen at that width.
  Headless Chromium cannot settle a `vh`-versus-`dvh` question, so anything bottom-anchored gets
  reported as unverified, not verified.

**Known non-proof up front.** pg-mem is not Postgres. The re-validate route's status transitions
touch the same run row the worker writes, and pg-mem cannot show a race there. A live run against
real Postgres is what would prove it.

## Sequencing

Slice 2 removes the inline Preview door. If it landed first there would be one door instead of two,
and the re-validate route would serve it alone. Taken in the requested order, this slice keeps both
paths working and slice 2 later deletes one of them, which costs some rework in the inline path.
The operator chose this order on 2026-09-07 with that cost stated.

S-7 (case-only differences fill the worklist) and S-5 (the seeded value set mixes "Centre" and
"Center") both shorten this loop and follow immediately after.
