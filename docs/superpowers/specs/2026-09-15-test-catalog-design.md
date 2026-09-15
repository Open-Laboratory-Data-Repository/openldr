# Test catalog

Date: 2026-09-15. Status: design, approved in chat section by section, not built.

CE should manage three master lists: facilities, patients and tests. Facilities are done.
Patients depend on the country and wait. This spec is the test list: the tests a country offers,
which labs run which of them, and which specimens each test accepts.

---

## 1. Which user action is broken today

AGENTS.md §4 asks this before any feature.

- **The Lab order's test picker searches all of LOINC.** Its Tests field points at the whole
  `http://loinc.org` code system (`packages/forms/src/samples/forms.ts:358`, `referenceTarget`), so an
  author scrolls 100,000+ codes to find a lab's thirty tests. On an install with no LOINC loaded,
  such as the operator's own on 2026-09-15 (0 LOINC concepts), the picker finds nothing at all.
- **Nothing says which specimens a test accepts.** The specimen picker offers CE's whole
  specimen-type list whatever tests were chosen.
- **There is no national list of tests.** Two labs can order the same test under different codes,
  and nothing records which tests a lab runs.

---

## 2. Decisions made in chat

| Question | Decision |
|---|---|
| Own page, or forms only? | Its own page, like Facilities. Forms stay for field layout. |
| What is the catalog for, at first? | A reference list of tests plus the specimens each accepts. Not result entry. |
| Where does it live? | On Terminology: a CE-owned code system, not new tables mirrored into Terminology. |
| How are a test's specimens decided? | Suggested by LOINC's own SNOMED mapping, then kept, removed or added by the lab. |
| Who owns it? | Central keeps the national list. Each lab switches on the tests it runs and may narrow specimens and set a local name. |
| How do tests get in? | Spreadsheet import, plus one-at-a-time adds from a LOINC search. |
| Categories? | A national category list in a CE ValueSet. LOINC's class only suggests. |
| Must every test have a LOINC code? | Preferred, not required. A test with none is flagged "No LOINC" (an outbreak test, or a code the ministry keeps private). |
| Panels? | A panel is just another catalog test for now. Members wait for result entry. |
| What goes in this spec? | The catalog, and the Lab order form's two pickers use it. Tying a specimen to each test is the next spec. |
| Import formats? | CSV and XLSX. Not JSONL: the file comes from a person, and machines already have Terminology sync. |

---

## 3. Facts this design rests on

Each was checked on 2026-09-15 at `bc2637e5`.

- **Terminology entries can hold a list, but an edit wipes it.** `terminology_concepts.properties`
  is `jsonb`. `terms.update` (`packages/db/src/terminology-admin-store.ts:766-774`) and the conflict
  branch of `terms.create` (`:752-759`) write only the five keys `packProps` knows (`:252-260`)
  and replace the rest.
- **CE already has LOINC's specimen map.** The ontology build reads LOINC's
  `AccessoryFiles/PartFile/LoincPartLink_Primary.csv` and `PartRelatedCodeMapping.csv`
  (`packages/terminology/src/ontology/adapters/loinc.ts:14-15`) into `ontology_specimen_map`
  (migration 015): LOINC code, SNOMED specimen code, equivalence. The route
  `GET /api/terminology/ontology/:id/specimens?loinc=` and the studio client
  `ontologySpecimenCodes` (`apps/studio/src/api.ts:2396`) exist. No screen calls them.
- **Corlix builds its suggestions the same way.** Its `specimen_map` comes from the same two LOINC
  files, and its test editor pre-selects a specimen only on exactly one `equivalent` match
  (`corlix/apps/desktop/src/renderer/lib/specimenMatch.ts`).
- **Corlix does not tie a specimen to a test.** Its order holds one `specimen_type`, and its
  specimen picker narrows to the union of the chosen tests' specimens
  (`corlix/apps/desktop/src/renderer/components/ReferenceField.tsx:120-152`).
- **Terminology already syncs to labs.** A lab drains a code system's concepts from
  `POST /api/sync/terminology/concepts` (`apps/server/src/sync-routes.ts:243`). A pull reconciles
  only rows stamped `managed_origin = 'central'` and never touches a lab's own rows
  (`packages/db/src/migrations/internal/049_terminology_managed_origin.ts`).
- **Facilities' own sync to labs was never finished.** Migration 076 had to delete bogus log rows
  it left behind. That is why the catalog rides Terminology sync instead of its own.
- **A picker can search a ValueSet.** `apps/server/src/reference-search-routes.ts:51` expands a
  ValueSet with the typed filter.
- **The warehouse keeps an order's first coding only.** `codeable()`
  (`packages/db/src/relational/extract.ts:24-31`) fills `lab_requests.panel_code`, and several
  reports filter on it (`packages/reporting/src/seed/report-seeds.ts:2345-3139`).
- **`referenceDependsOn` is stored but unused.** It is in the schema
  (`packages/forms/src/schema/form-schema.ts:104`). Data entry ignores it.
- **Existing capabilities cover it.** `terminology.view` and `terminology.manage` exist in
  `packages/rbac`. No new capability means no backfill to existing installs.

---

## 4. Design

### 4.1 Slice S0: stop the property wipe

`terms.update` and the conflict branch of `terms.create` read the stored `properties`, keep every
key `packProps` does not manage, and write the five managed fields over them. Clearing a managed
field still removes it. Creating a new entry is unchanged.

This already destroys data today: LOINC's six axis parts, SNOMED's `fsn`, the AMR
`organism_type` key that partitions the AMR ValueSets, and `result_role`. It ships first and alone.

Tests: an unknown key survives a display-only edit through both paths, and clearing `shortName`
still clears it. `packages/bootstrap/src/facility-reconcile.test.ts:114` pins the bug on purpose
("firstSeen resets if an operator edits the term"). It flips to assert that first-seen survives.

Not repaired: entries already damaged on an install stay damaged. Re-importing LOINC or SNOMED
restores their parts; the AMR organisms need their loader re-run. The docs say so.

### 4.2 Data model

**The catalog.** A CE-owned code system, `urn:openldr:codesystem:test-catalog`, stamped central so
labs receive it through Terminology sync.

- **Code:** the national test code from the spreadsheet. A row with none uses its LOINC code. A row
  with neither is refused. A code never changes once assigned, so adding a LOINC link later keeps
  the test's identity.
- **Display:** the test name.
- **Properties:** `shortName`, `category` (a code in the category ValueSet), `specimenTypes` (a list
  of SNOMED specimen codes), and status `ACTIVE` or `RETIRED`.
- **LOINC link:** a term mapping from the catalog code to its LOINC code, equivalence
  `equivalent`, not a property. Reports and data matching already read mappings. A test with no
  mapping shows "No LOINC".

**Categories.** A small central code system and ValueSet, `urn:openldr:valueset:test-category`,
edited on the Terminology page. It starts with Chemistry, Haematology, Microbiology, Serology and
Molecular. How it is seeded is a plan question: `migration-seeded-changelog-blast-radius` in memory
warns that a migration writing `fhir.change_log` shifts global sequences.

**Lab settings.** A new lab-only table, one row per catalog test the lab has touched: enabled,
a narrower specimen list, and an optional local display name. Sync never writes it. A lab can only
narrow central's specimen list, not add to it.

**The lab's test list.** A lab-only ValueSet, `urn:openldr:valueset:lab-tests`, holding the enabled
tests with their local names. It is rebuilt when lab settings change and when a central catalog
update is applied. Pickers bind to it like any other ValueSet.

### 4.3 The Test catalog page

A "Test catalog" item in the sidebar, next to Facilities. It copies the Facilities page: header
`⋯` menu, paginated table, edit sheets.

**Who edits what, decided from the data.** If the catalog code system was not received from
central, this install owns it: add, edit, import, retire, and switch on for itself. A standalone
lab is its own central. If it was received from central, central's fields are read-only, and the
lab may only switch tests on or off, narrow specimens and set a local name.

**Table.** Columns: code, name, category, specimen types, LOINC (or a "No LOINC" badge), and "On at
this lab". Search by name or code. Filters: category, LOINC status, on or off. Retired tests are
hidden unless filtered for. `StripedEmpty` when empty, `LoadingState` while loading, and
`TablePagination`.

**Menus.** Header `⋯`: Add test, Import from spreadsheet, Export. Row `⋯`: Edit, Switch on or off
at this lab, Retire (central only). No standalone buttons (AGENTS.md §5).

**Edit sheet,** labels left: code (fixed once saved), name, short name, category, LOINC code
(searched in LOINC when loaded, typed otherwise), specimen types, active.

- When a LOINC code is set, the sheet asks `ontology_specimen_map`. Exactly one `equivalent` match
  is pre-selected. Other matches show as suggestions marked "from LOINC". Nothing is added without
  being shown.
- With no LOINC ontology loaded, the sheet says so and falls back to CE's specimen-type ValueSet.
- At a lab, central's fields are read-only text, with the lab's own controls below.

**Phones.** The table scrolls sideways inside its own frame. The sheet goes full width.

### 4.4 Import and export

A national test list is hundreds of rows, a few thousand at most. The import reads the file whole
and runs in the request, with no background job, capped at 5,000 rows. A bigger file is refused
with a message saying so.

**Steps,** in a sheet from the header `⋯` menu:

1. Upload a CSV or XLSX file. XLSX uses the first sheet, through the `xlsx` package already in
   `@openldr/bootstrap`.
2. Map columns. CE matches headers by name and the operator confirms. Name is required. Optional:
   national code, short name, LOINC code, category, specimen types (several in one cell, split on
   `;`).
3. Map values. Category and specimen text match the category ValueSet and CE's specimen-type list,
   ignoring case and spacing. An unmatched category maps to an existing one or is added. An
   unmatched specimen must be mapped, or the row is refused.
4. Review: counts of new, changed, unchanged and refused rows, each refusal with its reason, and
   the rows that will take LOINC-suggested specimens. Nothing is written.
5. Apply, in one transaction, recorded in the audit log.

**Rules.**

- Re-import matches on the test code. The same file twice changes nothing.
- A test missing from the file is not retired. Retiring is always explicit.
- LOINC codes are checked against LOINC when loaded. Otherwise only their format is checked, and
  they are marked "not checked".
- A row with a LOINC code and no specimens takes LOINC's single `equivalent` match, if there is
  exactly one, marked "from LOINC" in the review.

**Export** writes CSV in the import's column layout, so an exported catalog can be edited in a
spreadsheet and imported back.

### 4.5 The Lab order form uses the catalog

**The form.** The sample Lab order changes, and migration 104 repoints stored copies, with the same
exact-match, marker and `down()` discipline as migrations 100 to 103.

- Tests: `valueSetUrl: 'urn:openldr:valueset:lab-tests'` replaces `referenceTarget:
  'http://loinc.org'`.
- Specimen type: `referenceDependsOn: 'tests'`.

**Narrowing at data entry.** When the Tests field holds catalog tests, the specimen picker offers
only specimens at least one chosen test accepts, using the lab's narrowed lists. No tests chosen,
or no specimens on the chosen tests, means no narrowing. The union comes from a new route,
`POST /api/test-catalog/specimens` with the chosen codes. Narrowing applies only when the depends-on
field is a catalog test field; the docs keep saying other depends-on settings are unused.

**The submitted order.** Each chosen test writes its LOINC coding first, when it has one, then its
catalog coding. The warehouse keeps the first coding, so LOINC-coded tests still land in
`panel_code` as LOINC and existing reports keep matching. A test with no LOINC lands its catalog
code and system. The extractor stays pure: the server hands it a lookup built from the catalog's
LOINC mappings. Answers already coded as LOINC keep working, because the extractor reads the
answer's own system instead of assuming LOINC.

### 4.6 Permissions, CLI, done

- **Permissions.** `terminology.view` to see the page. `terminology.manage` to change anything,
  central edits and lab switch-ons alike.
- **CLI** (AGENTS.md §6): `openldr test-catalog list | export | import <file> [--apply] |
  enable <code> | disable <code> | retire <code>`. Each calls the same `@openldr/bootstrap` code as
  the page and audits as `actorName: 'cli'`. Retire is reversible, so it takes no `--force`.
- **Every slice** ships docs in en, fr and pt (studio and web), a 375px check, and a changelog run
  after merging.

---

## 5. Slices

Each merges and works on its own.

- **S0.** The property-wipe fix (4.1).
- **S1.** Catalog data: code system, categories, lab settings table, stores, routes,
  `openldr test-catalog list`. Settle open item 1 first.
- **S2.** The Test catalog page (4.3).
- **S3.** Import and export, page and CLI (4.4).
- **S4.** The Lab order form (4.5): lab ValueSet, pickers, specimen narrowing, extractor codings,
  migration 104.

---

## 6. Tests, and what each layer proves

- **Store and migration tests (pg-mem):** logic and schema. Not boot order: check
  `kysely_migration` after a real boot.
- **Route tests:** the wire shape of the catalog, specimen and import routes. Typecheck does not
  pin these (AGENTS.md §7).
- **Studio component tests:** the page, sheet and pickers render and behave. Not the server.
- **Extractor tests:** LOINC coding first, catalog coding second, old LOINC answers unchanged.
- **Sync test:** a lab pulls central's catalog, and its own switch-ons survive a second pull.
- **HONEST NON-PROOF:** a real central-and-lab run is not planned. The two-node demo setup in memory
  (`two-node-demo-operations`) could prove it later.

---

## 7. Open items for the plan

1. **The lab ValueSet must never sync.** Check how ValueSets reach labs (believed to be through FHIR
   change records) and keep `urn:openldr:valueset:lab-tests` local before S1 starts.
2. **How categories are seeded,** given the change-log warning in 4.2.
3. **Next free migration number.** 104 is next on `main` at `bc2637e5`. Re-check unmerged branches,
   including any on the operator's Linux machine, before S4.

---

## 8. Not in this spec

Recorded so the next specs start from them.

- **Orders** (the next spec). A specimen per ordered test; rejection per specimen, so rejecting a
  serum tube does not mark a CSF test on the same order; adding a test to an existing order; and
  the warehouse seeing every test. Today one order holding several tests reaches `lab_requests` as
  its first test only, because `codeable()` keeps the first coding. In FHIR this is one
  ServiceRequest per test, each pointing at its Specimen, sharing one requisition. It likely needs
  its own Orders page, for the same reasons Facilities got one.
- **Result entry.** Reference ranges attach to a test or panel member with the conditions they
  apply to: age band, sex, pregnancy, altitude band (as corlix's `reference_ranges`). Each lab sets
  its altitude band once; the range is chosen from the patient and the lab, never picked per
  result. Panel members come from LOINC's panel list, already in `ontology_panel_members`.
- **LOINC extras.** The Universal Lab Orders list as a starter catalog, and the `ORDER_OBS` column
  CE's LOINC import skips today.
- **Facilities XLSX import.** Running as its own task. Large registers stay on CSV or JSONL, which
  stream; XLSX is read whole under a size cap.
- **Patients.** A master patient index is wanted by some countries and not others. Not decided.

---

## 9. Verification status

**HONEST NON-PROOF.** No code was written for this spec. Every citation in section 3 was read on
2026-09-15 at `bc2637e5`.
