# A data stage for the facility import, and a mapping step that answers back

Date: 2026-09-08
Status: Slices A and B built; the status-icon rules revised 2026-09-09, see below

## The problem

The operator ran the Zambia MFL export through the wizard and hit three things in one pass.

**You map blind.** Mapping asks which contract field `Type` belongs to while showing none of the
values in that column. Nothing on screen says `Type` holds `Health Centre` and `1st Level Hospital`.

**Value mapping appears out of nowhere.** The value worklist is fed by the last check's findings, so
on the first pass through Mapping it is absent. Review then says "Map them on the Mapping step, then
check again", sending the operator back to a step that had no such control when they left it, and it
materialises on arrival. In their words: "a user might get confused on where those 2 fields came
from and when they go back to mapping, all of a sudden its there."

**Nothing is checkable until everything is.** One button at the bottom validates the whole file, so a
mapping mistake on the first column is only reported after the round trip.

A fourth thing came out of the same session and is already fixed: choosing the same file twice left
Mapping with no column map at all. Commit `8bd16e1a`.

## What already exists, and must not be rebuilt

RULE 0 first, because one part of the request is already built.

**Column collisions are already detected live.** `ColumnMapStep.tsx:168` computes claimed targets and
collisions on every change, renders `"Province" and "Zone" both claim zone, only one may`, and blocks
Continue while one stands (`onValidityChange`, line 202). The operator's own example, mapping
`Province` to `zone` while `Zone` also claims it, is answered today with no button and no request.
Slice B gives that computation a per-row home. It does not recompute it.

## Decisions taken

Five, by the operator, before this was written.

1. **The grid is editable, and its edits are imported.** What gets applied is the file plus the
   edits, not the file. Everything below follows from this.
2. **Editing a controlled-field cell asks which was meant.** Map this value across the register, or
   change this one row. The register gets smarter with each import instead of the same fix being
   retyped.
3. **The file is uploaded when leaving Source, and rows are paged from the server.** The tab never
   holds more than the header row, exactly as now.
4. **Edits live server-side, attached to the run.** The uploaded blob is never rewritten.
5. **The per-field control is a status icon, not a button.** States below.

## The four stages

Source, Data, Mapping, Review.

### Stage 1: Source

Unchanged in what it asks. The upload now happens on leaving it rather than on leaving Mapping,
which is what gives every later stage rows to work with.

### Stage 2: Data

The file as a table, read only, paged from the stored blob. JSONL renders as the same table, so the
operator sees one shape whatever they uploaded.

Read only is the point. Nothing here has been mapped yet, so there is no contract field to validate a
cell against and no way to tell a bad value from an unfamiliar one.

### Stage 3: Mapping

Each row is a source column, its target field, and a status icon. Under any row whose target is a
controlled field with unrecognised values, that field's worklist renders inline, against the mapping
it belongs to rather than in a separate amber box. The grid sits below and is now editable.

`Validate all` at the bottom re-checks everything and feeds Review.

### Stage 4: Review

Unchanged in substance: the validated summary and the refusals that need a parse.

## The status icon

One control per mapping row. **Always clickable**, in every state, so a re-check is never gated on
the app agreeing that something changed.

| State | Icon | Meaning |
|---|---|---|
| Neutral | Gray tick | Not checked yet |
| Valid | Green tick | Checked, nothing wrong |
| Invalid | Red | Checked, something is wrong. The tooltip says what |
| Stale | Gray tick | Checked, then the mapping or a cell changed. Needs re-checking |

**A 100% match goes green on its own**, with no click. An exact, collision-free column suggestion is
already a decision the ranker is certain about, and making the operator confirm 21 of those by hand
is the busywork this stage exists to remove.

**Neutral and stale are the same gray tick, deliberately.** The operator chose that. They are told
apart by the tooltip, which reads "not checked yet" against "changed since the last check". If they
later need to differ at a glance, stale takes a different glyph and neutral keeps the tick.

### Both of those were reversed on 2026-09-09, after seeing them run

The two rules above came out of a mockup, before anyone had put the real Zambia export through the
built thing. The operator ran it and asked for both to go. What replaced them:

**Nothing goes green without a check.** The ranker scores the column NAME. It says nothing about
the values inside the column, and `facility-mapping-suggest.ts`'s synonym table hands a hardcoded
1.0 to `type -> level` and `operational status -> status` — the only two headers in the export
whose values need checking at all. So the auto-green fired hardest exactly where it was least
earned, and a green tick there is an instruction not to click the one control that would have found
the 16 unrecognised values behind it. The busywork it saved was never the expensive part.

**Four states, four shapes, and unchecked is amber.** Unchecked is an amber information circle,
valid a green tick in a circle, invalid a red circle, stale the circular arrows. A gray tick for
unchecked was the same shape as valid in a quieter colour, so it read as a pass and invited nothing.
Amber is the colour this feature already uses for "needs a decision".

**The check results outlive the panel.** `ColumnMapStep` renders only on step 3, so a trip to Data
unmounted it and destroyed every check result, every written value and every unsaved pick-list
choice. That state describes the run, not the panel, so `ImportFacilitiesSheet` owns it now
(`mappingCheckState.ts`) and discards it only when the file changes.

Two smaller things from the same pass. Data had no footer button while every other step did, so the
bar rendered empty under the grid; it has a Continue that only moves a step. And the sheet menu read
"Cancel this import" above a bare "Cancel", one of which kills the run on the server and one of
which only shuts the sheet; the second reads "Close".

## Splitting the store from the validate

Added 2026-09-08, after planning found the four stages could not work without it.

The upload cannot simply move to Source. `uploadFacilityImport` carries the column map
(`api.ts:1532`) because the validate that produces the summary has to parse with it, and the upload
route mints the run at `queued` for a worker to validate at once. At Source no map exists yet, since
mapping is stage 3.

Re-validate cannot fill the gap. It refuses parse-changing options by design, and a column map is
the most parse-changing option there is: it decides which rows become records at all. The confirm
gate's whole argument rests on the summary having been computed by the parse that gets applied.

So **Source stores, and does not validate.** It mints a run in a new `stored` status. The Data stage
pages that stored file. Mapping decides. The first validate is asked for from Mapping, with the map
in hand, through the route that already exists for re-validating.

`stored` needs no migration. `status` is plain `text not null` with no CHECK constraint
(`080_facility_import_runs.ts:32`). A stored run keeps `active_key` set, so a register still admits
one live run at a time, which is the behaviour the unique index on `active_key` already gives.

## Server changes

**A paged read over the stored blob.** Returns a window of rows plus the total. It must also be able
to return the rows a check flagged, so the grid can go to line 1512 without the operator scrolling
3788 rows to find it.

**An edits table, attached to the run.** One row per edit: run, line, field, value. The blob is never
rewritten, so "what did they actually send us" stays answerable and every edit is auditable. Apply
and re-validate both read the file through this overlay.

Slice C carries the table and the overlay. Slice A needs only the paged read.

## Explicitly not in scope

**Editing anything but a cell value.** No inserting rows, no deleting rows, no adding columns. A row
that should not be imported is a row to remove from the CSV.

**Sorting and filtering the grid beyond the flagged-rows jump.** The job here is repair, not
analysis. The Query page is where a table gets interrogated.

## Two deliberate exceptions to AGENTS.md section 6

Both were put to the operator and both were accepted.

**No CLI parity for grid editing.** Section 6 requires admin features to reach the `openldr` CLI. A
spreadsheet has no headless equivalent, and a lab running headless repairs the CSV, which is what
they do today and what the coordinate refusal already tells them to do. The paged read and the
validate results are ordinary routes and stay scriptable.

**The grid is desktop only.** Section 6 requires the mobile view. A 21-column spreadsheet at 375px is
not usable by anyone. Stages 1, 3 and 4 stay usable on a phone; stage 2 says plainly that it needs a
wider screen rather than rendering something unusable.

Neither is the rule weakening. Both are recorded here so a later reader does not read them as one.

## Slices

Three. Each ships on its own and leaves the wizard working.

**Slice A: the Data stage, read only.** Source stores the file and mints a `stored` run, a
paged-read route serves its rows, the grid renders them, JSONL included, and the first validate moves
to Mapping where the map is known. Answers "let me see my file before I map it", and every later
slice needs it.

**Slice B: the mapping step answers back.** The status icon and its four states, the 100% auto-green,
and the value worklist moved inline under the mapping row it belongs to. Reuses the existing
collision computation. No grid editing. This alone retires the confusion that started this.

**Slice C: cell edits.** The edits table and its migration, the map-everywhere versus this-row
choice, and apply and re-validate reading the file through the edit overlay.

## Verification, and its limits

Every slice carries route tests and studio tests, written first.

Three limits are known now and must be stated in each slice's report rather than found again.

`pg-mem` is not Postgres. It cannot parse `COLLATE` and its scan order is stable, so no facility sort
runs offline and it can never show `ORDER BY` tie non-determinism. The paging added here needs a
unique tiebreaker, and pg-mem will never say so.

A grid over 3788 rows is a performance claim, and no test in this repository measures one. Slice A's
report says what was measured in a real browser against the real export, or it says nothing.

The mobile note in section 6 applies to stages 1, 3 and 4. Headless Chromium cannot see the
`vh`-versus-`dvh` class of bug, so any bottom-anchored change says only a real phone can confirm it.
