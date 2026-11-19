# Item 16: a check does not save a record again when nothing in it changed

Status: design by the maintainer, 2026-11-19. The operator delegated design calls on 2026-11-19 and
chose the scope "check saves only" earlier the same day.
Measurements: `2026-11-19-check-as-bulk-load-research.md`, section "Measured on 2026-11-19".

## Why

Every save makes a new version, whatever the content. Measured on 5,000 real requests:

- 16 percent of the records a check saves are repeats. The plugin sends the same Organization with
  every request (9,658 repeats of 42 records) and the same Questionnaire (1,483 repeats of 2).
- A check that is run again over a source it already loaded doubles the history and takes as long
  as the first run. With the skip simulated in the bench it wrote nothing and ran 1.7 times faster.
- Sync pushes every version to central, one by one, so each repeat is also a push.

## What changes

- A check save skips a record whose content is the same as the latest stored version of that
  record. It writes no history row, no change row and no new version for it.
- Nothing else skips. Webhook, workflow and form saves make a version per save, as today. So the
  arrival record of a laboratory that sends the same result twice does not change.
- A request whose records are all unchanged is still counted as saved.

## Not in this work

- One transaction per page (slice 2b). Key ranges. A queue.
- Changing the plugin so it stops sending the Organization. The skip makes that unnecessary.
- A skip for any other save path.

## What would make this a failure

- A changed record that is not saved.
- A record that was deleted, amended or changed by sync since, and is then skipped because an older
  version had the same content.
- Any change to what a save does when the skip is not asked for.

## Approaches

1. **Store the content hash on each history row, and compare with the latest row. Chosen.** The
   save already reads the end of the history key of each record for its next version number
   (`fhir-store.ts:245-258`). The hash belongs to its version, so it cannot go stale: a writer that
   does not set it (amend, sync, merge, an old row) leaves it empty, and an empty hash never
   matches. One nullable column, added by migration 129.
2. **Read the hash from `fhir.change_log`.** It is already stored there, but that table has no index
   by record. The lookup would scan it, and an index on it would slow every save.
3. **Keep the hash on the current row in `fhir_resources`.** Three other writers update that row.
   One that forgets the hash would leave a stale one, and a later save would be skipped wrongly.

## Design

- Migration `129_resource_history_content_hash`: `fhir.resource_history` gets `content_hash text`,
  nullable. No backfill. Rows from before have no hash, so their first save after the upgrade is
  written, and from then on they can be skipped.
- Every `saveMany` writes the hash on the history rows it adds. It is the same value it already
  writes to `fhir.change_log`: sha256 of the record before the server stamps `meta`.
- `saveMany(resources, provenance, { skipUnchanged })`. With `skipUnchanged`, after the version
  lookup it reads the latest history row of each record that has one. A record is skipped when
  that row is an upsert and its hash equals the record's hash. Within one call the comparison is
  against the record as the call leaves it, so the same record twice is written once, and A, B, A
  is written three times.
- A skipped record's ref carries the stored version. A call that skips everything writes nothing
  and sends no wake-up.
- `persistResources` passes `skipUnchanged` through its options.
- `@openldr/bootstrap` gives the import check its own persist with `skipUnchanged: true`. Copies and
  workflows keep the shared one.

## What it costs and what it leaves

- One more small read per request, by primary key, only for check saves.
- A skipped record keeps the plugin version and run id of the save that wrote it. That is true to
  what is stored: that version was written by that run.
- A skipped save is not an arrival in the warehouse's arrival record. For a check run again over
  the same source that is correct: nothing arrived.

- Found by the branch review: a check run again no longer re-sends unchanged records to the
  warehouse. Someone who used a second check run to refill a wiped warehouse must now use
  `openldr db reproject`, which is the command made for that.
- Found by the branch review: if another save writes a new version of a record between the check's
  read and its write, the check's skip stands. The result is the same as if the check had saved
  first. Before, the check's save failed on the duplicate version and the request was marked failed.

## Tests and proof

- pg-mem unit tests on `saveMany`: unchanged skipped, changed saved, mixed list, deleted since,
  no stored hash, same record twice in a call, skip not asked for. Layer: the store's logic. Not
  Postgres itself.
- `persistResources` passes the option. Migration list test updated.
- Real Postgres and the real plugin on the 5,000 sample: a first run (expect 58,526 history rows,
  not 69,667), then a run again on the same database (expect no new rows). Counts as before.
- Full gate, both halves forced.
- Not covered: the built standalone and the Docker image.

## Definition of done (AGENTS.md section 6)

UI, CLI, user docs and mobile: none, no screen or command changes. Changelog: run
`pnpm make:changelog` after the merge to `main`.
