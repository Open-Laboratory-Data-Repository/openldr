# Facility imports: one door, not two

Design, 2026-09-07. Removes the inline Preview and Apply path from the studio's import wizard.

## The problem

The wizard has two ways to send the same file to the same importer.

The **inline door** posts the file's text as JSON to `POST /api/facilities/import` and gets a
summary back in the response. The **streamed door** posts the `File` itself to
`POST /api/facilities/import/upload`, which mints a `facility_import_runs` row, stores the blob and
lets the worker validate it. The sheet polls until a summary appears.

Nothing visible drives the inline door any more. Step 2's button is Upload and validate
(`ImportFacilitiesSheet.tsx:1831`) and step 3's is Confirm import (`:1845`). Preview and Apply
survive only as two items in the step header's dots menu (`:1290`, `:1295`).

Keeping them costs three things.

1. **The whole file is read into a JavaScript string** so the inline door can put it in a JSON
   body (`:512`). The comment there already says the streamed door "never touches `csv`, which is
   what keeps a national register out of this tab's memory." The inline door is the only reason
   the read happens.
2. **Two paths through every piece of state.** `reviewResult`, `appliedSummary`, `blockedFor`,
   `reupload` and `stepGate` each carry a branch for a door that is no longer the way anyone works.
3. **A row cap that applies to one door only.** `APPLY_ROW_CAP` refuses an inline apply over 2000
   rows. The streamed door has no cap by design, so the two doors give a national register
   different answers.

**Operator decision, 2026-09-07.** Remove the door from the studio. Leave
`POST /api/facilities/import` and `importFacilitiesCsv` in place.

## RULE 0 pass

Seven premises, each checked before anything below was designed.

| Premise | Finding |
|---|---|
| The streamed door can do everything the inline one does | **CONFIRMED.** The upload route accepts `nationalSystem`, `format`, `completeRelease`, `releaseVersion`, `columnMap` and both parse overrides (`facilities-routes.ts:2343-2418`). Both doors already meet at one value: `reviewResult = previewResult ?? awaitingSummary` (`ImportFacilitiesSheet.tsx:940`). |
| A background run could sit unclaimed with no worker running | **REFUTED.** The API server is the worker. `createAppContext(cfg, { runFacilityImportWorker: true })`, unconditional (`apps/server/src/index.ts:68`). |
| The doors need different permissions | **REFUTED.** `IMPORT`, `UPLOAD` and `MANAGE` are all `facilities.manage`. They differ only in `bodyLimit` (`facilities-routes.ts:39-147`). |
| The CLI would break | **REFUTED.** The CLI calls `importFacilities` from `@openldr/bootstrap` directly (`packages/cli/src/facilities.ts:344,479`). It never touches the HTTP route. |
| Removing Preview removes only Preview | **REFUTED, and this is the real size of the change.** `canApply` is gated entirely on `previewResult` (`:1185`). With no preview, the inline Apply, its confirm dialog, `applyResult`, `APPLY_ROW_CAP` and `overCap` are all unreachable and go with it. |
| The sheet needs the file text for other reasons | **CONFIRMED, and it is the one real obstacle.** `csv` also feeds `suggestColumnMap` (`:562`), the fallback header split (`:576`) and the row-count hint (`:1199`). The server reads only the first line of that body (`facilities-routes.ts:1917`). |
| Something else calls the inline route | **REFUTED.** `importFacilitiesCsv` (`api.ts:1437`) is called from `ImportFacilitiesSheet.tsx` only. Nothing else in `apps` or `packages` calls it. |

## Scope

**In.**

- Delete the inline preview and inline apply from `ImportFacilitiesSheet.tsx`.
- Replace the whole-file read with a head read.
- Re-point or delete the tests that drove the importer through the inline door.
- Docs, one line each in en, fr and pt.

**Out, deliberately.**

- **The server route.** `POST /api/facilities/import` stays, and so does its own test suite. It is
  the importer's HTTP contract and removing it is a public API removal, which is a separate
  decision. Operator decision, 2026-09-07.
- **`importFacilitiesCsv` in `api.ts`.** Left for the same reason. It becomes an unused export,
  which is honest: the client for a route that still exists.
- **The CLI.** It never used this door.
- **Renaming or extracting anything.** Expressions that become tautologies get collapsed. Nothing
  gets a new name and nothing moves to a new file.

## Design

### 1. What is deleted

All of it in `ImportFacilitiesSheet.tsx`.

- `runPreview` and the Preview dots-menu item.
- `handleApplyConfirm`, the Apply dots-menu item, and the `ConfirmDialog` that stood behind Apply.
- State: `previewResult`, `applyResult`, `previewing`, `applying`, `confirmOpen`.
- Derived: `previewDisabled`, `blockedByImport`, `canApply`, `overCap`, `APPLY_ROW_CAP`.
- The `importFacilitiesCsv` import.

`ReconciliationSummary`'s `overCap` prop goes with it. The prop exists to explain an inline-only
refusal, and the streamed door has no row cap.

### 2. What collapses

`reviewResult` becomes `awaitingSummary`. `fromRun` is then true whenever a summary exists, so
`reupload` is non-null wherever the re-upload items are considered, and the six `!applyResult`
guards drop out of their conditions. `blockedFor(previewResult)` has no caller left.

These are collapsed where they become tautologies, in this file, and nowhere else.

### 3. The file read

`selectFile` stops calling `f.text()`. It reads a head slice instead:

```
f.slice(0, HEAD_BYTES).text()
```

`HEAD_BYTES` is 64 KiB. The head feeds exactly what it fed before: `suggestColumnMap`, whose route
splits on the first newline and throws the rest away (`facilities-routes.ts:1917`), and this
sheet's own fallback split for when that call fails.

**Why a slice and not the whole file.** A 64 MiB register currently enters this tab's memory to
supply one header row. The streamed door was built so it would not have to, and this is the last
thing making it happen.

**Why 64 KiB.** A header row longer than that would truncate. The contract has 16 fields and a
real register carries perhaps 30 columns, so a header runs to hundreds of bytes, not tens of
thousands. The number is a ceiling with a wide margin rather than a measured fit, and the truncated
case degrades into a header the route already refuses with a 400.

Two knock-on changes:

- **`emptyFile` stops meaning `csv === ''` and starts meaning `file.size === 0`.** That is a
  better test. `File.size` is known the instant a file is chosen, where the old one waited for a
  read to resolve, so `uploadDisabled` loses the window in which a doomed click got through.
- **The row-count hint goes.** `columnMapRowCount` counted non-empty data lines in the whole file
  to render "This map applies to N facilities in this file". Without the whole file there is no
  count. `rowCount` becomes an unused optional prop on `ColumnMapStep` and is removed with it. The
  authoritative count was always `parsed`, computed by the server, which Review already shows.

### 4. The fallback that stays

`handleRevalidate` falls back to a fresh upload when a run cannot be re-checked (`:766`). Its
comment gives two reasons, and one of them dies here: "a run that came from the inline preview door
stored no file". Every remaining run has a blob.

**The branch stays.** The other reason is still live: a run that has moved past
`awaiting_confirmation` cannot be re-checked either, and `canRevalidate` tests both. The comment is
corrected; the code is not touched.

## What the operator sees change

The dots menu loses two items. Nothing else.

No button changes, no step changes, no label changes. Every visible action on every step already
belongs to the streamed door.

**One behaviour does change, and it is worth naming.** Today a check on a small file can go through
the inline door and write no `facility_import_runs` row at all. After this, every check writes a
run row and stores the file. That is more work per check and it is the point: a check that leaves a
record is a check that can be re-run, cancelled and audited, and `import-run-revalidate` already
depends on the stored blob.

## Testing

State which layer each proves, per `AGENTS.md` section 7.

`ImportFacilitiesSheet.test.tsx` is 2684 lines and 102 `it` blocks. Counted:

| Door the test drives | Blocks |
|---|---|
| Inline only | 48 |
| Both (asserts the upload does NOT call the inline door) | 1 |
| Streamed only | 34 |
| Neither | 19 |

`Facilities.test.tsx` has three more inline ones.

The one that names both asserts `importFacilitiesCsv` was never called, to pin that Upload streams
the `File` rather than its text. That assertion stops meaning anything once nothing imports the
function, so it is dropped and the rest of the test stays.

Every one of the 48 falls in exactly one bucket, and the plan names which:

- **Re-point.** The test asserts how a `FacilityImportResult` is REPORTED: the create/changed/
  unchanged breakdown, `conflict: null` as "not evaluated", the changed-row diff sample, the
  policy Selects appearing only when there is something to decide. The result shape is identical on
  both doors, so these keep their assertions and change only how the summary arrives. Most of the
  48 are here.
- **Delete.** The test asserts something only the inline door had: the 2000-row apply cap, the
  apply-confirm dialog's body and its Cancel label, the inline apply's `runId` linkage. The
  behaviour is gone, so the test goes with it, and the plan says so per test rather than letting it
  vanish quietly.
- **Already covered.** The streamed door has an equivalent test. The inline one is deleted and the
  plan cites the test that covers it.

**A test helper carries the re-pointing.** `reviewWithSummary(summary)` mocks the upload and the
first poll to land a run at `awaiting_confirmation` with that summary, so a re-pointed test changes
one line in its arrange block instead of five. It is built on the `runView` and `uploadNow` helpers
the file already has.

**What the studio tests do not prove.** They mock `api.ts`. They cannot show that the upload route
handles a file the inline route used to, so the fixture registers exercised here are not evidence
about the server. The route's own tests are, and they are untouched.

**HONEST NON-PROOF up front.** No studio test proves the head read is enough for a real register,
because every fixture header in that file is a two-column string. The honest proof is running the
real Zambia MFL export through the wizard in a browser and confirming the map panel still shows all
of its headers.

## Error handling

- **`suggestColumnMap` failing** is unchanged: the fallback splits the head's first line locally
  and the panel renders with no ranked help.
- **A truncated header** looks exactly like a malformed header row and reaches the same 400 the
  route already returns for one.
- **A 0-byte file** is caught by `file.size === 0` before any request is sent, as now.

## Definition of done

Per `AGENTS.md` section 6.

1. **UI.** `apps/studio`.
2. **CLI parity.** Nothing to do. The CLI never used this door and gains no new capability.
3. **Docs.** `apps/studio/src/docs/0.1.0/{en,fr,pt}/facilities.md` lists Preview among the dots-menu
   items (`en/facilities.md:67`). One line each, all three languages.
4. **Mobile.** Re-check at 375x812. The Source step's grid was measured there this morning; this
   slice touches the same step's file row.
5. **Changelog.** `pnpm make:changelog` after merging to `main`.

## Sequencing

Independent of everything else open on this wizard. The value-map Save affordance and toast
feedback are the remaining items and neither reads `previewResult`.
