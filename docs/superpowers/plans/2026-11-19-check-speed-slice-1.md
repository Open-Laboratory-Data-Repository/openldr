# Item 16 slice 1: save a request in one transaction

Spec: `docs/superpowers/specs/2026-11-19-check-speed-options.md`, option 1.
Branch: `feat/check-speed`.

## Goal

`persistResources` saves its list in one transaction, with one wake-up notify after the commit.
A database error on any record saves none of the list. Every caller gets this: the check, the
webhook, the workflow node and ingest.

## Changes

1. `packages/db/src/fhir-store.ts`
   - Move the body of `save`'s transaction into `writeOne(trx, resource, provenance, site)`.
     Nothing in it changes: version from history, meta merge, provenance on conflict, history row,
     then change_log last, so change_log is still never the first write.
   - Add `saveMany(resources, provenance)` to `FhirStore`. It resolves the site once, opens one
     transaction, calls `writeOne` for each resource in order, commits, then sends one notify.
     An empty list opens no transaction and sends no notify.
   - `save(resource, provenance)` becomes `saveMany([resource], provenance)[0]`.
2. `packages/db/src/persist.ts`: both paths validate first, as today, then call `saveMany` once.
3. Test fakes that `persistResources` reaches get a `saveMany`.

## Tests, written first

- `persist.test.ts`: `persistResources` calls `saveMany` once with every validated resource, and
  never calls it when validation fails.
- `fhir-store-save-many.test.ts` (pg-mem): two records of one id in one call get versions 1 and 2;
  one notify per call; an empty list writes nothing.
- `fhir-store-save-many.live.test.ts` (real Postgres, skipped without
  `FHIR_SAVE_TEST_DATABASE_URL`): a failure on record 2 of 3 leaves no rows in `fhir_resources`,
  `resource_history` or `change_log`. pg-mem cannot prove a rollback, so this runs on the
  throwaway Postgres on 54399, in a database it creates and drops.

## Measure

`run.mts` on the same 5,000 requests, `REPO` set to this worktree, twice. Report requests a second,
commits a second, disk flushes a second and the time split. Compare with 50 and 52.2 today.

## Gate

`pnpm turbo run test --force --concurrency=2 --continue` and
`pnpm turbo run typecheck --force --concurrency=2`, in this worktree.

## Not in this slice

The page transaction, the cursor in the same transaction, `unnest` inserts and the per-request
check order are slice 2. A cut mid-page can still save some requests twice, as today.
No UI, CLI or docs change: this changes no user action, only speed and whole-request saves.
The changelog entry is a `fix`/`perf` commit, so `pnpm make:changelog` runs after the merge.
