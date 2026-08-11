# Report design drafts and published revisions

Date: 2026-08-11
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-report-visual-design-audit.md` (external audit) — addendum finding
**RD-P0-01** ("Editing a published template can change live report output through autosave"), i.e.
Designer Phase 0 item 6.
Position: **slice T3** of five. Predecessors: T1
(`2026-08-11-report-designer-t1-round-trip-integrity-design.md`, `slice/report-designer-trust`) and
T2 (`2026-08-11-report-designer-t2-no-false-affordances-design.md`, `slice/report-designer-t2`).
**T3 branches from T1**, because it rewrites the same `toRow`/`fromRow`/`hashOf` lines T1 touched.

## Purpose

The Report Designer autosaves 1.2 s after a keystroke, straight onto the row that renders live
reports — and, worse, straight into the reference-sync change log.

Measured:

- `apps/studio/src/report-designer/ReportDesignerPage.tsx` debounces `updateReportDesign` at
  `AUTOSAVE_MS`, so a working edit persists without any deliberate action.
- `packages/bootstrap/src/index.ts:610` wires the design store with `referenceCapture` in
  production, and `packages/report-designer/src/store.ts` calls `capture.record(...)` **inside every
  `create`/`update` transaction**, unconditionally.
- `renderDataDriven` resolves `deps.reportDesigns.get(def.designId)` fresh on every render, with no
  notion of a published state.

So a half-finished masthead, a temporarily broken binding, or an element mid-drag does not merely
become the next report output locally — it emits a reference-change record and **propagates to every
enrolled lab**. Undo is an editor affordance; it is not a production rollback.

## The model already exists in this repository

Forms solved exactly this, and T3 adopts their model rather than inventing one.

`packages/forms/src/store.ts` keeps the working copy in `form_definitions`, snapshots into
`form_versions` on publish, and — the load-bearing part — captures for reference-sync **only when the
resulting status is published**. Its own comments state the contract (`store.ts:270`, `:315`):

> Drafts aren't synced — capture an 'upsert' only when the created form is already published (the
> eventual publish() captures the final state for the normal draft→publish flow).

> Capture only when the resulting form stays published (labs mirror the published form). An edit that
> drops a published form back to draft is not synced; the eventual re-publish captures.

The lifecycle rules live in a pure module, `packages/forms/src/lifecycle.ts`:
`computeNextFormVersion` is `max+1`, and `formContentChanged` decides whether an edit is substantive
enough to drop a published form back to draft.

Note what forms do **not** do: `form_version` is not a `ReferenceEntityType`. Labs mirror the current
published form, not its history. T3 keeps the same shape — `report_design` remains the synced entity
and simply stops emitting while a design is a draft.

## Scope

In scope: a versions table; a `status` on `report_designs`; publish; capture-only-when-published;
the seed and migration consequences; the naming collision with the existing Publish action; showing
status in the editor; CLI parity.

Explicitly **out of scope**:

- **Pinning a report to a specific revision.** The audit asks for it; forms do not do it, and it
  costs a second migration on `reports`, a deliberate "move reports to vN" action, and a policy for
  reports left on an old revision. Decided against for T3 — see "Rejected alternatives".
- Revision compare and rollback UI. The audit groups these with preflight; the versions table makes
  them cheap to add later.
- Preflight and blocking publish on errors — **T4**.
- Delete guards and optimistic concurrency — **T5**.
- Review/approval roles, publish notes, effective dates. Governance beyond draft/published.

## Measured before designing

Measured 2026-08-11 in a worktree at `slice/report-designer-trust` (`bb1d9d6d`).

| Fact | Value | How |
|---|---|---|
| Design store capture | fires in **every** `create`/`update` transaction, unconditionally | read `report-designer/src/store.ts` |
| Capture wired in production | yes | read `bootstrap/src/index.ts:610` |
| Render resolution | `reportDesigns.get(def.designId)`, no published state | read `bootstrap/src/index.ts` |
| Autosave debounce | 1.2 s after a keystroke | read `ReportDesignerPage.tsx` |
| `report_designs` status column | **absent** | read migrations 042, 065, 082 |
| Forms' versions table | `form_versions`, `(form_id, version)` unique, snapshot jsonb, `published_at`/`published_by` | read `019_form_versions.ts` |
| Forms' status column | `text NOT NULL DEFAULT 'draft'`, plus an index | read `016_form_definitions.ts:11,19` |
| Forms' next-version rule | `max+1`, `computeNextFormVersion` | read `forms/src/lifecycle.ts:11-13` |
| Forms' un-publish rule | `existing.status === 'published' && contentChanged ? 'draft' : existing.status` | read `forms/src/store.ts` |
| `form_version` is a sync entity | **no** — labs mirror the published form only | read `reference-change-log.ts:8-31` |
| Existing designer "Publish" | `onPublishAsReport` — creates a **report record**, unrelated to revisions | read `ReportDesignerPage.tsx:350-356` |
| Latest migration on this branch | `082` (T1); `081` is facilities | `ls` |

## Design

### 1. Migration `084_report_design_versions`

Mirror `019_form_versions.ts`:

- `report_design_versions` — `id` PK, `design_id`, `version` integer, `name`, `paper`,
  `orientation`, `pages` jsonb, `parameters` jsonb, `margins` jsonb, `page_numbers` boolean,
  `published_at` timestamptz default `now()`, `published_by` text. Unique index on
  `(design_id, version)`, plus an index on `design_id`.
- `report_designs.status` — `text NOT NULL DEFAULT 'draft'`, with an index, matching
  `form_definitions`.

⛔ **The migration MUST backfill every existing row to `'published'`.** Existing designs are live and
already mirrored by labs. Leaving them `'draft'` means capture never fires for them again, so every
lab's copy freezes at whatever it currently holds — silently, permanently, and invisibly in the
change log. `DEFAULT 'draft'` is right for *new* rows and wrong for the backfill; the migration must
do both.

Because `page_numbers` is carried in the snapshot, T3 depends on T1 having added that column.

### 2. A shared lifecycle module

New `packages/report-designer/src/lifecycle.ts`, mirroring `forms/src/lifecycle.ts`:

- `computeNextDesignVersion(existing: readonly number[]): number` — `max+1`.
- `designContentFingerprint(d)` / `designContentChanged(before, after)` — the canonical answer to
  "did this design's content change", over `name`, `paper`, `orientation`, `margins`, `pageNumbers`,
  `parameters` and `pages`, excluding `id`, `createdAt` and `updatedAt`.

  **`name` counts as content**, so renaming a published design drops it to draft. That matches both
  `formContentChanged` (which compares `before.name !== after.name`) and the existing
  `designContent` in `report-seeds.ts`. It is the mildly surprising case, so it is stated here
  rather than left to the implementer: a rename is a change labs should receive, and receiving it
  requires a republish.

**This function must become the single definition of design content.** `report-seeds.ts` already has
a private `designContent` doing the same job for the boot seed's drift check, and T1's entire defect
was that comparison disagreeing with what the store persisted. Two definitions of "changed" that can
drift is exactly the shape of the bug this arc keeps finding. `report-seeds.ts` switches to the
shared function; that is a deliberate, in-scope touch, not incidental refactoring.

### 3. Store rules

- `publish(id, publishedBy)` — read existing versions, `computeNextDesignVersion`, insert the
  snapshot, set `status = 'published'`, and `capture.record(...)`, all in one transaction.
- `update` — compute `nextStatus = existing.status === 'published' && designContentChanged(...) ?
  'draft' : existing.status`. Gating on *content* matters: autosave fires on any dirty state, and a
  no-op save must not un-publish.
- **`capture.record` fires only when the resulting status is `'published'`.** This one rule is the
  hazard fix.
- `create` — captures only when created already published (the seed's case).

### 4. The seed must publish

⛔ **The boot seed must create and update its designs as `'published'`.**

`seedDataDrivenReports` writes `SEED_DESIGNS` straight through the store. If those land as drafts,
capture never fires and **labs receive zero designs** — reproducing precisely the failure
`065_report_deps_managed_origin.ts` was written to fix, where central published 8 reports and each
lab got 8 `reports` rows with dangling `design_id`s and a "No reports yet" page.

This gets an acceptance test, not a comment.

### 5. Naming, and what the author sees

The ⋯ menu cannot hold two actions called Publish. The existing `onPublishAsReport` creates a
*report record* pointing at the design; the new action mints a *revision*. Rename the existing one to
say what it does — "Create report from this design" — and name the new one "Publish revision".

The status chip today shows only `Saved`/`Unsaved`. It must also show `Draft`/`Published`, because
under this design the author's first keystroke on a published design un-publishes it. That is the
intended behaviour — publishing becomes deliberate — but it is unacceptable if it is invisible.

### 6. CLI parity

Per the standing convention that operator features need `openldr` equivalents: `report-design
publish <id>` and `report-design versions <id>`. The CLI today has only `list` and `delete`.

## Testing

The cases that would otherwise ship broken:

- A draft edit emits **no** reference-change record; publishing emits exactly one.
- Editing a published design drops it to draft; a no-op save does not.
- `publish` twice yields versions 1 then 2, and the snapshot matches the design at publish time —
  including `pageNumbers` and `margins`, not just pages.
- Publishing after further edits snapshots the *current* content, and the previous version row is
  unchanged.
- **The seed's designs end up published**, and a lab-facing capture record exists for each. This is
  the 065 regression guard.
- **The migration backfills existing designs to published** — an install upgraded from before T3
  keeps syncing.
- A design with no versions reports as draft; `versions` on an unpublished design is empty, not an
  error.
- `report-seeds.ts` and the store agree on what "content changed" means, because they call the same
  function.

## Rejected alternatives

**Pinning reports to a revision** (the audit's literal ask). Gives reproducible output and makes a
bad publish unable to change live reports. Rejected for T3: forms establish the no-pin precedent,
and pinning needs a `reports` migration, a "move to vN" action, and a policy for stale pins. The
versions table T3 builds is the prerequisite, so this stays reachable.

**Keeping autosave but making it write a separate draft row.** A second row per design, with merge
questions on publish. The forms model gets the same outcome with one status column.

**Suppressing capture by unwiring `referenceCapture` from the design store.** Kills the hazard in one
line, and also stops designs reaching labs at all — reintroducing the 065 bug deliberately.

**Leaving a published design published while edited.** Considered and declined: labs would then
mirror a design whose stored content no longer matches what was reviewed, which is the original
defect wearing a different hat.

## Known limits

- Reports render whatever is currently published, so republishing changes every report using that
  design at once. That is the accepted trade of the no-pin model, and the reason pinning is named as
  a follow-up rather than dropped.
- No rollback: recovering from a bad publish means editing back and republishing. The version rows
  make the previous content recoverable by hand.
- T3 does not gate publish on preflight — a design can be published with a broken binding until T4.

## Coordination

**Migration number `084`.** Written as `083` and renumbered to `084` when `main` was merged in.
The facilities branch turned out to carry two migrations, `081` and `082`, not one — so T1's
migration moved `082` → `083` at its own merge, and T3's had to move again. `081` is
`facility_source_and_register_state`, `082` is `facility_canonical_identity`, `083` is T1's
`report_design_page_numbers`, `084` is this one. Merge order was facilities → T1 → T2 → T3.
Re-check `packages/db/src/migrations/internal/` against every live branch before creating the
file — see [[migration-numbering-kysely-strict-order]] for why a gap is a boot hazard, not
bookkeeping. This is the second time in this arc the number moved at merge time.

T3 adds user-facing strings, so it touches `apps/studio/src/i18n/{en,fr,pt}.ts` — the same three
files the facilities workstream and T2 edit. `parity.test.ts` asserts exact key-path equality across
all three. Stage named paths only.

T2 is independent of this chain and can merge at any point.
