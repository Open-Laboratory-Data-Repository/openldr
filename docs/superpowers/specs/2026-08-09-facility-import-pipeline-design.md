# The facility import pipeline — an honest preview, strict validation, and imports as jobs

Date: 2026-08-09
Status: designed, not implemented.
Source: `docs/audit/2026-08-07-facilities-page-audit.md` (external audit by Codex) — **FAC-P1-02,
FAC-P1-03, FAC-P1-05**. This is sub-project **A2** of the audit's Phase 1.
Predecessor: `docs/superpowers/specs/2026-08-09-facility-registry-scale-design.md` (**A1**, FAC-P1-01,
merged `65ba30ee`), which opened Phase 1 and carries the five-sub-project decomposition of the 20 P1
findings.

## Purpose

A1 made the registry readable at national scale. This makes it **writable** at national scale, and
makes the write path tell the truth about what it is about to do.

Three defects, all verified against current code (see *Measured before designing*):

1. The browser import refuses to apply more than 2 000 rows and directs the operator to a shell —
   so the primary national-registry use case is unavailable to the administrator it exists for.
2. The "preview" reports `created: 0, updated: 0` because it exits before comparing with the
   registry, and apply then counts every existing row as `updated` whether or not anything changed.
3. Validation is too permissive for national reference data: coordinates are silently discarded,
   ranges are unchecked, controlled fields are unconstrained, and rows that vanish from a later
   release are neither retired nor reported.

## Scope

In scope: **FAC-P1-02, FAC-P1-03, FAC-P1-05**, delivered as **two branches under one spec** (see
*Delivery*).

Deliberately **in scope despite A1's decomposition assigning it elsewhere**: **source→canonical
mapping** for controlled fields, so the importer resolves a release's values against the vocabularies
the facility form is already bound to. FAC-P1-05's own text requires controlled fields to be
"validated using source-to-canonical mappings, not display strings", which cannot be done from the
read path A1 built.

⛔ **The vocabularies themselves are NOT in scope, because they already exist** (migrations 072 and
073 — see *What already exists*). A1's spec listed "canonical status/level vocabularies" under
sub-project **B**; that entry is stale in both directions — the vocabularies were seeded before
either sub-project was written, and only the mapping layer was ever outstanding. **A2 therefore
takes far less of B's scope than an earlier draft of this spec claimed.** B retains retire/merge
lifecycle, duplicate detection, source badges and change history, and general optimistic
concurrency (P1-18).

Explicitly **out of scope**:

- **FAC-P1-04 — registry source identity as a modelled entity.** `nationalSystem` stays a
  byte-for-byte string feeding the deterministic id. No `facility_sources` table, no normalization,
  no historical-variant migration. A2 adds only two things at this boundary: a preview warning when
  the entered value matches zero existing rows (*"this creates a NEW register identity"*), and the
  release recording described below. Modelling the source itself stays in B.
- **Sub-project B otherwise** (P1-06, 07, 08, 09, 18), **C** (P1-11…P1-16), **D** (P1-10, P1-17).
- **FAC-P1-20.** It contradicts this application's standing convention that every action lives in a
  `⋯` `DropdownMenu`; the operator has chosen to revisit that as its own app-wide question. This
  work adds action controls, and **all of them go in the `⋯` menu**, pre-empting nothing.
- **The open follow-ups this does not touch:** `facilities repair-links`; a settle path for
  `facility_mapping_conflicts.resolved_at`; retry backoff on the facility job worker; and A1's
  observation that `health`/`mappingCount` are computed, transported and typed but rendered nowhere.

## Measured before designing

Current code and a real Postgres 17 instance (`openldr_ce-postgres-1`, loopback, Docker Desktop on
Windows), 2026-08-09.

### The three findings, verified

| Claim | Verdict | Evidence |
|---|---|---|
| Apply refuses > 2 000 rows | **True** | `MAX_INLINE_APPLY_ROWS = 2000`, `apps/server/src/facilities-routes.ts:73`; enforced at `:1128` against `preview.parsed`; mirrored client-side as `APPLY_ROW_CAP`, `apps/studio/src/facilities/ImportFacilitiesSheet.tsx:37` |
| Dry run returns `created: 0, updated: 0` | **True** | early return `packages/bootstrap/src/facility-import.ts:251-256`, literal on `:254` |
| Apply counts unchanged rows as `updated` | **True** | `packages/bootstrap/src/facility-import.ts:281` — presence-only, no field is compared |
| Non-numeric coordinate → `null`, no row error | **True** | `packages/terminology/src/facility-csv.ts:58-63` |
| No latitude/longitude range check | **True** | no range check exists anywhere in `packages/` or `apps/` |
| `status`/`level`/`country` not tied to canonical codes | **True — but NOT for the reason assumed** | ⛔ **All three vocabularies already exist**, and the facility *form* is already bound to all three (migrations **072** and **073**). The defect is that the CSV **importer ignores them** and writes free text into columns the form treats as coded. An earlier draft of this spec asserted no level/status vocabulary existed; that was false — see *What already exists* |
| Rows absent from a later release are never retired or reported | **True** | stated in the docblock, `packages/bootstrap/src/facility-import.ts:188` |
| An import racing an operator edit can overwrite it | **True, and already documented honestly** | `packages/bootstrap/src/facility-import.ts:202-220` |
| Duplicate national codes are last-row-wins | **True but NOT silent** | `dedupeById`, `:139-143`; counted into `duplicates`, warned in the sheet (`:356`) and the CLI. The gap is the audit's ask — *quarantine for review* — not visibility |

### Performance — the 2 000-row cap guards a cost that is not there

Scratch database, internal migrations applied, the Q3 MFL release converted to the CSV contract
(13 000 rows, 1.23 MB):

| Operation | Rows | Time |
|---|---|---|
| Dry run (parse only) | 13 000 | **101 ms** |
| Cold apply, empty registry, one transaction | 13 000 creates | **1 101 ms** |
| Warm re-apply of the byte-identical file | 13 000 "updates" | **1 514 ms** |
| **Cold end-to-end, including `projectRegistryRows`** (13 375 concepts created) | 13 000 | **2 689 ms** |
| Warm apply including re-projection | 13 000 | **3 918 ms** |

Two conclusions:

- **The warm re-apply reported `created: 0, updated: 13000`.** That is FAC-P1-03 demonstrated live at
  national scale: re-importing the identical release claims 13 000 updates and zero unchanged.
- **A full national import completes in under 4 seconds.** The cap is not protecting a real cost, and
  the byte cap is not binding either (8 MB limit vs a 1.23 MB file). Therefore **P1-02's
  requirements — upload storage, progress, cancel, resume, reconciliation summary, who-imported-what
  — are product requirements, not performance requirements, and this design does not pretend
  otherwise.** In particular, chunked resumable apply is *not* built: see *Known limits*.

⚠ **Caveats, stated rather than implied away.** Loopback Postgres in Docker on this machine, no TLS,
no concurrent load, a single node, and a registry containing nothing but this import. A remote or
loaded database is slower. It would have to be roughly **100× slower** for a cursored resumable apply
to earn its complexity, and that possibility is handled by re-running an idempotent import, not by a
cursor.

### The test corpus, measured

`../corlix/fixtures/mfl-TZ-2026-Q{1-small,2,3-large}.jsonl` — three successive Tanzanian Master
Facility List releases. **Nothing in `openldr_ce` code references them**; the only repository hits
are in older spec documents.

| Release | `rowCount` | `deletionCount` | Lines |
|---|---|---|---|
| `2026-Q1-small` | 20 | 0 | 21 |
| `2026-Q2` | 500 | 5 | 506 |
| `2026-Q3-large` | 13 000 | 25 | 13 026 |

Each begins with `{"type":"meta","country","version","publishedAt","rowCount","deletionCount"}` and
carries explicit `{"type":"deletion","mflId"}` records. `facilityLevel` takes **five** values across
the corpus — `dispensary`, `health_center`, `hospital`, `lab`, `referral`.

⚠ **The corpus does not map cleanly onto the CSV contract.** `mflId`→`national_code`,
`facilityLevel`→`level`, `countryCode`→`country` are renames; but **`email` has no column at all**
(so it fails the whole file unless `allowUnknownColumns` is set), **`active` has no column** (it is
semantically `status`), and the **`deletion` records have no CSV representation whatsoever**. That
last fact is the reason the retirement policy below needs a release format, not just a flag.

⚠ **The corpus uses ISO 3166 alpha-2 (`TZ`).** The seeded country vocabulary is alpha-3. Every one of
its 13 000 rows would be "invalid" under naive validation — which is exactly why controlled fields
need *mapping*, not merely checking.

### What already exists and must not be rebuilt

- **Ragged-row quarantine** with `info.lines` + byte-exact `raw` and the `allowMalformedRows`
  override; unknown columns fail the file; duplicate headers have no override, on purpose.
- **`blocked`/`blockedReason`** are computed once in `importFacilities` and *reported*, after three
  consumers were each caught re-deriving a narrower predicate that agreed only by accident.
- An applied import **already enqueues one `facility-map-rebuild`** (`facility-import.ts:345`).
- ⛔ **All three controlled vocabularies, already seeded, already bound to the facility form.**
  **A2 builds no vocabulary at all.**

  | Field | ValueSet | CodeSystem | Codes | Seeded by |
  |---|---|---|---|---|
  | `status` | `urn:openldr:valueset:location-status` | `http://hl7.org/fhir/location-status` (HL7's) | **3** — `active`, `suspended`, `inactive` | 072 |
  | `level` | `urn:openldr:valueset:facility-type` | `urn:openldr:cs:facility-type` | **63** — the Tanzanian **HFR facility-type list** (`dispensary`, `health-center`, `district-hospital`, …) | 072 |
  | `country` | `urn:openldr:valueset:country` | `urn:iso:std:iso:3166` | 249 ISO 3166-1 **alpha-3** | 073 |

  `ISO3166_COUNTRIES` (`packages/db/src/iso3166.ts`) is the frozen generated snapshot behind the
  third. ⚠ Two traps 072 records and this work inherits: seeded concept `status` is written
  **UPPERCASE `'ACTIVE'`** because `filterConcepts`/`listSystemConcepts` compare case-**sensitively**
  and a lowercase value silently vanishes from every `activeOnly` query; and neither `compose` uses a
  FHIR `filter` clause, because `value-set-expander.ts` ignores the filter `op` entirely.

  ⚠ **The seeded `status` vocabulary has no `retired` code**, which decides the retirement design
  below. And the seeded level codes are **hyphenated** (`health-center`) while the MFL corpus is
  **underscored** (`health_center`) — so even the corpus's closest match needs a mapping.
- **`term_mappings`** is authoritative (`concept_map_elements` is its mirror), with
  `listOutgoing`/`saveExclusive` on the admin store and a **shipped** `TermMappingDialog` at
  `/terminology` for authoring.
- **`retireRegistryConcepts`** (`packages/bootstrap/src/facility-reconcile.ts:1746`) retires the
  projected *concept*, not the registry row, and only when no other facility claims the code.
  ⚠ Measured in Phase 0: a `RETIRED` concept is **inert to resolution** — its only effect is picker
  exclusion, so history keeps resolving. That is precisely the semantics wanted for retirement.
- **`BlobStoragePort`** with `putStream`/`getStream`, and the terminology distribution upload
  (`apps/server/src/terminology-admin-routes.ts:442-463`) as a working stream-upload precedent.
- **`TerminologyIngestJobStore`** — `blob_key`, `phase`, `processed`, `total`, `updateProgress`,
  one-active-per-system enforced by a pre-check plus a unique `active_key` index, and `insertRunning`
  for an inline CLI run that must never race the server worker.
- **`parseJsonlTerms`/`parseJsonlLine`** (`packages/terminology/src/terms-csv.ts:266,305`) — a
  line-numbered JSONL parser already living in the same package as `facility-csv.ts`.

### Two type facts that decide correctness

- ✅ **Coordinates are safe.** Migration 070 chose `double precision` *specifically* because
  node-postgres returns `numeric` as a **string** with no type parser configured, "which would make
  `FacilityRecord.latitude/longitude` a type lie in production even though pg-mem returns real
  numbers in tests" (`070_facility_registry.ts:31-34`). Values round-trip as real numbers.
- ⛔ **Timestamps are not.** `FacilityRegistryTable` declares `created_at: string; updated_at: string`
  (`packages/db/src/schema/internal.ts:266-267`) while the columns are `timestamptz` and the driver
  returns `Date`. The sibling `facility_jobs` row type declares `Date` and normalizes every read
  through `new Date(...)`. **The conflict watermark must compare `new Date(x).getTime()`, never
  strings.**

### Why `FacilityJobStore` is the wrong base

`activeKeyFor` keys whole-dimension work on **the kind alone** (`packages/db/src/facility-job-store.ts:61`)
— which is exactly right for `facility-map-rebuild` and exactly wrong for an import: two uploaded
registers would coalesce into one job and one file would be silently discarded. It also has no
progress fields and no cancel. `TerminologyIngestJobStore`, which **throws** on a second active job,
is the correct model.

## Delivery — two branches, one spec

| Branch | Findings | Content |
|---|---|---|
| **A2a** `slice/facility-import-truth` | P1-03, P1-05 | Classification engine, strict validation, canonical vocabulary + mapping, retirement policy, conflict watermark, release recording. **Creates the `facility_import_runs` migration and writes runs synchronously**; the job-only columns (`blob_key`, `phase`, `processed`, `total`, `cancel_requested`) exist but stay unused. No blob upload, no worker. |
| **A2b** `slice/facility-import-jobs` | P1-02 | Stream upload into blob, the run store's claim/progress/cancel surface, the worker, confirm-then-apply, removal of the row cap. Adds no columns. |

A2a is a **prerequisite**, not merely first: P1-02's "final reconciliation summary" *is* P1-03's
counts. Shipping the job machinery first would deliver a background import that reports
`created: 0, updated: 13000` at national scale — worse than refusing. `FacilityImportResult` gets its
final shape in A2a, including the fields only A2b populates, so it changes once.

⚠ **Scope note.** A2a as specified is comparable in size to the whole Phase 0 slice. If it must be
trimmed, the natural cut is the vocabulary and mapping half (**Design §4**); everything before it
stands alone and delivers the honest preview on its own.

## Design

### 1. One function, and the dry run stops lying by construction

`importFacilities` remains **the one function** both the HTTP route and the CLI call. Its dry-run
path stops early-returning: preview and apply become *the same computation*, differing only in
whether the transaction commits.

This is the load-bearing structural decision. A separate preview implementation could drift from
apply, and this file has already been bitten by exactly that class of bug — three consumers each
re-derived `blocked` slightly differently and agreed only by a coincidence of the parser's shape.
Preview honest *by construction* is stronger than preview honest *by test*.

Pipeline: **parse → validate → dedupe → look up existing → classify → (apply only) write**.

### 2. Classification, and two fields that are `null` rather than `0`

Per-row buckets: `create`, `changed`, `unchanged`, `conflict`, `invalid`, `duplicate`,
`quarantined`, `skipped`. Release-level: `absent`, `deleted`.

⛔ **`conflict` and `absent` are `number | null`, and this is the entire lesson of FAC-P1-03.**

- **`conflict` is `null` on preview.** The watermark does not exist until the preview establishes it,
  so conflicts genuinely cannot be evaluated. Reporting `0` would be the same lie the finding is
  about: a not-computed value dressed as a measurement.
- **`absent` is `null` unless the release is declared complete.** For a partial district register,
  "absent" has no meaning, and `0` would assert that every existing facility was present in the file.

**`changed` compares against what will actually be written** — after the `local_code`-preserve and
`extras` shallow-merge that `importFacilities` already performs. Comparing raw parsed records instead
would mark every row carrying operator-curated `extras` as changed forever, reintroducing the same
defect one layer down. `extras` compares canonically with sorted keys (`canonicalHash` already exists
for this).

Compared fields: every column the parser produces, plus merged `extras`. Never `local_code`
(the importer is not authoritative for it), never `created_at`/`updated_at`.

**Samples.** Each bucket carries a bounded sample (50) of rows with old/new values for the differing
fields. The complete classified result is written to blob and offered as a download — 13 000 row
diffs do not belong in a `jsonb` column.

### 3. Validation (FAC-P1-05)

- `num()` splits: blank stays `null`; **non-numeric becomes a row error** carrying line number and
  raw value, not a silent `null`.
- Latitude `[-90, 90]`, longitude `[-180, 180]`, validated **as a pair** — one present without the
  other is an error, because half a coordinate is not a location.
- Invalid rows go to `invalid` and are excluded from the write. There is an explicit override in the
  same idiom as `allowUnknownColumns`/`allowMalformedRows`, so a problem file has one consistent way
  to proceed anyway.
- **Duplicate identities** are reported with their line numbers and the values that differ between
  them, and can be quarantined rather than collapsed (the audit's ask). Last-row-wins remains
  available as the explicit, documented choice.

### 4. Controlled fields — canonical vocabulary and source→canonical mapping

⛔ **A2 seeds no vocabulary and writes no vocabulary migration.** All three canonical systems already
exist and the facility form is already bound to them (see *What already exists*). The defect is
purely that the importer does not use them. **This is a correction to an earlier draft of this spec,
which proposed seeding `status` and `level` — that work is already done in migration 072.**

What A2 adds is only the layer between a source's values and those existing systems:

**Mapping is additive and never blocking.** For each field, the source's observed values are captured
byte-for-byte as concepts in a per-source coding system (mirroring `observedSystemForFeed`'s
slugify-with-hash-fallback, `packages/db/src/facility-observed.ts:278`), and the operator maps them
to canonical codes in the **already-shipped** `TermMappingDialog`.

- Mapped → the **canonical code** is written to the column and the **raw source value is preserved**
  under a reserved `extras` key (the audit's "normalize only under documented rules and preserve the
  raw source value").
- Unmapped → **the raw value is written exactly as today**, and preview reports an `unmapped` count
  per field with the distinct values and a route to the mapping dialog.

So behaviour is a strict superset of current behaviour. A first import against an empty `level`
vocabulary reports 13 000 unmapped and still works.

⛔ Raw values live in `facility_registry.extras`, **never in concept `properties`** — `terms.update`
rewrites `properties` wholesale and would destroy them (see [terms-update-destroys-properties],
and migration 077's precedent for choosing a table over a properties key).

### 5. Retirement — two-tier, operator-gated, never a delete

Preview reports two populations **separately**, with samples:

- **`deleted`** — the publisher declared it gone (an explicit `deletion` record). Defaults to
  *retire*.
- **`absent`** — we inferred it from the row's absence in a release declared complete. Defaults to
  *report only*.

⛔ **Retirement writes `inactive`, not `retired`.** The seeded status vocabulary is **HL7's own**
`http://hl7.org/fhir/location-status`, whose three codes are `active`/`suspended`/`inactive`. There
is no `retired` code, and adding one to a CodeSystem HL7 owns would be inventing a non-conformant
FHIR value. `inactive` is the canonical code for this state; the *retired* semantics are carried by
the concept retirement below, which is what actually removes the facility from the picker.

Apply acts only on what the operator selected. Retiring sets the canonical `status = inactive` **and**
calls the existing `retireRegistryConcepts`, which excludes the facility from the mapping picker
while leaving every historical report resolving. **Nothing is ever deleted**, and absence is never
acted on without an explicit choice.

### 6. Concurrency — a watermark, not a version column

The preview stamps `previewed_at` on the run. At apply, any existing row whose `updated_at` is newer
is classified `conflict`; the default is **skip conflicts**, with an explicit overwrite option.

⛔ **This requires the two calls to be linked, and in A2a they are not today.** Preview and apply are
two independent HTTP requests that share nothing but the CSV body, so there is no watermark to
compare against. **A2a's preview therefore persists a `facility_import_runs` row and returns its
`runId`, and apply passes that `runId` back.** An apply arriving without one is not silently
downgraded to "no conflicts": it reports `conflict: null`, the same not-evaluated signal used
everywhere else in this design. In A2b the run already exists, so the linkage is free and the
contract is unchanged.

`facility_registry` gains **no version column** — general optimistic concurrency is P1-18, sub-project
B's. This closes the import side of the race that `importFacilities`' docblock currently only reports,
and it matters *more* under A2b, where upload → validate → operator-confirms → apply widens the
window from milliseconds to however long the operator takes to read the summary.

⚠ It over-reports: a row touched in an unrelated field still flags. That is the safe direction, and
the same trade `listFailed` already makes on a `requested_at` tie.

### 7. Release recording — `facility_import_runs`

One internal table (⇒ always Postgres; `internalMigrations` takes no engine, so **no dialect
matrix**). It is both FAC-P1-03's durable record and A2b's job row, the way `terminology_ingest_jobs`
is both.

`id`, `national_system`, `source_format`, `blob_key`, `file_hash`, `byte_size`, `release_version`,
`release_published_at`, `declared_row_count`, `declared_deletion_count`, `status`, `phase`,
`processed`, `total`, `previewed_at`, `summary` jsonb, `result_blob_key`, `options` jsonb, `error`,
`cancel_requested`, `requested_by`, `created_at`, `started_at`, `finished_at`, `active_key`.

- **`active_key` = `national_system`**, unique index, **throw not coalesce** — copying
  `terminology_ingest_jobs`, explicitly *not* `facility_jobs`.
- Cleared in `finish` **and** on claim, following `facility-job-store.ts`'s documented reasoning for
  why those two clears are not redundant.
- Any `ORDER BY` + `OFFSET` over this table for the run-history list carries a **unique tiebreaker**;
  pg-mem's scan order is stable and will never reveal its absence.

### 8. Input formats

CSV keeps its current contract, with the release envelope supplied by the operator (version, and a
"this is a complete release" declaration that is what enables `absent` to be non-`null`).

**JSONL release format becomes a first-class second input.** Its `meta` header supplies
`version`/`publishedAt`/`rowCount`/`deletionCount` (the declared counts are cross-checked against
what was parsed and reported when they disagree), and its `deletion` records are the **only** path to
publisher-declared retirement. Prior art: `parseJsonlTerms`/`parseJsonlLine`.

### 9. A2b — the job flow

1. `POST /api/facilities/import/upload?nationalSystem&format` — streams `req.body` to blob via
   `putStream`, through a hashing `PassThrough` so `file_hash` is computed without buffering.
   Inserts the run; **409 when one is already active for that `national_system`**. Returns `runId`.
2. Worker claims → `validating` → `getStream` → parse, validate, classify → writes `summary` and the
   full result blob, stamps `previewed_at` → `awaiting_confirmation`.
3. `GET /api/facilities/import/runs/:id` — polled for phase/processed/total, then renders the
   reconciliation summary; the complete result is downloadable.
4. `POST …/confirm` carrying the operator's choices → `applying`.
5. Worker applies in **one transaction**, then projects and enqueues `facility-map-rebuild` exactly
   as `importFacilities` does today, and writes the same `facility.import` audit record.
6. `POST …/cancel` sets `cancel_requested`, checked at phase boundaries and between insert chunks.
7. Restart recovery reuses the `failStaleRunning` pattern.

The worker follows `createFacilityJobWorker`'s shape (tick, claim, process, bounded attempts) and
`terminology-ingest-shared.ts`'s progress reporting.

### 10. UI and CLI

**Studio.** The import sheet becomes upload → progress → reconciliation summary → confirm. ⛔ Every
action stays in the `⋯` `DropdownMenu` per [ui-actions-in-dots-menu] — no standalone Upload/Confirm
button, no footer Cancel/Save — and the existing label-left/input-right `grid-cols-[auto_1fr]` layout
carries over. The browser stops doing `f.text()`; the `File` is the request body.

**CLI** ([cli-operator-parity]). `openldr facilities import` stays **synchronous and direct** — it is
automation, and a job queue would cost it its exit code — but records a `facility_import_runs` row
so "who imported which release and when" is uniform, using the `insertRunning` idiom
`terminology-ingest-job-store` already provides for an inline run that must not race the server
worker. New flags mirror every UI choice (format, release version, complete-release, retirement per
tier, conflict policy, validation overrides). Adds `openldr facilities import-runs list|show <id>`.

## Testing

**Mutation-prove every behaviour**, and design each mutation as the plausible *wrong implementation*,
not a broken edit — a mutation that throws proves nothing about a silent defect. Split guards so a
first throwing assertion does not leave later ones unproven.

- **The `changed`/`unchanged` classification must be tested against real Postgres**, not only pg-mem,
  under the existing `TARGET_DATABASE_URL`-gated pattern (`reset-roundtrip-live.test.ts`, migration
  015's test). The finding is a type/round-trip question and pg-mem returns different types than the
  driver.
- **The headline regression test**: re-importing a byte-identical release reports `unchanged: N`.
  The current-behaviour baseline is measured (`updated: 13000`), so this has a real before/after.
- **pg-mem hazards** that apply here: zero correlated-subquery support; no rollback on a thrown
  error; `numInsertedOrUpdatedRows: 1` after a skipped `onConflict().doNothing()`; load-bearing
  insertion order; and stable scan order, which hides a missing `ORDER BY` tiebreaker.
- **Cross-package pinning.** `FacilityImportResult` reaches `@openldr/bootstrap`, `apps/server`,
  `apps/studio` and `packages/cli`. The route handler has no return-type annotation and Fastify's
  generics are loose, so **route tests are the only thing pinning the wire shape** — A1 shipped a
  breaking `list()` change with typecheck 34/34 green.
- **The MFL corpus becomes a real fixture.** Q1→Q2→Q3 as successive releases exercises create,
  change, absent and publisher-declared deletion in one sequence; Q3 is the 13 000-row scale case;
  its alpha-2 country codes are the mapping case.
- **No vocabulary is seeded, so the `fhir.change_log` blast radius does not apply.** Recorded
  explicitly because an earlier draft did propose seeding, and because the single new migration
  (`facility_import_runs`) creates a table only — it writes no terminology resource and therefore
  needs none of 072/073's `seedHistoryAndChangeLog` machinery
  ([migration-seeded-changelog-blast-radius]).

Gate: `pnpm turbo run typecheck test --force`, never piped through `tail`, `--testTimeout=30000` for
whole-package runs.

## Known limits, stated rather than implied away

- **No cursored resumable apply.** A crash during apply is recovered by re-running, which is safe
  because the import is idempotent by construction (deterministic ids + upsert). The audit asks for
  resume; the measurement (2.7 s cold end-to-end) does not justify giving up all-or-nothing
  atomicity, and a half-applied national release is worse than a repeated one. Recorded as a
  deliberate omission.
- **Cancel cannot interrupt the running transaction.** It is honoured at phase boundaries and between
  insert chunks. The UI shows *cancelling* until the worker confirms, rather than claiming a
  cancellation that has not happened.
- **`conflict` over-reports.** Any concurrent touch flags the row, not only a materially conflicting
  one.
- ⛔ **An abandoned preview would have locked its register permanently, and this document did not say
  so.** `active_key` is set by `startPreview` and cleared only by `finishApply`; nothing expires it.
  So "preview, then decide not to proceed" — the most ordinary abandon path in any preview UI — would
  have 409'd that register forever, short of a database reset. This was an **unnoticed gap, not an
  accepted limit**: it is recorded here because a reviewer correctly observed that the limits below
  named cancel-during-apply but never this. Closed in the route during implementation: a new preview
  **supersedes** a run still in `previewed` state (one retry, never any other state). A full
  cancel/expire surface remains A2b's.
- **Unmapped controlled values do not block an import.** They are counted and listed; the raw value
  is written. A deployment that never authors mappings gets exactly today's behaviour plus a warning.
- **The seeded `level` vocabulary is Tanzania's HFR list (63 codes).** That is what migration 072
  shipped; it is not a universal facility-tier vocabulary. A deployment in another country maps its
  source values onto it, or extends the CodeSystem — A2 neither assumes nor enforces a fit, and the
  `unmapped` count is what makes a poor fit visible instead of silent.
- **Retirement writes `inactive`, which is weaker than "retired".** HL7's location-status vocabulary
  has no retired code; the retired semantics live in the concept retirement (picker exclusion), not
  in the registry column. Anyone reading `status` alone cannot distinguish "the ministry closed it"
  from "it fell out of the last release".
- **`nationalSystem` remains free text.** A2 warns when a value creates a new register identity but
  cannot prevent `HFR` and `hfr` diverging. That is FAC-P1-04, sub-project B's.
- **No rollback/revert operation.** The audit asks for revert as a new audited operation; A2 records
  every run durably (which is the prerequisite) but does not implement revert.
