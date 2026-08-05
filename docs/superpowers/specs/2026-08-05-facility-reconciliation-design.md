# Facility reconciliation — observed strings → canonical facilities — Design

**Goal:** map the facility strings that arrive in ingested data to canonical `facility_registry`
rows, so reports can print real names instead of a source system's shorthand.

**Approach, decided 2026-08-05:** do it with the terminology machinery CE already ships — a local
coding system of observed facility codes, mapped through `concept_map_elements` — not with a bespoke
`facility_aliases` table. This mirrors what openldr-v2 did (`SYSTEMS.FACILITY = 'DEFAULT_FAC'`,
`asConcept(system, code, display, 'facility', 'coded')` in
`apps/openldr-minio/default-plugins/schema/default.schema.js`) and closes the gap
`facility-registry-workstream` already named: *"CE ALREADY HAS local→standard concept mapping. Do
not rebuild it. What is missing is that facilities carry no code to map."*

---

## 1. Measured state (verified against the live dev DB 2026-08-05 — re-measure before relying on it)

| Fact | Value |
|---|---|
| `diagnostic_reports` rows | 1303, **all** with a `performer` |
| Distinct `performer` values | **23** |
| `diagnostic_reports.source_system` | `webhook-ingest` on all 1303 |
| `facility_registry` rows | **4** (3 CSV-imported, 1 hand-created) |
| `facility_aliases` rows | **0** |
| `facility_aliases` columns | `source_system, source_code, registry_id, created_at, created_by`; PK `(source_system, source_code)`; `registry_id` FK **`ON DELETE CASCADE`** |
| `concept_map_elements` rows | 0 |
| `terminology_concepts` local systems | `urn:openldr:default_org` (646), `urn:openldr:default_result` (83), `urn:openldr:cs:facility-type` (63), `urn:openldr:cs:local` (19) |
| `coding_systems` rows for those | **only `cs:facility-type` and `cs:local`** — `default_org` / `default_result` have none |

### 1.1 ⛔ Three prior claims this measurement FALSIFIED

**(a) "A reconciliation screen shipped today could map almost nothing" — false.** Four of the 23
observed strings already have a canonical row in the registry, and they are the high-volume ones:

| observed | reports | registry row |
|---|---|---|
| `Dodoma` | 247 | Dodoma Regional Referral Hospital |
| `Mnazi Mmoja` | 182 | Mnazi Mmoja Hospital |
| `Muhimbili` | 82 | Muhimbili National Hospital |
| `NHLQATC` | 57 | National Health Laboratory (`local_code = 'NHLQATC'`) |

**568 of 1303 reports = 43.6%** are resolvable on day one. The screen earns its place before any
national register is imported.

**(b) "15 of the 23 strings are truncated at 30 chars" — false.** That was a ROW count. Only **2 of
23 distinct values** are clipped: `International School of Tangan` (9 rows) and
`Ocean Road Cancer Institute (O` (6 rows). The other 21 are a different defect — informal shorthand
(`Dodoma`, `Aga Khan`, `Mbeya Referral`), acronyms (`HYDOH`, `CDCIL`, `DRDAH`, `HAYLH`), and one
outright misspelling (`Bukoba Regional Refferal`).

⇒ This **widens** the justification rather than weakening it. The registry exists to escape
*informality*, of which truncation is one instance. A report that prints `Dodoma` — a REGION — as
the performing laboratory is wrong even though nothing was truncated.

**(c) "`source_system` has to be invented for these" — false.** `diagnostic_reports.source_system`
is a real, populated column (`webhook-ingest` on all 1303). It comes from the ingest workflow's
Persist Store `source` parameter (`INGEST_PERSIST_SOURCE`,
`packages/workflows/src/sample-workflow.ts:44`), which is operator-configurable per workflow.

⚠ **But it is not sufficient as a feed discriminator today.** Every webhook ingest — from every
sending system — carries the same `webhook-ingest`. Under the old `facility_aliases` design, whose
PK is `(source_system, source_code)`, two LIS feeds sending the same local code would have collided
on one key. **A coding system per feed dissolves that**, which is one of the reasons this design
supersedes the alias table.

### 1.2 ⛔ THE ARCHITECTURAL CONSTRAINT — the registry and the observed strings are in DIFFERENT DATABASES

- `facility_registry`, `facility_aliases`, `terminology_concepts`, `concept_map_elements` →
  **`InternalSchema`** (`packages/db/src/schema/internal.ts`), the `openldr` database.
- `diagnostic_reports.performer` → **`ExternalSchema`**
  (`packages/db/src/schema/external.ts`), the `openldr_target` warehouse — which may be **Postgres,
  MSSQL, or MySQL**.

**There is no join between them.** This falsifies §3.2 of
`2026-08-05-clinical-report-performing-lab-design.md` as written ("Resolve `performer` through
`facility_aliases (source_system, local_code)` → `facility_registry.name`") on two counts: the
column is `source_code`, not `local_code`, and the join is cross-database.

The precedent for the fix is already in the repo and documents this exact reasoning —
`packages/db/src/migrations/external/011_terminology_codes.ts`:

> "Reports run against the external warehouse via runConnectorSql, while value_sets lives in the
> internal DB, so a report cannot join terminology unless it is projected here."

⇒ **Resolution must be published to the warehouse as a dimension.** See §4.

---

## 2. The chain

```
diagnostic_reports.performer      "Dodoma"        EXTERNAL warehouse. Verbatim. NEVER mutated.
        │  captured as a concept — code IS the raw string
        ▼
terminology_concepts              urn:openldr:default_fac | Dodoma          INTERNAL
        │  term_mappings (authoritative) + concept_map_elements @ LOCAL_MAP_URL (mirror)
        ▼
 ┌──────┴──────────────────────────────────┬──────────────────────────────────┐
 │ urn:openldr:cs:facility-registry         │ national system                  │
 │ (one concept per facility_registry row)  │ e.g. urn:tz:hfr | 122023-5       │
 │   → facility_registry.id                 │   → facility_registry WHERE      │
 │                                          │      (national_system,           │
 │                                          │       national_code) matches     │
 └──────┬──────────────────────────────────┴──────────────────────────────────┘
        ▼
facility_registry.name            "Dodoma Regional Referral Hospital"        INTERNAL
        │  re-runnable publish
        ▼
facility_map                      EXTERNAL warehouse — what report SQL joins
```

**Three named identifiers this slice introduces**, so nothing is invented at implementation time:

| | |
|---|---|
| `urn:openldr:default_fac` | the observed-facility coding system (default; one per feed) |
| `urn:openldr:cs:facility-registry` | one concept per `facility_registry` row, so the picker has rows to search |
| `facility_map` | the external warehouse dimension. ⛔ **NOT** `facilities`, which already exists as the uncurated projection of ingested Organization/Location resources — the two look joinable and are not. |

### 2.1 Both target routes are allowed (operator decision)

**Precedence is deterministic, never a silent pick between two candidates:**

1. A mapping whose `target_system` is the **registry coding system** wins. The registry is what
   actually holds a printable name.
2. Otherwise a **national** mapping resolves by looking up `(national_system, national_code)` in
   `facility_registry`.
3. If neither resolves to a live registry row, the observed string is reported as
   **`target missing`** (§6) and reports **fall back to the raw string**.

**A report must never print a blank laboratory.** A shorthand name is worse than a canonical one and
far better than nothing.

### 2.2 ⛔ The concept code is the raw string, byte for byte

openldr-v2's `normalizeCode` upper-cases (`default.schema.js:16-19`). That was safe there because
the upper-cased value *was* the stored value. **In CE it is not:** `diagnostic_reports.performer`
stores `Dodoma` verbatim, so a concept code of `DODOMA` would never join and the failure would be
silent — an empty result set, not an error.

⇒ **Store the string exactly as it arrived.** It is a match KEY, not a name. This is also the
standing rule from `facility-registry-workstream`, and CE already has a live bug class here
(`specimen-picker-and-status-casing`: status compared case-sensitively, producing silently empty
expansions).

⛔ **NEVER fuzzy-match.** `Dodoma` is a region; `HYDOH` / `CDCIL` / `NHLQATC` / `DRDAH` / `HAYLH` are
acronyms. A similarity score is confidently wrong precisely where it matters.

---

## 3. Capture

One shared writer, `upsertObservedFacility(system, code)`, is the ONLY thing that writes an observed
concept, so the two paths below cannot drift on shape.

It upserts `terminology_concepts (system, code, display, status, properties)`:
- `code` — the performer string verbatim (§2.2)
- `display` — initially the same string; an operator may curate it, and a re-scan must NOT overwrite
  a curated display
- `properties` — `{ firstSeen, lastSeen, reportCount }`

### 3.1 Ingest hook

`createProjectionRunner` already receives **both** `internalDb` and `relationalWriter`
(`packages/bootstrap/src/index.ts:960-966`), so an internal write from the projection loop is
reachable. When a `DiagnosticReport` projects with a non-null `performer`, the runner calls
`upsertObservedFacility`.

⚠ `projectResource` itself is pure (resource → `RelationalResult`) and per-resource. The hook is a
new side-channel **in the runner**, not a change to the projection contract.
**SKETCH — verify the exact seam against `createProjectionRunner` before writing the task.**

### 3.2 Re-runnable discovery scan

Reads `select performer, count(*) from diagnostic_reports where performer is not null group by
performer` from the warehouse and upserts anything missing.

This is not a redundant second path — it does three things the hook structurally cannot:

1. **Backfills the 1303 historical rows.** An ingest hook only ever sees new data.
2. **Computes `reportCount`**, which is an aggregate over the warehouse. The hook sees one row.
3. **Repairs.** Any gap — a hook added after data landed, a failed cycle, a restored database — is
   recoverable by re-running.

It is idempotent against rows the hook already wrote, and re-runnable is a hard requirement: new
performer values arrive with every ingest.

### 3.3 ⛔ TRAP — the scan MUST register an ACTIVE `coding_systems` row

Measured: `terminology_concepts` holds 646 concepts for `urn:openldr:default_org` and 83 for
`urn:openldr:default_result`, and **neither has a `coding_systems` row** — the loaders
(`packages/terminology/src/loaders/organisms.ts`) never create one.

`TermMappingDialog` builds its system dropdown from
`systems.filter((s) => s.active)` (`apps/studio/src/terminology/TermMappingDialog.tsx:137`), i.e.
`coding_systems` rows.

⇒ **A facility dictionary built the way the organism dictionary was built would populate concepts
that nobody can select as a mapping source or target.** The whole "reuse the shipped UI" argument
fails silently. The scan must ensure a `coding_systems` row exists with `active = true`
(publisher `pub-system`, the `local`-role publisher).

### 3.4 Naming, and why it is not seeded

The default observed-facility system is **`urn:openldr:default_fac`** — v2's
`SYSTEMS.FACILITY = 'DEFAULT_FAC'`, in CE's established `urn:openldr:default_<x>` form
(`packages/terminology/src/loaders/organisms.ts:6`, `loaders/result-parameters.ts:6`).

A second feed gets its own system rather than colliding in one namespace (§1.1c).

⛔ **The dictionary is SITE-SPECIFIC and is never seeded into CE**, for the reason
`organisms.ts` already states about its own dictionary: one deployment's vocabulary shipped as a
product default makes every other deployment silently wrong. The 23 strings here are one Tanzanian
deployment's.

---

## 4. Resolution and the warehouse dimension

**Nothing ingested is ever rewritten.** `performer` stays byte-identical. Resolution is a lookup.

Because of §1.2, a re-runnable **publish** flattens the resolved chain into a new external table
**`facility_map`** — one row per `(source_system, source_code)` carrying the resolved facility's
canonical attributes (name, and the registry columns reports group by: region / district / council /
level / status).

Report SQL then reads:

```sql
left join facility_map f
  on f.source_system = dr.source_system and f.source_code = dr.performer
...
coalesce(f.name, dr.performer) as performing_lab
```

**This is the point of doing it here rather than inside one report.** The dimension serves the
clinical report, the query builder, custom SQL on `/query`, and `q-amr-facility-summary` — which is
effectively empty today for exactly this reason.

⚠ Must be portable across `postgres` / `mssql` / `mysql` — use `keyType` for key/indexed columns and
`textType` only for free text (`packages/db/src/migrations/external/dialect.ts`). ⛔ **Every external
migration test runs Postgres via pg-mem, so engine-portability bugs are INVISIBLE to the gate**
(`terminology-projection-fanout` trap 3).

### 4.1 The registry needs its own coding system — `urn:openldr:cs:facility-registry`

`TermMappingDialog`'s *search* mode picks a target from a system's concepts; *manual* mode makes the
operator type a code. For the registry to be pickable, its rows must exist as concepts — one concept
per `facility_registry` row, `code` = the row's `id`, `display` = the curated name, kept current by
the same publish step. It needs an **active `coding_systems` row** for the same reason §3.3 gives.

The addressable key is **`facility_registry.id`**. Neither `local_code` (NULL on every imported row)
nor `national_code` (NULL on hand-created rows, including `NHLQATC` today) is universally present —
the table's only guarantee is the `facility_registry_has_a_code` CHECK that *at least one* exists.
The operator never types the id; the picker resolves it.

**SKETCH — verify before writing the task:** whether `TermPicker`'s flat search works for a local
system with no ontology index built. `TermMappingDialog:144` gates the hierarchy *browse* button on
`distributions[...].indexStatus === 'ready'`; flat search appears to be separate, but this has not
been confirmed and the design depends on it.

---

## 5. `/facilities` gains an Observed tab

`Registry | Observed`, on the existing page — same `facilities.view` / `facilities.manage`
capabilities, and one click from the registry rows the operator maps INTO, which matters because
mapping and creating-a-missing-facility interleave constantly.

Columns: **observed code · report count · resolves to · ⋯**. Ordered by report count descending.

**Impact ordering is what this surface adds** over the generic `/terminology` page. That page can
list 23 codes but cannot tell an operator that `Dodoma` carries 247 reports and `Mpwapwa` carries 2.
The mapping itself opens the shipped `TermMappingDialog` — no new mapping UI is built.

Row states: **mapped** (shows the resolved name and which route resolved it) · **unmapped** (shows
the string the report will print) · **target missing** (§6).

⚠ Repo UI conventions apply and are non-negotiable here: every action in a `⋯ DropdownMenu`, never a
standalone or footer button; shadcn controls only; edge-to-edge dividers; `TruncatedText` for
clipped labels; `StripedEmpty` / `LoadingState` for empty and loading states. ⚠ Follow
`Facilities.tsx`'s existing `reload({ background: true })` pattern — a plain `reload()` sets
`loading`, the page early-returns a full-page spinner, and the sheet unmounts mid-flow (slice A,
trap 4).

---

## 6. Deleting a mapped facility

Today `facility_aliases.registry_id` is **`ON DELETE CASCADE`**: deleting a facility silently
destroys its aliases and every report quietly reverts to raw strings with no record that a mapping
existed. `concept_map_elements` has the opposite problem — a text `(target_system, target_code)`
with no FK at all, so a delete leaves a mapping pointing at nothing. **Neither tells the operator.**

What ships:

- **Warn before.** Deleting a registry row that mappings point at prompts first, naming how many
  observed codes and how many reports are affected.
- **Surface after.** If deleted anyway, the mapping **survives** and the Observed tab shows
  `target missing`. Reports fall back to the raw string.
- **Nothing is destroyed silently**, and re-creating the facility repairs the mapping.

There is no merge feature on `facility_registry` today. Merge is out of scope.

---

## 7. `facility_aliases` is dropped

The terminology approach supersedes it entirely, and leaving it would put two answers to one
question in the codebase. A migration drops the table (0 rows — nothing is lost), and
`attachAlias` / `detachAlias` / `resolve` / `listAliases` come out of
`packages/db/src/facility-registry-store.ts` along with their tests.

⚠ `facility_registry` is in `ENTITY_TYPES` with neither a serve nor an apply case
(`facility-registry-workstream`, slice 1). That is unchanged by this slice and still must be settled
before sync wiring — `sync-serve`'s `default: return null` converts an unknown type's UPSERT into a
DELETE record.

---

## 8. CLI parity

Repo rule: a new operator capability ships as an `openldr` command too, sharing the same function
the HTTP route calls (`@openldr/bootstrap`, as `importFacilities` already does).

- `openldr facilities scan-observed` — §3.2, with a dry-run default matching `facilities import`
- `openldr facilities publish` — §4, rebuilds `facility_map` and the registry coding system

⚠ Both must be re-runnable and idempotent, and both must report counts (discovered / updated /
unchanged) rather than a bare "ok" — slice A's trap 5 was a UI that read a wrong file as success
because it branched on HTTP status instead of the counters.

---

## 9. Testing

- The scan upserts a missing concept and is **idempotent** on a second run (no duplicate, no
  clobbered curated `display`).
- The scan creates the `coding_systems` row **and it is `active`** — the §3.3 trap. This assertion
  must fail if `active` is false, not merely if the row is absent.
- A concept code round-trips **byte-identically**: `Dodoma` in, `Dodoma` out, never `DODOMA`.
  Assert equality against the exact string, not a case-insensitive comparison — a case-insensitive
  assertion cannot fail on the bug it exists to catch.
- Registry-route and national-route mappings each resolve to the right name.
- **Both** routes present ⇒ registry wins (§2.1). Assert the registry name specifically.
- An unmapped code resolves to `null` and the report prints the raw string — not blank.
- A mapping whose target row was deleted reports `target missing` and falls back to the raw string.
- Deleting a mapped facility warns with the correct affected counts.
- The warehouse dimension is published and re-published without duplicating rows.
- ⚠ Gate: `pnpm turbo run typecheck test --force --concurrency=6` must be 67/67. Before blaming a
  change for a failure, grep `Test timed out` and re-run that package alone — but if a file is near
  its limit, this slice made it marginal; fix it rather than retry.

---

## 10. Out of scope

- **The clinical report's performing-lab field.** `2026-08-05-clinical-report-performing-lab-design.md`
  consumes this and stays sequenced after it. ⚠ **That spec's §3.2 must be corrected** when it is
  picked up: the column is `source_code` not `local_code`, and the resolution is a warehouse
  dimension join, not a cross-database join to `facility_aliases` (which will no longer exist).
- **Facility merge** (§6).
- **Governance** for the new dimension — `JOINABLE_TABLES` / `GOVERNED` / `PII_COLUMNS`.
  `terminology_codes` set the precedent of leaving this until a reader lands
  (`terminology-projection-fanout`, "Not built"). Flagged rather than quietly decided.
- **Importing a national register.** Already possible (`openldr facilities import`, Facilities-page
  upload); none has been imported yet. Tanzania's HFR carries 14,209 facilities but has **no bulk
  export**, which is exactly why reconciliation is the place an MFL code first gets pasted in.
- **`patients.managing_organization`** — 1 distinct value over 1 row. `performer` is the facility
  dimension.

---

## 11. ⛔ CORRECTION (2026-08-05, during planning) — how mappings are actually stored and synced

An earlier draft of this spec claimed `term_mappings` was dead and that mappings live in
`concept_map_elements` at `LOCAL_MAP_URL`, "already excluded from sync". **Reading the full
implementation falsified both halves.**

**`term_mappings` is the AUTHORITATIVE table.** `termMappings.listOutgoing` / `listReverse` read it
(`packages/db/src/terminology-admin-store.ts:567-574`), and `create` / `update` / `delete` write it
FIRST, then write `concept_map_elements` at `LOCAL_MAP_URL` as a **mirror** in the same transaction
(`:575-633`). The mirror is the FHIR ConceptMap projection of the same fact.

⇒ **The resolver reads `term_mappings`, not `concept_map_elements`.** Only `term_mappings` carries
`is_active` (a deactivated mapping must not resolve) and `to_display`.

**Sync, stated accurately:**

- `concept_map_elements` @ `LOCAL_MAP_URL` is excluded from the terminology bulk pull
  (`packages/db/src/terminology-store.ts:178-180`).
- **`term_mappings` IS captured and served** — `capture.record(trx, 'term_mapping', …)` on every
  write, `sync-serve.ts:236-255` serves it, `reference-apply.ts:233-249` applies it.
- A down-sync **cannot destroy a lab-authored mapping**: the delete is guarded by
  `where('managed_origin', '=', MANAGED)` (`reference-apply.ts:274-279`), and a lab-authored row has
  `managed_origin = NULL`.

⇒ Facility mappings authored on the national instance **propagate down to lab nodes**, and a lab's
own mappings survive. Given the national-instance architecture, that is the desired behaviour — but
it is a different mechanism from the one this spec originally described, and the reason it is safe
is the `managed_origin` delete guard, not a `LOCAL_MAP_URL` exclusion.

⚠ **Pre-existing defect noticed while reading, NOT this slice's to fix:** `termMappings.update`
deletes the mirror row using `existing.from_system` / `existing.from_code` but re-inserts using
`input.fromSystem` / `input.fromCode` (`:605-618`). If a caller ever changes the `from` side on
update, the old mirror row leaks. No current caller does.

⚠ **`termMappings.create` auto-creates a DRAFT concept for an unknown target** (`:590-594`,
`draftCreated`). Convenient for national codes, but it means mapping into the registry coding system
before the publish step has run creates a ghost DRAFT concept with no registry row behind it. The
Observed tab's `target missing` state (§6) is what surfaces that.

## 12. Pre-existing oddities found while measuring — NOT this slice

- **`parseTermsCsv` silently drops columns** — already recorded, still unfixed.
- **`codingSystems.upsertByUrl` never re-activates.** It inserts `active: true`, but its
  `onConflict` update sets only name/version/publisher (`:470-478`). A system that already exists
  with `active = false` stays invisible to the mapping UI. §3.3's assertion must therefore check the
  flag, not merely the row's existence.

Related: [[facility-registry-workstream]], [[clinical-report-template-workstream]],
[[terminology-projection-fanout]], [[dont-hardcode-use-terminology]],
[[specimen-picker-and-status-casing]], [[cli-operator-parity]], [[ui-actions-in-dots-menu]].
