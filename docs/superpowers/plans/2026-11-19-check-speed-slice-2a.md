# Item 16 slice 2a: fewer statements for each request

Spec: `docs/superpowers/specs/2026-11-19-check-speed-options.md`.
The operator chose on 2026-11-19 to do this first, measure, then decide on the page transaction
(slice 2b). This plan is not approval for 2b.

## Goal

`saveMany` writes a request's records with about four statements in all, where slice 1 uses four
for each record. Nothing else changes: one transaction per request, the same checks, the same
held list and cursor code.

## Change, in `packages/db/src/fhir-store.ts` only

`saveMany(resources, provenance)`, inside its one transaction:

1. Give every resource without an id a new one, before anything else.
2. One lookup of the highest stored version for the keys in the list: one plain
   `select max(version) from fhir.resource_history where resource_type = ? and id = ?` for each
   distinct key, joined with `union all` into one statement and split at 1,000 keys. A plain
   `max` reads one index entry. A grouped lookup was tried first and dropped: `EXPLAIN` showed it
   reading every stored version of a key, and an Organization that every request saves again had
   4,850 versions after 5,000 requests.
3. Number the versions in input order. A key that comes twice gets `max + 1`, then `max + 2`.
4. Build each row exactly as `writeOne` does today: the content hash before the stamp, the meta
   merge with `versionId` and `lastUpdated`, the provenance columns, the site.
5. One multi-row insert into `fhir.fhir_resources`, with `on conflict (resource_type, id) do
   update` from `excluded`. A key that comes twice sends only its last row here, because Postgres
   refuses to update one row twice in a statement.
6. One multi-row insert into `fhir.resource_history`, every row, in input order.
7. One multi-row insert into `fhir.change_log`, every row, in input order, last. It is still never
   the transaction's first write.
8. Each insert is split at 1,000 rows, so no statement passes the 65,535 parameter limit
   (nine columns at most).

`save` stays `saveMany([r])[0]`. `writeOne` is removed, so there is one write path, not two.

Multi-row `VALUES` and not `unnest`: a request has about 14 records, so the parameter limit is
far away, the chunk rule covers any large list, Kysely builds it with types, and pg-mem runs it.
`unnest` matters for whole pages, which is 2b.

## What must stay the same

- A second save of the same content still makes a new version (no skip on equal hash).
- Two writers of one key at once: the loser hits the history primary key, its whole transaction
  rolls back, and it throws, as today.
- `change_log.seq` rises in input order within a call.
- Hash, meta, provenance on conflict, `updated_at = now()` on conflict, and the site stamp.

## Tests, written first

pg-mem (`fhir-store-save-many.test.ts`):
- A list with one key three times and other keys between: history and change_log hold every
  version in input order, and the canonical row holds the last content and version.
- Resources without ids get ids, and each returned ref matches its stored row.
- A key that already has stored versions continues from them.
- Stored content, meta, hash and provenance of a list equal what three single `save` calls give
  (apart from `lastUpdated`).
- A large list saves (pg-mem: 1,001 records, two chunks; real Postgres: 2,500 records).

Real Postgres (`fhir-store-save-many.live.test.ts`):
- The existing three: thrown error, SQLSTATE 23514 refusal, whole request or none.
- `change_log.seq` order equals input order for a 50-row list.
- Two `saveMany` calls on one key, forced to overlap: a barrier holds each writer after its
  versions lookup until both have read, so both number the same version. One commits. The other
  fails with 23505 and leaves none of its own other rows.
- An existing row updated on conflict keeps `created_at` and moves `updated_at`.

Existing suites that must stay green: `fhir-store*.test.ts`, `persist*.test.ts`, the projection
tests, and the whole gate.

## Measure

`run.mts` twice with `REPO` set to the worktree. Compare with 81.1 and 80.6 (slice 1).
The counts and per-type rows must match.
