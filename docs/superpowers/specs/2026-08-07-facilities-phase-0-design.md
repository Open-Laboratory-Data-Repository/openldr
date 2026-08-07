# Facilities Phase 0 — correctness foundation

Date: 2026-08-07
Status: agreed, not implemented
Source: `docs/audit/2026-08-07-facilities-page-audit.md` (external audit by Codex), Phase 0 items 1–4.

## Purpose

Close the four Facilities defects that can silently corrupt master data, silently break an existing
facility mapping, or emit a bogus delete to a downstream lab. **No UI redesign.** The audit is
explicit that a more polished page would make the unsafe states more convincing, and that ordering is
adopted here unchanged.

## Scope

In scope — audit Phase 0 items 1–4:

| Slice | Audit finding | What it closes |
|---|---|---|
| 1 | FAC-P0-02 | `facility_registry` sync is half-registered and can serve a bogus delete |
| 2 | FAC-P0-03 | Ragged CSV rows shift values into the wrong facility columns |
| 3 | FAC-P0-04 | A facility's mapping target moves when a human code changes — or when an *unrelated* facility is added |
| 4 | FAC-P0-05, FAC-P0-06 | Multiple active mappings resolve ambiguously; unsupported map types resolve anyway |

Explicitly **out of scope**, deferred to a follow-up task:

- FAC-P0-07 — `facility_map`'s natural key omits the observed coding namespace (audit Phase 0 item 5).
- FAC-P0-08 — projection/report-dimension updates are not durable or observable (audit Phase 0 item 6).
- All P1 and P2 findings, including the facility-specific Resolve sheet and removing `Browse`.

## Verification of the audit's claims

The audit was checked against the code before being accepted. Recorded here because two findings
needed correction and one was understated.

**Confirmed as written:**

- FAC-P0-02 — `facility_registry` is in `ENTITY_TYPES` (`packages/db/src/reference-change-log.ts:24`,
  `:32`) and the store captures changes (`packages/db/src/facility-registry-store.ts:273`, `:281`),
  but `packages/db/src/reference-apply.ts:313` has no case for it, and a null body makes
  `packages/bootstrap/src/sync-serve.ts:66` emit a **delete**.
- FAC-P0-05 — the mapping query at `packages/bootstrap/src/facility-reconcile.ts:494` has no
  `orderBy`; `.find()` at `:545` takes whatever order the database returned.
- FAC-P0-06 — that same query never selects `map_type`. All five of `SAME-AS`, `NARROWER-THAN`,
  `BROADER-THAN`, `RELATED-TO`, `UNMAPPED-FROM` (`terminology-admin-store.ts:43`) resolve identically.

**Confirmed, but the audit's prescribed fix needed changing:**

- FAC-P0-03 — `relax_column_count: true` (`packages/terminology/src/facility-csv.ts:73`) is real, but
  it was added deliberately: a throwing parser killed an entire 14k-row import over one unescaped
  comma. The fix is therefore per-row quarantine, **not** rejecting the file, and the parser must
  still never throw on a ragged row.
- FAC-P0-04 — real, and worse than stated. `registryConceptRows`
  (`packages/db/src/facility-observed.ts:199-211`) only falls back to `id` on an **in-batch**
  collision, and the two projection paths disagree about what "the batch" is:
  - `projectRegistryRows` (create/update/import) forces only rows in its own batch
    (`packages/bootstrap/src/facility-reconcile.ts:936-942`), so a pre-existing colliding facility is
    never reprojected and keeps its human code;
  - `publishRegistryConcepts` (Scan/Rebuild) reprojects the whole table with no `forceOwnIdFor`
    (`:728`), so the in-batch check flips **both** rows to their UUIDs.

  Deterministic reproduction, and the anchor test for Slice 3:

  > Create facility A with `local_code = 111317-4`. Map an observed code to A. Import facility B with
  > `national_code = 111317-4`. Run Scan. A's mapping is now `targetMissing`, and because
  > `importRows` is upsert-only the orphaned `111317-4` concept remains **selectable in the picker,
  > pointing at nothing**.

  The audit's prescribed fix (key concepts on the immutable `facility_registry.id`) was **rejected by
  the operator**: this codebase already moved *from* id-keyed concepts *to* `local_code ??
  national_code` precisely because operators opened the picker and saw `04ad4974-…` where their
  master list says `111317-4`. Human codes stay; a rename-migration layer carries the burden instead.
  See "Decisions taken" below.

## Decisions taken

Each of these was an operator decision, not a default.

1. **Mapping identity stays on human codes.** Concept `code` remains `local_code ?? national_code`
   with the id-on-collision fallback. A migration layer keeps `term_mappings` pointed at the right
   concept whenever that code changes.
2. **Uniqueness is enforced in the database as well as the application.** A partial unique index,
   plus a transactional supersede on the save path.
3. **Pre-existing conflicting mappings stop resolving** rather than being auto-picked or silently
   deactivated-and-forgotten. They are recorded for review.
4. **A malformed CSV blocks Apply, with an explicit override.** Quarantine with line numbers; an
   `allowMalformedRows` opt-in mirrors the existing `allowUnknownColumns` opt-in.

Two design consequences confirmed with the operator:

- Slice 3's projection link lives in a **new internal table**, not in concept `properties`. There is a
  known open bug where `terms.update` destroys unknown concept properties, which would silently eat
  the link. Fixing that bug instead would widen this task.
- Non-`SAME-AS` mappings are **left active but stop resolving** — the resolver filters them and they
  are recorded for review. Nothing about the stored row changes, only whether it drives reports.

## Risk checked before committing to decision 2

A DB constraint on `term_mappings` can reject an incoming central→lab sync apply. That is safe here:
`term_mapping` is **not** a hold record (`packages/sync/src/pull-worker.ts:40-41` — only
`terminology_system` and `concept_map` hold), so a constraint violation is quarantined, logged to
`sync_activity`, and the cursor advances past it. It cannot wedge a lab's sync stream.

The internal database is Postgres-only (no MSSQL/MySQL branches exist under
`packages/db/src/migrations/internal`), so a partial unique index is available.

---

## Slice 1 — Contain the `facility_registry` sync half-state

**Invariant:** an entity type that has no apply support must not appear in a sync payload at all, in
any form, including as a delete.

Changes:

- Remove `'facility_registry'` from the `ReferenceEntityType` union and `ENTITY_TYPES`
  (`packages/db/src/reference-change-log.ts`).
- Stop capture in `facility-registry-store.ts` (`:273`, `:281`). The `capture` dependency stays on the
  store's interface so re-enabling it later is a one-line change, not a re-wiring.
- Serve: skip the type explicitly in `sync-serve.ts` rather than relying on its removal from the
  union. A legacy row already in `reference_change_log` must not fall through to the
  null-body → delete path at `:66`.
- Apply: reject the type explicitly in `reference-apply.ts` with a named, coded error rather than an
  unknown-entity fallthrough, so a payload from an older central names its own cause.
- Migration `076` (internal): **delete** existing `reference_change_log` rows with
  `entity_type = 'facility_registry'`. Deletion only — no new rows are written, keeping this clear of
  the global `seq` / `pendingPush` baseline blast radius that writing to `change_log` from a migration
  causes.

Tests:

- A `facility_registry` write emits no `reference_change_log` row.
- `sync-serve` over a window containing a legacy `facility_registry` row emits **no record at all**
  for it — specifically not a delete.
- `applyReferenceChange` rejects the type with the named error.
- The existing `index.test.ts:123` pin on the `referenceCapture` list is updated deliberately, not
  incidentally.

## Slice 2 — CSV structural integrity

**Invariant:** a row whose field count differs from the header's is never mapped to columns.

`parseFacilityCsv` changes shape:

- Parse with `columns: false, relax_column_count: true, info: true` — arrays plus line numbers, still
  never throwing on a ragged row.
- Compare each row's field count to the header's. On mismatch, push
  `{ line, raw, reason: 'too_few_fields' | 'too_many_fields' }` to a new `quarantined` result field
  and do **not** map that row to columns.
- Only well-formed rows are mapped to objects, by the existing rules.

`FacilityCsvResult` gains `quarantined: QuarantinedRow[]`. `skipped` keeps its current meaning
(missing a required field) and is not overloaded.

`importFacilities` refuses to apply while `quarantined` is non-empty, unless
`opts.allowMalformedRows` is set — deliberately mirroring the existing `allowUnknownColumns` opt-in so
the file has one consistent "I understand, proceed" idiom. Dry run always reports quarantined rows.

Surfaced in all three operator paths (per the CLI-parity convention): the `POST /api/facilities/import`
response, `openldr facilities import`, and `ImportFacilitiesSheet` — which lists line numbers and raw
content, and disables Apply with a stated reason.

Tests: too few fields, too many fields, an unescaped comma (the audit's exact reproduction), a quoted
multiline name, mixed line endings, a duplicate header, and a 14k-row file with one bad row proving
the other 13,999 still apply under the override.

## Slice 3 — The rename-migration layer

**Invariant:** a `term_mappings` row that resolved to facility X before a projection still resolves to
facility X after it, whatever happened to X's code.

Three parts.

**(a) Make the two projection paths agree.** `projectRegistryRows` widens its input to include any
colliding claimant it discovers, so it reprojects those rows too and computes the same codes
`publishRegistryConcepts` does. Today it forces only its own batch, which is why Scan can flip a code
that a create never would.

**(b) A durable projection link.** New internal table:

```
facility_concept_projection (
  registry_id   text primary key references facility_registry(id) on delete cascade,
  concept_code  text not null,
  updated_at    timestamptz not null
)
```

This answers "what code does row X currently project as?" without reading it back out of a concept,
and is immune to the open `terms.update` property-destruction bug.

**(c) Migrate on change.** Both projection paths route through one shared function. When a row's
desired code differs from its recorded `concept_code`, one internal-db transaction:

1. write the new concept;
2. `UPDATE term_mappings SET to_code = <new> WHERE to_system = FACILITY_REGISTRY_SYSTEM AND to_code = <old>`,
   going through the admin store so the `concept_map_elements` mirror and `reference_change_log`
   capture both happen (`term_mappings` is authoritative, the mirror is not optional);
3. delete the old concept;
4. update `facility_concept_projection`.

Write-then-delete ordering is preserved from the existing `deleteSupersededIdConcepts` contract: a
mid-failure leaves a stale concept for the next projection to retry, never a facility with zero
concepts.

Retirement: a retired or deleted facility's concept is set to `status = 'RETIRED'` rather than
deleted, so the operator's existing `term_mappings` row keeps naming a concept that exists instead
of a dangling code, and the concept is excluded from new selection (the picker is ACTIVE-only).

⚠ Corrected after measurement (whole-branch review): retirement does NOT keep the facility
resolvable. `resolveObservedFacilities` never reads `terminology_concepts` — it re-derives codes
from the live `facility_registry` — so retiring a concept is inert to resolution, and a DELETED
facility resolves as `targetMissing` with reports falling back to the raw performer string.
Retirement's real, and only, effect is picker exclusion plus keeping the mapping's target visible.

Migration `077` (internal) creates the table and backfills it: populate `facility_concept_projection` for every existing registry row from its
current live concept, and report (not delete) concepts in `FACILITY_REGISTRY_SYSTEM` with no
corresponding live registry row.

Tests:

- **The anchor repro above**, end to end: A mapped, B imported with a colliding code, Scan run — A's
  mapping still resolves to A.
- `local_code` renamed on a facility with an existing mapping.
- `national_code` changed on a facility whose `local_code` is null.
- Collision resolved by deleting B — A flips back to its human code and the mapping follows.
- A retired facility resolves historically but is absent from selection.

## Slice 4 — One supported active facility resolution

**Invariant:** an observed `(from_system, from_code)` has at most one active `SAME-AS` mapping into
the facility registry system, and only such a mapping can resolve a facility.

Resolver (`resolveObservedFacilities`):

- select `map_type` and filter to `SAME-AS`;
- if more than one candidate survives, set a new `ambiguous` field on `ResolvedFacility` and resolve
  to **no facility** — never pick one. `ambiguous` joins `assertResolvedFacilityInvariant` so a future
  edit that lets it drift from `resolvedVia`/`targetMissing`/`nonFacilityTarget` fails loudly.

API boundary: the facility mapping save path rejects any `map_type` other than `SAME-AS` with a coded
error, and transactionally deactivates the prior active mapping for the same
`(from_system, from_code)` before writing the new one. Enforcement is at the domain layer, not only
in the UI.

Database (internal migration `078`):

```sql
create unique index term_mappings_one_active_facility_resolution
  on term_mappings (from_system, from_code)
  where is_active and to_system = '<FACILITY_REGISTRY_SYSTEM>' and map_type = 'SAME-AS';
```

The index cannot be created while duplicates exist, which interacts with decision 3. Resolved as
follows, in one migration, in this order:

1. find every `(from_system, from_code)` with more than one active `SAME-AS` facility mapping;
2. record each such set in a new `facility_mapping_conflicts` review table (observed key, the
   competing mapping ids, targets, creators, timestamps, detection time);
3. **deactivate every member of the set** — zero active members means the observed row resolves to
   nothing, which is the "stop resolving" behaviour asked for, while the set survives for review;
4. also record (without deactivating) active facility mappings whose `map_type` is not `SAME-AS`, so
   the review queue explains why an operator's mapping stopped driving reports;
5. create the index.

Reports for affected facilities fall back to the raw performer string until an operator reviews them.
That is the accepted, deliberate cost of not silently choosing a winner.

Tests: two concurrently-created active mappings; `UNMAPPED-FROM` and `RELATED-TO` targets proven not
to resolve; the API rejecting an unsupported `map_type`; save superseding a prior mapping in one
transaction; the migration's conflict detection over a seeded duplicate; and a sync-delivered
conflicting mapping proven to quarantine rather than wedge the pull cursor.

## Acceptance criteria

Drawn from the audit's own minimum acceptance list, narrowed to this task's scope:

- A `facility_registry` write produces no sync record, and no payload can carry the type.
- Extra or missing CSV fields are quarantined with line-level errors; no column shifting occurs, and a
  single bad row never kills a national-scale import.
- A facility identifier change does not break an existing mapping — including when the change is
  caused by an unrelated facility being added.
- Retired and deleted facilities cannot be selected for a new mapping, and an existing mapping onto
  one is not silently erased — it keeps naming a concept that exists, so an operator can still see
  what was chosen. A DELETED facility resolves as `targetMissing` and the report falls back to the
  raw performer string. (Originally written as "remain resolvable for history"; corrected after
  measuring — see the Retirement section.)
- One observed `(system, code)` has at most one active facility resolution, enforced in the database.
- An unsupported mapping semantic cannot resolve a facility.
- Every one of the above has a regression test that fails against the current code.

## Sequencing

Slices 1 and 2 are independent of everything and of each other. Slice 4 depends on Slice 3 only for
migration ordering (Slice 3's backfill should land first so Slice 4's conflict scan runs against a
consistent projection). Each slice merges to local `main` with `--no-ff` and is reviewed on its own.
