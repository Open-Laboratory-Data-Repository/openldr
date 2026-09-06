# Facility import workflow redesign

Date: 2026-09-06
Status: approved, not yet planned

## The problem

The operator ran the import against the real Zambia MFL export and reported it plainly:

> The import process is not intuitive. User doesnt know they have to register a national system
> first, then the upload/validate does really inform the user has to click on the ... button again
> and choose right menu, its almost like a 3/4 step process but if I was to run this for first time
> it would be confusing.

Three separate faults, all of them structural rather than cosmetic.

**You cannot start.** A fresh install has no facility register at all. Migration 082 back-fills only
from `national_system` values a pre-existing `facility_registry` already carries, so a new install
has none. The only way to create one is a `Register a source` item inside the sheet's header
dropdown. Nothing on screen says it is required, and the register picker below it simply sits on an
empty state forever.

**You cannot tell what to do next.** Every action in the sheet lives in one header dropdown,
whatever step you are on. Across the flow that menu can hold eleven different items: Register a
source, Upload and validate, Preview, Apply, Confirm import, three separate re-uploads, Cancel this
import, and Close. Which appear depends on state the operator cannot see. The one action that moves
them forward is not distinguished from the ten that do not.

**You cannot tell where you are.** The sheet presents five stages of work as one scrolling surface
with no numbering, no progress, and no way back.

Two more faults surfaced while fixing bugs on the same file, and belong to the same redesign.

The value-mapping panel has its own nested dropdown containing `Save mappings`, rendered as a 6 by 6
ghost icon inside an amber warning box. The operator's screenshots show twenty-three unmapped values
and the question "how do these get mapped". They already can be. The action is simply invisible.

`apps/studio/src/pages/Facilities.tsx` never imports `toast`, although sonner is mounted app-wide in
`main.tsx` and other pages use it. Deleting one facility, or 3776 of them, produces no confirmation
of any kind.

## Decisions taken

Four, by the operator, before any of this was written.

1. **AGENTS.md section 5 bends for the primary step action, and only for that.** Exactly one visible
   button per step: the one that advances. Everything else stays in the dropdown. The rule holds
   everywhere else in the app and everywhere else in this sheet. This is a deliberate, narrow
   exception, recorded here so it is not read later as the rule weakening.
2. **One door.** The inline Preview/Apply path goes. Every import is upload and validate.
3. **Pre-empt what the headers reveal.** Unrecognised columns become decisions in the mapping step.
   Coordinates and malformed rows still surface after validation, because nothing can know them
   sooner.
4. **A re-validate route is in scope**, so saving a value mapping does not mean re-uploading the
   file.

## Why one door

Two of the three defects fixed on 2026-09-06 were the two import doors disagreeing about the same
file.

The column-map panel unmounted after an upload because its render gate opened with a bare `!run`,
which is only ever true on the inline door. The refusal it was meant to let the operator fix
appeared at the same moment the panel disappeared.

A validated run offered Confirm on a file that could only write nothing, because `canApply` on the
inline door requires `parsed > 0` and `canConfirmRun` on the run door asked only whether the run was
blocked. Unrecognised columns set no blocked reason at the time, so the apply wrote nothing and
reported success behind a green box.

Both are the same shape: one rule, two implementations, one of them wrong. Collapsing to a single
path removes the shape, not just the two instances.

The cost is real and is accepted. A twenty-row test file will go through upload and a worker rather
than an instant preview. The inline checkbox overrides that re-preview immediately become
re-uploads. In exchange, the 2000-row apply cap leaves the operator's world entirely, and there is
one set of states to reason about.

## The step model

Three steps, numbered and named at the top of the sheet.

### Step 1: Source

The file and the register it belongs to.

When the install has no register, this step says so and its primary action becomes **Add a
register**. That is the fix for "you cannot start": the requirement is stated where it blocks you,
and the remedy is the visible button rather than an item in a menu you have no reason to open.

Primary action: **Continue**, enabled once a file and a register are both chosen.

### Step 2: Mapping

Columns and fixed values, in the panel that already exists, with one change of meaning.

Every header gets an explicit destination: a contract field, or **Keep as extra data**. `Not mapped`
stops being an option.

That is what removes the unrecognised-columns round trip. The studio already fetches the file's
headers here, to build the suggestions, so it already knows which headers spell nothing on the
contract. Today it uploads anyway, the worker refuses the whole file, and the operator re-uploads
with an override. After this change the file is never sent in a state that will be refused for that
reason.

It also retires a lie fixed earlier the same day. A header that spells a contract field claims that
field whether or not the map mentions it, so rendering it as `Not mapped` was untrue and produced a
`duplicate_target` refusal on a map the panel had called safe. With every header carrying an
explicit destination, the false state has nowhere left to live.

A header with no decision blocks Continue and is named.

There is deliberately no "drop this column" option, because the parser has none. A column either
maps to a contract field or is carried into the record's `extras` blob, and `Keep as extra data`
is that second outcome. Offering a third choice the importer cannot honour would be a new lie of
exactly the kind this redesign removes. An operator who wants a column gone deletes it from the CSV.

Primary action: **Upload and validate**.

### Step 3: Review

The validated summary, and the two things that genuinely need a parse.

Value mapping moves here in substance as well as position: its `Save mappings` becomes a visible
action in the step rather than an item in a nested dropdown. Saving re-validates (see below) so the
operator sees the effect without re-sending the file.

Coordinates and malformed rows surface here with their re-uploads, unchanged, because nothing can
know them sooner.

Primary action: **Confirm import**, or the re-upload the refusal names when one is blocking.

## Server changes

One new route.

**Re-validate.** The run already holds its file in blob storage. A route that re-runs validation
against the stored blob, without a re-upload, is what makes value mapping usable on a national
export: a saved mapping only takes effect on a fresh parse, and today that means re-sending 641 KB.
It supersedes the run's summary in place rather than minting a new run, since the file and every
parse-changing option are identical by construction.

It must refuse to change any parse-changing option, for the reason the confirm route's own gate
documents: an option that changes which rows become records would make the apply classify a
different set than the one that was approved.

## Explicitly not in scope

The wording of the shared refusal string. The server and CLI still say `"zone" and "Province" both
map to "zone"` about a header that maps to nothing, while the panel now says "claim". That is one
string shared by two surfaces and six test assertions, and it is a separate decision.

The `actorName` discrepancy. AGENTS.md section 6 says to audit as `actorName: 'cli'`, but
`cliActor()` returns the OS username and falls back to `'cli'` only when it cannot read one. Doc and
code disagree. Noted, not resolved here.

## Slices

Four. Each ships on its own and leaves the sheet working.

**Slice 1: the step shell.** Numbering, per-step primary action, back navigation, and the register
empty state with its Add a register action. No change to what any step does. This alone answers the
"where am I" and "you cannot start" halves of the report.

**Slice 2: one door.** Remove the inline Preview/Apply path. Fold its checkbox overrides into
re-uploads. Delete `canApply`, the row cap, and the branches that exist only to keep the two doors
in step.

**Slice 3: the mapping step's forced decisions.** Replace `Not mapped` with an explicit destination
per header. Block Continue on an undecided header. Remove the unrecognised-columns refusal path from
the operator's flow, keeping the server's own guard, which stays as the authority.

**Slice 4: the review step.** Visible Save for value mapping, the re-validate route behind it, and
sonner feedback for import completion, delete and bulk delete.

## Verification, and its limits

Every slice carries route tests and studio tests, written first.

Two limits are known in advance and must be stated in each slice's report rather than discovered
again.

`pg-mem` is not Postgres. It cannot parse `COLLATE`, so no facility sort runs offline, and its
stable scan order means it can never show `ORDER BY` tie non-determinism.

Nothing in this repository has historically run a filter the UI can build, through the route, to
real Postgres. Both slices that shipped on the shared table-query grammar shipped a filter matching
the wrong rows, and both were caught by review rather than by a test. The bulk-delete work on
2026-09-06 added six live tests against real Postgres for that seam. Any slice here that touches
selection or filtering extends them rather than trusting `pg-mem`.

A green test proves the layer it exercises. Where a slice cannot prove something, its report says
HONEST NON-PROOF and names what would.

## Definition of done, per slice

All five, per AGENTS.md section 6: the studio UI, CLI parity where the feature has a CLI surface,
docs in en, fr and pt plus the web copy, the mobile view at 375, and `pnpm make:changelog` after the
merge to `main`.

The mobile pass carries a known blind spot. Headless Chromium has no retractable URL bar, so `100vh`
and `100dvh` measure the same and every bottom-edge check passes either way. A step shell with a
bottom-anchored primary action is exactly the shape that bug hides in. Any slice that pins an action
to the bottom of the sheet must say that only a real phone can confirm it.
