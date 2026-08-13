# One code, one system

**Slice 2 of 2.** Slice 1 (`2026-08-13-facility-reference-round-trip-design.md`) merged as `ec84f744`.

A facility carries two code columns — `local_code` (OURS) and `national_code` (THEIRS). The operator
who built this registry does not think of them as two things, and neither does FHIR. This slice
collapses them into one code plus the system that names it.

Agreed with the operator on 2026-08-13, after they hit the confusion directly: registering a facility
by hand, they moved their code from Local into National and were refused.

---

## Why

**The fallback is the defect generator.** `registryPreferredCode = localCode ?? nationalCode`
(`packages/db/src/facility-observed.ts:170`) exists only because there are two columns. It is what
made the Facilities table show one code while the Edit sheet bound the other — the audit's F1. With
one column there is nothing to fall back to.

**Identity becomes uniform.** `(facility_system, facility_code)` unique replaces three separate
rules: `local_code` UNIQUE, the partial `(national_system, national_code)` UNIQUE, and the
`facility_registry_has_a_code` CHECK (`packages/db/src/migrations/internal/070_facility_registry.ts:12,47,53-57`).

**"Adoption" stops existing.** A facility acquiring a national code was a special case needing a
re-key. With one system column, the operator just names the right system. The refusal added in the
manual-registration slice (`apps/server/src/facilities-routes.ts`, PUT) goes away with the case it
guarded.

**An LIS code was never a registry column.** The ingestion-side code lives in
`facility_map.source_code` (`packages/db/src/migrations/external/012_facility_map.ts:31-32`), which
is the Observed side. `local_code` was a place for people to put the wrong thing.

**It is more FHIR, not less.** `Location.identifier` is `Identifier{system, value}` — one pair. Two
discriminated identifier fields never were.

---

## The shape

| Column | Holds |
|---|---|
| `facility_id` | the internal surrogate — unchanged, still the row's primary key |
| `facility_system` | the register's **canonical URI**, e.g. `urn:zm:mfl` |
| `facility_code` | the code that register carries for this facility |
| `name` | unchanged |

Unique on `(facility_system, facility_code)`. Both NOT NULL.

**Not named `system_code`.** `coding_systems.system_code` already exists and holds the SHORT code
`ZM_MFL`, while the URI lives in `coding_systems.url`
(`packages/db/src/migrations/internal/012_terminology_admin.ts:58`). A facility column called
`system_code` holding a URI would read as the opposite of the one already in the schema. The UI can
still label it **System** and show the register's friendly name; only the stored value is the URI,
because `idFor`, `observedFieldSystem` and `resolveFacilityRegisterForImport` all key on it.

### Data migration

- `facility_code` ← `coalesce(national_code, local_code)`.
- `facility_system` ← `national_system` when `national_code` is present, else the install's local
  system.
- **A row holding BOTH keeps the national pair**, and its `local_code` moves into
  `extras.__localCode`. Lossless, and the register's identity stays authoritative. The importer
  preserves a hand-assigned local code through re-import
  (`packages/bootstrap/src/facility-classify.ts:38-41`), so such rows exist on a live deployment even
  though the dev install has none.
- A row with only a `local_code` needs a system. That is what `lab.facilitySystem` below is for; a
  row migrated before the operator sets one gets the install-local URI.

⛔ The migration must **not** re-key any row. Ids stay exactly as they are — see "The importer stops
keying on the id" below for why that is safe.

---

## Settings owns the default

`lab.facilitySystem`, beside `lab.name` / `lab.address` / `lab.contact` / `lab.logo`
(`apps/server/src/settings-routes.ts:17-20`), on the Settings → Laboratory page.

The operator's point: they already tell OpenLDR their lab's identity once. The register their
facilities belong to is the same kind of fact, and retyping a URI per facility is a headache with a
typo at the end of it.

⛔ It stores a **pointer to a registered register**, never free text — a picker over
`/api/facilities/import/sources`. `idFor` hashes the system string without normalising it, so a typed
label mints a second permanent identity for one register. That is precisely the defect migration 082
had to clean up, and free text here would re-open it.

The facility form's System field defaults from this setting.

---

## The form

Required when a form targets the Facilities page: **System, Facility code, Name.** Nothing else.

`page-targets.ts:40` currently declares `requiredKeys: ['localCode', 'name']`, and its own comment
(`:30-33`) justifies that with *"A template has no field for national_code, so localCode is the only
code a template-driven row can ever carry"*. Migration 085 added that field, so the comment is
already stale and the list is already wrong. This slice replaces it with
`['facilitySystem', 'facilityCode', 'name']`.

Field order: System first, then Facility code, then Name. **Local code is removed from the form
entirely.**

---

## The importer stops keying on the id

`idFor` is computed in exactly three places — `packages/terminology/src/facility-csv.ts:414`,
`facility-release.ts:175`, `apps/server/src/facilities-routes.ts:1320` — and **nothing ever looks a
row up by recomputing it.** The importer matches with `WHERE id IN (...)` over ids the parser stamped
(`packages/bootstrap/src/facility-import.ts:678, 798`).

So the derived id is a write key, not an identity contract. Resolve an existing row by
`(facility_system, facility_code)` before falling back to the derived id, and no id ever has to move —
not in the migration, not on an edit, not ever.

That is what makes the whole slice safe: `facility_concept_projection.registry_id`,
`facility_jobs.registry_id`, `facility_map.registry_id` and `audit_events.entity_id` all keep pointing
at rows that never moved.

⛔ The pair lookup must run **inside the write transaction** (`facility-import.ts:824`), or a
concurrent create slips between the lookup and the write.

---

## The fork the operator has to decide

`facility_map` is the reporting dimension in the **external warehouse**, and it carries its own
`local_code` and `national_code` (`012_facility_map.ts:39,46-47`). Both are **exposed to the query
builder**: `EXTERNAL_TABLE_COLUMNS.facility_map` lists them
(`packages/db/src/schema/external.ts:198`) and `HARDCODED_DENY_UNION.facility_map` hides only `id` and
`registry_id` (`packages/dashboards/src/models/registry.ts:31`) — deliberately, with a comment saying
the public codes are what a report should quote.

**A** — merge them there too. Consistent everywhere, and the warehouse matches the registry. Any saved
report design, custom query or dashboard widget selecting or filtering `facility_map.local_code` or
`.national_code` **breaks**.

**B** — leave `facility_map` alone, writing the one registry code into both columns for now. Nothing
user-facing breaks. The warehouse keeps a two-code shape the registry no longer has, which is a
smaller inconsistency than a silent break, and can be retired later behind a deprecation.

**Decided: B**, measured 2026-08-13 on the live install. A stays available later as its own change.

### What the count found

409 text/json columns scanned across the internal database. **No saved operator content references
either column name**: `report_designs` (9 rows), `custom_queries` (11), `dashboards` (1),
`reports` (9), `report_schedules` (0) — zero hits in every one. Shipped reports are clear too;
neither column appears in `packages/reporting/src`, and the seeded reports join `facility_map` on
`source_system`/`performer_system`/`source_code`.

The nine columns that DO hit are mechanical and unaffected by a rename: `audit_events` before/after/
metadata (facility write history), `facility_import_runs.summary`, the Facility form in
`form_definitions`/`form_versions` (which migration 086 owns anyway), and `kysely_migration.name`
holding the literal string `085_facility_national_code_field`.

### ⛔ The one that decides it

`column_exposure_policy` holds **explicit rows** for `facility_map.local_code` and
`facility_map.national_code`, both `hidden: false`, `updated_by: seed`. Under fork A, renaming those
columns without carrying these rows drops them from the runtime policy and silently falls back to the
hardcoded default — a privacy-relevant failure that no test would catch.

Under B, `facility_map` is untouched and those rows stay valid. That is the strongest argument for B,
and it is independent of the report count.

⚠ Fork A would ALSO have been safe on this install's data. The report risk was hypothetical here.
Only this install was measured; another deployment's saved queries are unknown.

---

## Cost

25 live source files (32 touch the columns, 7 of those are frozen migrations that must not be
edited). `packages/bootstrap/src/facility-reconcile.ts` alone holds 29 references. Plus:

- migration 086 on `facility_registry` — 13k rows at national scale
- Kysely types in `schema/internal.ts`, and `schema/external.ts` if fork A
- the seeded form + `packages/forms/src/samples/forms.ts` in lockstep, as migration 085 required
- studio: `Facilities.tsx`, `FacilityDialog.tsx`, `ObservedTab.tsx`, `ColumnMapStep.tsx`,
  `ImportFacilitiesSheet.tsx`, `api.ts`
- CLI: `packages/cli/src/facilities.ts`
- docs, en only

---

## Deliberately not in scope

- **Re-keying rows to derive ids uniformly.** Unnecessary once the importer matches on the pair, and
  it costs the external database and audit history. Its own slice if ever wanted.
- **Storing codes instead of displays** for level/status/country. Still open from slice 1; still costs
  a data migration plus every report grouping on rendered text.
- **Retiring `facility_map`'s two code columns** — that is fork A, deferred under fork B.

---

## Traps

1. **`facility_map` is in a different database.** A migration touching both cannot be atomic. The
   existing `facility-map-rebuild` job is the repair path.
2. **Seven migrations are frozen snapshots.** 070/071/073/077/082/085 and external 012 record what
   the schema *was*. Migration 086 alters; it never edits them.
3. **`packages/forms/src/samples/forms.ts` must move with the migration's snapshot**, and
   `FACILITY_FORM_MIGRATION_BOUND_FIELDS` (`packages/db/src/index.ts:102`) must be repointed at 086 —
   the pin that catches the desync lives on the forms side.
4. **pg-mem cannot show the new unique constraint** any more than it showed the old partial one. The
   duplicate-pair refusal needs a real-Postgres test.
5. **Check for a free migration number at the time of writing.** 085 is the highest today; another
   branch merging first makes 086 wrong, and a gap blocks boot.
6. **`observedFieldSystem` slugifies the system for `term_mappings` namespacing.** Rows migrating
   from a NULL `national_system` to the install-local URI change namespace, so any value mappings
   authored against the old empty-string namespace stop resolving. **Measured 0 on the dev install**,
   so this trap does not fire here — count again on any install before migrating it.
7. **`column_exposure_policy` names columns as data, not as code.** A rename anywhere must carry its
   rows or the Data Exposure policy silently stops covering the column. Fork B avoids this for
   `facility_map`; it applies to `facility_registry`'s own columns if any policy row names them.

## Measured on the dev install, 2026-08-13

| Question | Answer |
|---|---|
| Saved report/query/dashboard references to either column | **0** |
| `column_exposure_policy` rows naming them | **2**, both on `facility_map` |
| Facilities carrying BOTH codes | **0** (rule still needed for other installs) |
| Facilities with a NULL `national_system` | **1** — needs the install-local URI |
| Value mappings under an empty system namespace | **0** |

## Verification

- **Live, with the mouse:** register a facility by hand naming a register and a code; re-import that
  register; confirm the row is **updated**, not duplicated and not failed.
- **Live, with the mouse:** edit an imported facility; confirm no code field is editable into a state
  the next import cannot reconcile.
- **Real Postgres:** two facilities under the same `(system, code)` must be refused.
- **Migration test:** a row with both codes keeps the national pair and parks the local one in
  `extras`; a row with only a local code gets the install-local system.
- **Count first, then migrate:** how many rows carry both codes, and how many value mappings are
  namespaced against an empty system.
- Anything not proven by a click or a command is written down as **HONEST NON-PROOF**.
