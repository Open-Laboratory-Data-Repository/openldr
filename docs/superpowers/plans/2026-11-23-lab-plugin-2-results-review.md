# Lab plugin, plan 2: results, review and sending to CE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bench enters results in the lab plugin, picking a named reference range per value. A second person reviews and authorises, or sends the result back. On authorise, the plugin sends the result to CE as FHIR records, so CE's reports and dashboards see it. A finally rejected test reaches CE too.

**Architecture:** As plan 1. The rules live in Rust in `openldr-ce-plugin-lab`, and the page is React. CE gains two host features:
- a read op for a test's result parameters and ranges, worked out for the order's patient;
- `fhir_emit` turning the plugin's patient link into CE's own patient reference.

**Tech stack:** as plan 1.

**Spec:** `docs/superpowers/specs/2026-11-23-lab-plugin-design.md`, sections 7.2, 7.4 and 7.5. The behaviour comes from `2026-11-22-lab-module-design.md` sections 5.6 and 5.7 (entry, review, authorise), `2026-09-16-named-reference-ranges-design.md` (the range picker) and `2026-09-16-bench-result-entry-design.md` (parameters and result types).

## What exists, checked 2026-11-23

- The plugin (local main `b21d6e6`) has Reception and Orders. Tests reach `received` when a sample is linked.
- CE's catalog already works out each test's parameters for a patient with `resultParamsFor(tests, { sex, ageYears })` (`packages/bootstrap/src/test-catalog.ts:241-245`). Each parameter carries:
  - its result type, unit and display;
  - every band with its `name`, `low`, `high`, `criticalLow` and `criticalHigh`;
  - `fits` (`yes`, `no` or `unknown`) for each band.
- **Gap 1, confirmed.** No `ce_read` op reaches `resultParamsFor` (`plugin-host.ts:89-92`).
- **Gap 2, confirmed.** `fhir_emit` stores the plugin's records as sent (`plugin-host.ts:451-480`). The plugin knows a patient only by `pluginRef`, never by CE's patient id, so it cannot write `subject: Patient/<id>`.
- CE's own provenance for a plugin save names only the plugin (`plugin-host.ts:175`). So the plugin sends a FHIR `Provenance` naming the authoriser, as spec 7.5 says.
- The warehouse fills `lab_results` from final, corrected, amended and cancelled Observations only. The lab design 5.6 kept this in core.
- Kept role grants from step 1 include `lab.results.enter`, `lab.results.authorise` and `lab.settings`, on the Lab Technician and Lab Manager roles. Declaring these keys brings them back.

## How Corlix does it

- `apps/desktop/src/main/results.ts:139-200`: save sets the test to `IN_PROGRESS` and records who entered it. An authorised result is locked: changing it is an amendment, not entry (`:137`).
- `:226-300`: submit for review goes to `PENDING_REVIEW`, or straight to `AUTO_RELEASED` when the test needs no verification and no value is critical.
- `:318-378`: authorise sets `AUTHORISED` and records who verified it. Critical values are checked again at authorise.
- `:379-425`: a reviewer's reject sends the test back to `IN_PROGRESS`, and the rejection history is kept on the test.
- Corlix does not stop someone authorising their own result. CE's lab design 5.6 does, unless the lab turns that on. This plan follows CE.

## Rulings

1. **New permissions** (group `lab`):

   | Key | Label |
   |---|---|
   | `lab.results.enter` | Enter results |
   | `lab.results.authorise` | Authorise results |
   | `lab.settings` | Lab settings |

   Each has fr and pt labels.
2. **Test states** gain `in_progress` (values saved), `pending_review` (submitted) and `authorised`. A test in `received` or `in_progress` can be entered. Only `pending_review` can be authorised or sent back. `authorised` is locked: amendments come in a later plan.
3. **Every test needs review** in this plan. Auto-release by test comes with the Settings tab's test list in plan 3.
4. **Self-authorise** is refused unless the lab turns on "Allow self-authorise" in a small Settings tab (`lab.settings`). It is off by default. When it is on, the Provenance says the result was self-authorised.
5. **Values.** One value per result parameter, by result type:
   - numeric, with a unit;
   - coded, from the parameter's value set through `valueset.expand`;
   - text.

   For each numeric value the bench picks one band. The page starts on the first band whose `fits` is `yes`. A band whose `fits` is `no` warns and is allowed (named ranges design, section 3).
6. **The picked band is checked on save.** It must equal a band CE answers for that test and parameter, field by field, name included. Otherwise the save is refused (`invalid`), as in named ranges design decision 6.
7. **Flags** are worked out in Rust from the picked band. The codes are HL7 v3 ObservationInterpretation:
   - `HH` at or above `criticalHigh`, and `LL` at or below `criticalLow`;
   - `H` above `high`, and `L` below `low`;
   - `N` otherwise.

   With no band there is no flag.
8. **Send back** takes a note. It returns the test to `in_progress` and keeps every send-back in the test's history, as Corlix does.
9. **On authorise**, one `fhir_emit` call per test sends:
   - `ServiceRequest`, status `active`, with the test's coding and `subject`;
   - `Specimen`, with type, condition and `receivedTime`;
   - one `Observation` per value, status `final`, with:
     - `basedOn` and `specimen`;
     - `value[x]` by type;
     - `referenceRange` from the picked band, the name as `text`;
     - `interpretation`;
     - `performer` as a display name;
   - `Provenance`, targeting the Observations, with the authoriser as agent display and `activity` "authorise" (or "self-authorise").

   FHIR ids are the lowercase hex sha256 of `lab|fhir|<type>|<plugin id of the thing>`, so a retry overwrites. The plugin's own state changes only after the emit succeeds.
10. **A finally rejected test** is sent as a `revoked` ServiceRequest with the rejection extension `urn:openldr:ext:rejection`. CE's Lab order form uses the same extension (migration 110). A test is finally rejected when:
    - it is rejected without a redraw; or
    - its redraw is linked.

    The emit needs a caller with no data limit. If the site or desk user who rejects has a limit, the send is marked `pending` and goes out at the next authorise or reject by an unlimited user. The Review tab shows pending sends.
11. **CE patient reference.** In any record the plugin sends, a Reference whose `reference` is `Patient/` followed by a `pluginRef` (starting `p1.`) is rewritten by CE to `Patient/<id>`. The pluginRef is resolved for this plugin and inside the caller's data limit. A pluginRef that does not resolve refuses the whole send.
12. **Who sees results.** The Results tab needs `lab.results.enter`, and Review needs `lab.results.authorise`. Values are clinical data, so they show only to those two keys and `lab.worklist.view`. Patient names follow CE's rule, as in plan 1.

## Global constraints

As plan 1, plus:
- CE work goes in a new branch `feat/plugin-results-host` from main. Plugin work goes in branch `feat/results-review` from its main.
- No hardcoded clinical vocabulary. Result parameters, bands, units and coded answers come from CE. Interpretation codes, Observation status and `urn:openldr:ext:rejection` are FHIR or CE system codes.

## Review focus

1. A save that sends a band edited in the page (another `high`, or a made-up name) is refused (Task 3).
2. The person who entered a result cannot authorise it while self-authorise is off, even through a crafted call (Task 3).
3. An authorised result cannot be changed by a save or a second authorise. A retried authorise leaves one set of FHIR records with the same ids (Task 3, Task 6).
4. A send to CE that fails leaves the test in `pending_review`, not `authorised` (Task 3).
5. A site user with only `lab.worklist.view` sees values read-only and cannot reach the Results or Review actions (Task 4).

---

### Task 1: CE `testCatalog.resultParams` and patient references in `fhir_emit` (openldr_ce)

**Files:** `packages/bootstrap/src/plugin-host.ts` and its test; `apps/web/src/docs/0.1.8/{en,fr,pt}/plugin-host-functions.md`; the Rust wrapper in `wasm/openldr-plugin-sdk/src/host.rs` if one is added.

- **`testCatalog.resultParams`** takes `{ tests: [{system, code}] (1 to 20), patientRef }`. It resolves the patient from `pluginRef`, with the caller's limit and not found outside it. It reads the patient's sex and whole-year age, and answers `resultParamsFor` for them, plus `sexes` labels in en, fr and pt.
  - It needs `host:ce-read`, and `patients.view` or `patients.find`.
  - Sex and age are used inside CE only. The answer does not return them.
- **`fhir_emit`** rewrites Reference values per ruling 11 before its existing checks. It refuses the whole send when a pluginRef does not resolve.
- [ ] **Tests:**
  - Bands carry name and `fits` for a known patient.
  - A pluginRef outside the limit is not found.
  - The rewrite works on `subject` and nested references.
  - A bad pluginRef refuses and saves nothing.
  - A plain `Patient/<id>` written by the plugin is unchanged.
- [ ] **Gate** (full, as plan 1), then commit `feat(plugins): plugins read result parameters and send results for a linked patient`. Ask before merging.

### Task 2: Tables, permissions and settings (plugin)

- **Manifest:**
  - add the three permissions;
  - add `emit-fhir` types `ServiceRequest`, `Specimen`, `Observation` and `Provenance`;
  - add the entrypoints of Tasks 3 and 4, with their actionPermissions.
- **New tables:**

  | Table | Columns | Key | Notes |
  |---|---|---|---|
  | `results` | test_id text, facility text, values jsonb, entered_by_id text, entered_by_name text, entered_at timestamptz, version integer | test_id | facility column `facility` |
  | `result_events` | id text, facility text, test_id text, action text (`save`, `submit`, `send_back`, `authorise`), note text null, by_id text, by_name text, at timestamptz | id | facility column `facility` |
  | `fhir_sends` | id text, facility text, test_id text, kind text (`result`, `rejection`), status text (`sent`, `pending`, `failed`), error text null, at timestamptz | id | facility column `facility` |
  | `settings` | key text, value jsonb | key | no facility column |

- [ ] **Tests:** the manifest parses with CE's parser; table shapes are additive over plan 1's; the settings default reads `allowSelfAuthorise: false`.
- [ ] **Commit** `feat: tables and permissions for results and review`.

### Task 3: Results, review and authorise (Rust)

**Entrypoints, with their permissions:**

| Entrypoint | Needs any of |
|---|---|
| `lab_results_worklist` `{ facilityId?, state ('to_enter' or 'to_review'), limit, offset }` | `lab.results.enter`, `lab.results.authorise` |
| `lab_result_params` `{ testId }` | `lab.results.enter`, `lab.results.authorise`, `lab.worklist.view` |
| `lab_result_save` `{ testId, values: [{ paramCode, value, band? }] }` | `lab.results.enter` |
| `lab_result_submit` `{ testId }` | `lab.results.enter` |
| `lab_result_send_back` `{ testId, note }` | `lab.results.authorise` |
| `lab_result_authorise` `{ testId }` | `lab.results.authorise` |
| `lab_settings_get` | `lab.settings`, `lab.results.authorise` |
| `lab_settings_set` `{ allowSelfAuthorise }` | `lab.settings` |

- `lab_result_params` calls `testCatalog.resultParams` with the order's `patient_ref`.
- `lab_order_get` gains each test's result (values, flags, band) and its `result_events`.

**Tests (cargo, fake host):**
- Review focus 1 to 4.
- The flags of ruling 7 at each edge, including equal to `high` and equal to `criticalHigh`.
- A coded value outside its value set is refused.
- Submit with a missing value for any parameter is refused.
- Send back returns to `in_progress` and keeps the note.
- Authorise emits exactly the records of ruling 9, with fixed ids. The fake host records emits.
- A final rejection queues a `rejection` send, and an unlimited caller's next action sends it.
- [ ] **Commit** `feat: results, review and authorise`.

### Task 4: Results, Review and Settings tabs (React)

- **Results tab** (`lab.results.enter`): the worklist of tests to enter, with a facility filter.
  - Opening a test shows a sheet with one input per parameter.
  - A numeric input has the band picker beside it: names, or labels from sex and age as the named ranges design says. The warning shows on `fits: no`, and the flag shows live.
  - The `⋯` menu holds Save and Submit.
  - Port the picker and labels from `apps/studio/src/forms-runtime/TestDetailSheet.tsx`.
- **Review tab** (`lab.results.authorise`): tests to review.
  - The sheet shows values, flags, band names, who entered and the history.
  - The `⋯` menu holds Authorise and Send back (send back opens a note sheet).
  - Pending sends to CE are listed, with a Retry action.
- **Settings tab** (`lab.settings`): one switch, Allow self-authorise.
- **Order sheet** (Orders tab): shows results read-only.
- Same UI rules as plan 1, en/fr/pt, and the contract test extended with Task 3 answers.
- [ ] **Tests:**
  - Review focus 5.
  - The picker starts on the first fitting band.
  - The warning shows on `fits: no`.
  - The flag follows the pick.
  - Authorise and Send back call the right entrypoints.
- [ ] **Commit** `feat(ui): results, review and settings`.

### Task 5: Docs and live proof

- **Docs:** guide sections in en, fr and pt for entering results, reviewing, sending back, authorising, self-authorise, and what reaches CE. Update CE's `lab-plugin.md`: authorised results now reach CE reports.
- **Live check**, on a throwaway CE built from the Task 1 branch:
  1. Enter, submit and authorise a numeric result with a named band.
  2. Check the stored Observation in CE's FHIR store: `final`, with `referenceRange.text`, `interpretation` and `subject` pointing at the real patient.
  3. Check a `lab_results` row appears in the warehouse.
  4. Check a self-authorise refusal, a send-back, and a rejected test arriving as `revoked`.
- [ ] **Commit** `docs: results and review` and `test: live check for results`.

### Task 6: 3220

After the operator approves merging Task 1:
1. Rebuild 3220 and update the plugin.
2. Give Lab Technician `lab.results.enter` (kept grants may already hold it), and Lab Manager `lab.results.authorise` and `lab.settings`.
3. Add a bench user and a reviewer user.
4. Walk the flow in the browser, take screenshots including phone width, put them on the Artifact page, and update `login.txt`.

Order: 1, 2, 3, 4, 5, 6. Task 2 can start beside Task 1.

## Left for plan 3

- Release and the DiagnosticReport per order.
- Amendments.
- The Settings tab's lists, sections and per-test review.
- Auto-release.
- Ruling 8 of CE's old rejection code (an order whose tests are all rejected and which was returned).
- The lab profile pack.
