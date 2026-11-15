# cdr-source plugin: audit, payload, FHIR and the decode entrypoint. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plugin turns the copied rows of a page of requests into FHIR resources, audit findings and a hold-back decision, with every stage equal to the toolchain's output on made-up fixtures and on 20,000 real requests.

**Architecture:** Four plain stages over the request the first plan already decodes: observations, audit, payload, FHIR. Each stage is a function with no clock, no zone and no database, and each is compared with the toolchain at its own boundary. One new entrypoint, `source_decode`, runs them for a page.

**Tech Stack:** Rust (edition 2021, `serde_json`, `extism-pdk` on wasm only). No regex crate: the few patterns are hand-coded. Node 24 and `tsx` for the fixture and check scripts.

**Spec:** `docs/superpowers/specs/2026-11-15-cdr-source-plugin-design.md`, sections 6.2, 6.4, 6.5, 6.7 and 6.10. This plan covers steps 3 to 6 of its section 6.9. Step 7, the fault fixes, gets its own plan after this one matches.

**Where the work happens:** `/home/fredrick/Projects/Repositories/cdr-source`, on a new branch from `main` (`ebcfbe5`). No file in `openldr_ce` or `cdr-toolchain` changes.

**The reference for every rule:** the interface map at `cdr-source/.superpowers/notes/part2b-interface-map.md`. It lists every type, function, rule, constant and setting on these paths with file and line. This plan names the section of the map each task ports. Where the plan and the TypeScript disagree, the TypeScript wins, and the builder says so.

## Global Constraints

- The toolchain is the reference, faults included. A place where the Rust is "more correct" is a defect in this plan. Faults are fixed in the next plan, one by one.
- `cdr-toolchain` is frozen. Read it. Never change it.
- No real patient row in the repository. Fixtures are made up. A tool that reads real rows prints counts and field names, never a value.
- Nothing under `src/` reads the clock, the time zone, the locale, an environment variable or a file. Time comes in as an argument.
- Nothing under `src/` panics on any input. Bad input gives an `Err` with a short code and no row value.
- The toolchain is always run with `TZ=UTC` and with its clock pinned to the `now` the Rust is given.
- Code tables stay in Rust source. The operator decided this on 2026-11-15. Each table carries a comment naming the toolchain file and line it came from.
- An insertion-ordered map wherever the map's order reaches the output. `HashMap` iteration never reaches the output.
- Only the controller may query the container `openldr-mssql`. An implementer never connects to it or to port 1433, never opens a file under a `temp/` or `data/` folder, and never opens a `.env` file.
- A scratch SQL Server container gets `--memory 3g` and `-e MSSQL_MEMORY_LIMIT_MB=2048`, the image already on the machine, a port from 14331 to 14339, a name starting `cdr-scratch-`, and is removed afterwards. One heavy run at a time.
- Never send a request to port 3000. Never touch the dev databases or the container `openldr-docs-system-mssql`.
- The plugin's page, README and strings never name the source system.
- No `Co-Authored-By` line in any commit. Prose follows the `unslop` skill.

## Review Focus

1. **Ordering that JavaScript gets from the locale.** Lab results and superseded runs are sorted with `localeCompare`. A panel code with punctuation or mixed case must sort as Node sorts it. 3 of the 335 panel codes used in the real data have such characters. Test in Task 4.
2. **Numbers printed the way JavaScript prints them.** A 4-byte float widened to a double, a censored limit rounded to 7 digits, a text value such as `0x10` or `1e3` or `Infinity` read as a number. Tests in Tasks 4 and 7.
3. **Ages across a date line.** The toolchain reads a birth date as midnight UTC and a reference time as local. With `TZ=UTC` both are the same line. A birth date after the reference date gives null, not a negative age. Test in Task 6.
4. **A request with nothing to map.** No ordered panels, no results, only documentation panels, or a request id that cleans to an empty FHIR id. The toolchain throws on some of these. The plugin returns an error code for that request and decodes the rest of the page. Tests in Tasks 8 and 9.
5. **Dictionary keys that differ between the two readers.** The decoder finds a parameter by the SQL column, ignoring case and padding. The code book finds it by the code inside the record, exactly. Both must be kept, each for its own caller. Test in Task 3.

---

## File structure

```
src/site.rs           the site profile (Tanzania) and the options of the decode
src/codebook.rs       the code book, built from copied dictionary rows
src/collate.rs        Node's ordering of two texts, for the two sorts that use it
src/observations.rs   flatten, supersede, rejection, number reading and printing
src/audit.rs          the 18 rules, the report, the hold-back decision
src/audit_vocab.rs    specimen kinds and result-format checks
src/payload.rs        requests, patient: ordered panels, linking, facts, status
src/payload_results.rs  lab results, isolates, susceptibility tests, ages, data quality
src/fhir.rs           resources from a payload, and the documentation leg
src/decode.rs         source_decode for a page
tests/golden.rs       one test per stage over every fixture
tests/generate-fixtures.mts, tests/stages.mts   the toolchain run that makes expected values
tools/real-data-check/   the same four stages on real requests
```

`payload.rs` is split in two because one file would pass 900 lines.

---

### Task 1: Carry-overs from the first build

**Files:**
- Modify: `src/request.rs`, `tools/real-data-check/dump.mjs`, `tools/real-data-check/dump-folder.mjs`, `tools/real-data-check/dump-folder.test.mjs`, `examples/decode_file.rs`
- Test: `src/request.rs`, `tools/real-data-check/dump-folder.test.mjs`

**Interfaces:**
- Produces: `PageRows::new(rows: &Value) -> PageRows` now groups every detail's rows by `sql_key(__key)` once. `PageRows::of(&self, detail: &str, key: &str) -> &[&Map<String, Value>]` returns a slice in arrival order. Its callers do not change.

- [ ] **Step 1: Write the failing tests.**

```rust
#[test] fn of_returns_rows_in_arrival_order_for_each_key() { /* keys A, B, A interleaved in one detail: of("tests", "A") gives rows 0 and 2 */ }
#[test] fn of_matches_a_key_the_sql_server_way() { /* "__key": "zzfix1  " found by "ZZFIX1" */ }
#[test] fn a_page_of_500_requests_is_grouped_once() { /* 500 keys, 20 rows each in "texts": every key gets exactly its 20 rows; total rows returned == 10,000 */ }
#[test] fn of_an_unknown_detail_or_key_is_empty() {}
```
and in `dump-folder.test.mjs`: a path with a `..` segment is refused; the function returns the resolved path it checked, and the caller writes to that path.

- [ ] **Step 2: Run** the tests and see them fail.
- [ ] **Step 3: Implement.** In `dump.mjs`, hand the resolved path from the folder check to `mkdirSync` and to the output writer, and refuse any `..` segment before resolving.
- [ ] **Step 4: Run** `cargo test`, the golden tests and `node --test tools/real-data-check/*.test.mjs`. All pass, fixtures untouched.
- [ ] **Step 5: Commit** `perf: group a page's rows by key once` and `fix: the real-data check writes to the path it checked`.

### Task 2: Site profile and options

**Files:**
- Create: `src/site.rs`
- Modify: `src/options.rs`, `src/lib.rs`

**Interfaces:**
- Produces:
  - `pub struct Slot { pub start: usize, pub end: usize }`
  - `pub enum HeaderDate { Long(usize), Short(usize) }`, the byte the date starts at
  - `pub struct SiteProfile { pub name: &'static str, pub doc_panels: &'static [&'static str], pub doc_params: &'static [&'static str], pub forms: &'static [(&'static str, &'static str)], pub reviewer_initials: Option<Slot>, pub reviewed_at: Option<HeaderDate>, pub analysis_at: Option<HeaderDate>, pub analyzer_code: Option<Slot>, pub tester_initials: Option<Slot>, pub request_type: Option<(usize, &'static [(u8, &'static str)])>, pub age_years: Option<usize>, pub age_days: Option<usize>, pub newborn: Option<(usize, u8)>, pub limits: Option<(usize, usize)>, pub section_codes: &'static [(&'static str, &'static str)] }`. `limits` is (high, low).
  - `pub const REQUEST_ATTRIBUTES: RequestAttributes`, with `therapy`, `folder_number`, `reference_numbers`, `unique_id`, `newborn`, each `Option<&'static str>`
  - `pub fn site(name: &str) -> Option<&'static SiteProfile>`
  - `pub struct DecodeOptions { pub site: &'static SiteProfile, pub lab_code: String, pub lab_name: Option<String>, pub tz: String, pub prefix: String }`
  - `pub fn parse_decode_options(v: &Value) -> Result<DecodeOptions, String>`

The one profile is `tanzania`, with the values of the map's section 7, both tables. A profile with every optional field `None` and empty lists is what the toolchain uses for a site with no file; keep one in the tests as `BLANK`.

Option rules: `site` is required and must name a profile, else `site must name a known site`. `labCode` is required, 1 to 64 characters after a trim, else `labCode is required`. `labName` is optional; blank is `None`. `tz` is required and matches `Z` or `+HH:MM` or `-HH:MM`, else `tz must be Z or an offset like +03:00`. `requestIdPrefix` is optional, default empty, at most 32 characters, printable ASCII.

- [ ] **Step 1: Write the failing tests:** each value of the Tanzania profile against the map's section 7 (one assertion per row of the table); `site("tanzania")` found, `site("Tanzania")` and `site("zambia")` not; each option rule with its exact error; unknown option names ignored.
- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`.
- [ ] **Step 5: Commit** `feat: the site profile and the decode options`.

### Task 3: Every stage's expected value, from the toolchain

**Files:**
- Create: `tests/stages.mts`
- Modify: `tests/generate-fixtures.mts`, `tests/plugin-rows.mts`, `tests/fixtures/*.json`, `tests/golden.rs`, `tools/real-data-check/dump.mjs`, `tools/real-data-check/compare.py`, `tools/real-data-check/README.md`

**Interfaces:**
- Produces: `stages(recpt, ctx) -> { request, observations, audit, payload, fhir }` in `tests/stages.mts`, used by the generator and by `dump.mjs`. Each fixture's `expected` becomes that object, and its `input` gains `"options": { "site": "tanzania", "labCode": "TDS", "tz": "+03:00", "requestIdPrefix": "TZDISA" }` and `"now": "2026-01-01T00:00:00.000Z"`.

What `stages` runs, in this order, from the map's section 10. It needs the live object the toolchain fetched, not its JSON.

| Key | Toolchain value |
|---|---|
| `request` | the `SpecimenRecpt` JSON plus `WardClinicResolved`, as today |
| `observations` | `{ kept, superseded }` from `supersedePanelIterations(flattenDisa(recpt))`, and `all` from `flattenDisa(recpt, { includeEmpty: true })` |
| `audit` | `auditFromSpecimen(recpt, prefix, codebook, docConfig.panels)` |
| `payload` | `toV2(recpt, { prefix, site, codebook, auditReport: audit, excludeObs: documentation, blobOffsets, factConfig })` |
| `fhir` | `{ resources: buildCeResources(recpt, payload, { prefix, codebook, docConfig, tzOffset }) }`, or `{ error: true }` when it throws |

The clock is pinned for the whole run: `Date.now` returns the `now` instant, and `new Date()` with no argument gives the same instant. So `elapsed_ms` is 0 and `audited_at` is `now`. The settings come from `loadParmdictOffsets`, `loadCountryDocConfig`, `loadBlobOffsets` and `loadRequestFactConfig` for `tanzania`, with the toolchain's `config` folder passed in.

New fixtures, added to the 18: an organism with two antibiotics, one S and one R, units `mm` and `mg/L`; a no-growth organism code; a result above its high reporting limit and one below its low limit; a documentation panel beside a real panel; a rejected request (`RJREA` with a reason); a panel ordered twice with two runs; a panel run with index 101; ordered panels and no results; a specimen whose kind disagrees with the panel, with and without results; a birth date after the specimen date; sex `X`; a numeric value of `1e13`; a text value holding a control byte; a parameter with units and a value that carries its own units; a reviewed run with initials, a reviewed time and an analysis time in the header; a request with no ordered panels; two panel codes that differ only in case and one with a hyphen. At least 36 fixtures in all.

The generator also writes `tests/data/classify-golden.json`: the toolchain's own `classify` over each description in its file `apps/cli/src/export/__fixtures__/commdict-context50.json`, as `[{ "description", "category" }]`. That file is a dictionary of organism names, with no patient data.

`dump.mjs` writes one `ts.ndjson` line per request as `{ key, stages }`. `compare.py` compares each stage apart and prints one block per stage. A stage missing on the Rust side counts as every one of its requests differing.

- [ ] **Step 1: Write `tests/stages.mts`** and use it from the generator.
- [ ] **Step 2: Start a scratch SQL Server** (`cdr-scratch-s3`, port 14333), run the generator, remove the container. Expected: at least 36 fixture files, and the `request` stage of the first 18 unchanged (`git diff --stat` shows additions only inside `expected` and `input`).
- [ ] **Step 3: Change `tests/golden.rs`** to one test per stage: `request_stage`, `observations_stage`, `audit_stage`, `payload_stage`, `fhir_stage`. Only `request_stage` is wired. The other four call a `todo` hook and are marked `#[ignore = "stage not built"]` with the task number that removes the mark.
- [ ] **Step 4: Run** `cargo test`. `request_stage` passes on every fixture, four tests ignored.
- [ ] **Step 5: Commit** `test: every stage's expected value, from the toolchain`.

### Task 4: Code book, ordering and observations

**Files:**
- Create: `src/codebook.rs`, `src/collate.rs`, `src/observations.rs`
- Modify: `src/dict.rs` (expose what the code book needs), `tests/golden.rs`

**Interfaces:**
- Produces, in `codebook.rs` (the map's section 3):
  - `pub struct ParmEntry { pub code, description, abbreviation, units, reference: String, pub context: i64, pub low_limit: Option<f64>, pub high_limit: Option<f64> }`, `PanelEntry { code, description, abbreviation: String, section: Option<String> }`, `CommEntry { context: i64, code, description: String }`, `UserEntry { code, description: String }`
  - `pub enum OrganismCategory { Bacteria, Fungus, Parasite, None }`
  - `pub struct Codebook` with `pub fn from_rows(dictionaries: &Value, limits: Option<(usize, usize)>) -> Result<Codebook, String>` and the lookups `is_antibiotic`, `is_tb_antibiotic`, `is_pathogen_id_param`, `is_questionnaire_param` (`&str -> bool`), `param_entry`, `panel_entry`, `specimen_entry`, `organism_entry`, `user_entry` (`&str -> Option<&..>`), `organism_category(&str) -> OrganismCategory`
  - `pub fn classify(description: &str) -> OrganismCategory`
- Produces, in `collate.rs`: `pub fn js_locale_compare(a: &str, b: &str) -> std::cmp::Ordering`
- Produces, in `observations.rs` (the map's sections 1 and 4, step 1):
  - `pub struct Obs { pub panel_code: String, pub panel_index: f64, pub datestamp: Option<String>, pub order_index: usize, pub param_code: String, pub param_desc: Option<String>, pub value: ObsValue, pub value_str: String, pub raw_value: String, pub type_char: char, pub resulted: bool }` and `pub enum ObsValue { Text(String), Number(f64) }`
  - `pub struct Superseded { pub panel_code: String, pub panel_index: f64, pub superseded_by: f64, pub observation_count: usize }`
  - `pub fn flatten(req: &Request, include_empty: bool) -> Vec<Obs>`
  - `pub fn supersede(obs: Vec<Obs>) -> (Vec<Obs>, Vec<Superseded>)`
  - `pub struct Rejection { pub rejected: bool, pub reason: Option<String> }` and `pub fn rejection(req: &Request) -> Rejection`
  - `pub fn parse_number(s: &str) -> Option<f64>`, JavaScript's `Number(trimmed)`, finite only
  - `pub fn stringify_num(n: f64) -> String`
  - `pub fn observations_json(req: &Request) -> Value`, the `observations` stage

`js_locale_compare` for two ASCII texts: compare first by each character's rank in this order, ignoring case, and only if that is equal, by case, lower before upper, at the first difference:

```
 _-,;:!?.'"()[]{}@*/\&#%`^+<=>|~$0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ
```

The first character of that line is a space. A shorter text that is a prefix of the other sorts first. A character outside printable ASCII ranks after `z`, by code point. This order was printed by Node 24 on this machine on 2026-11-15.

The code book keeps its own parameter map, keyed by the code inside the record, exact and case-sensitive. `Dictionaries::parameter`, keyed by the SQL column, stays as it is for the decoder.

Every expected value in the tests below was produced by the toolchain's own function, or by Node, on 2026-11-15.

- [ ] **Step 1: Write the failing tests.**

```rust
// collate.rs
#[test] fn the_ascii_order_is_nodes() { /* sort the 95 printable characters with js_locale_compare; the result equals the line above */ }
#[test] fn case_breaks_a_tie_only_after_every_letter_agrees() { assert_eq!(js_locale_compare("aB", "Ab"), Less); assert_eq!(js_locale_compare("ab", "AC"), Less); }
#[test] fn punctuation_sorts_before_digits_and_digits_before_letters() { assert_eq!(js_locale_compare("A-1", "A1"), Less); assert_eq!(js_locale_compare("9", "A"), Less); }
#[test] fn a_prefix_sorts_first() { assert_eq!(js_locale_compare("HIV", "HIVVL"), Less); }
// codebook.rs
#[test] fn the_classifier_follows_its_order_of_rules() {
    for (d, want) in [("", Bacteria), ("No growth", None), ("NOGROWTH after 48h", None), ("Normal flora", None), ("Gram negative bacilli", Bacteria), ("HIV negative", None), ("Candida albicans", Fungus), ("yeast cells", Fungus), ("Giardia lamblia", Parasite), ("sterile", None), ("Escherichia coli", Bacteria), ("Nocardia", Bacteria),
        // The toolchain's word stems match whole words only, so these are bacteria. A fault, kept for now.
        ("Plasmodium falciparum", Bacteria)] { assert_eq!(classify(d), want, "{d}"); }
}
#[test] fn the_classifier_agrees_with_the_toolchains_golden_file() { /* tests/data/classify-golden.json, made by Task 3's generator from the toolchain's own classify over its commdict-context50 fixture */ }
#[test] fn a_parameter_is_found_by_the_code_in_its_record_exactly() { /* record code "HIVVQ": param_entry("HIVVQ") some, param_entry("hivvq") none, param_entry("HIVVQ ") none */ }
#[test] fn limits_are_read_at_the_given_offsets_and_zero_means_none() {}
#[test] fn only_contexts_50_and_97_enter_the_code_book() {}
#[test] fn a_user_with_no_description_is_named_by_its_code() {}
#[test] fn a_no_growth_code_is_none_whatever_its_description() { /* code "NBG" with description "Bacteria seen" -> None; classify first, then the code list */ }
// observations.rs
#[test] fn parse_number_reads_what_javascript_reads() { assert_eq!(parse_number("0x10"), Some(16.0)); assert_eq!(parse_number("1e3"), Some(1000.0)); assert_eq!(parse_number(" 5 "), Some(5.0)); assert_eq!(parse_number(""), None); assert_eq!(parse_number("   "), None); assert_eq!(parse_number("Infinity"), None); assert_eq!(parse_number("5 mg"), None); }
#[test] fn stringify_num_strips_trailing_zeros_after_a_dot() { assert_eq!(stringify_num(4.5), "4.5"); assert_eq!(stringify_num(40.0), "40"); assert_eq!(stringify_num(1e21), "1e+21");
    // The toolchain's zero-stripping also eats the zeros of an exponent. A fault, kept for now.
    assert_eq!(stringify_num(1.5e100), "1.5e+1"); assert_eq!(stringify_num(f64::INFINITY), "Infinity"); }
#[test] fn the_latest_run_of_a_panel_wins_and_a_tie_goes_to_the_higher_index() {}
#[test] fn superseded_runs_are_sorted_as_node_sorts_panel_codes() {}
```
Then remove the ignore mark from `observations_stage` in `tests/golden.rs`.

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement** from the map's section 3 and section 4, step 1, and the TypeScript it cites.
- [ ] **Step 4: Run** `cargo test`. `observations_stage` passes on every fixture.
- [ ] **Step 5: Commit** `feat: the code book and the observation set`.

### Task 5: The audit rules

**Files:**
- Create: `src/audit.rs`, `src/audit_vocab.rs`
- Modify: `tests/golden.rs`

**Interfaces:**
- Consumes: `Request`, `Codebook`, `flatten`, `supersede`, `rejection`.
- Produces:
  - `pub enum Severity { Info, Warn, Error }`, ordered
  - `pub struct Anomaly { pub class: &'static str, pub severity: Severity, pub message: String, pub panel_code: Option<String>, pub panel_index: Option<f64>, pub observation_code: Option<String>, pub details: serde_json::Map<String, Value> }`
  - `pub struct AuditReport { pub lab_number: String, pub request_id: String, pub scanned_panels: usize, pub scanned_observations: usize, pub anomalies: Vec<Anomaly>, pub max_severity: Option<Severity> }`
  - `pub fn audit(req: &Request, prefix: &str, cb: &Codebook, doc_panels: &[&str], now_ms: i64) -> AuditReport`
  - `impl AuditReport { pub fn to_json(&self) -> Value; pub fn held(&self) -> bool; pub fn specimen_mismatch_with_results(&self) -> bool }`. `to_json` adds `"source": "disa"` and `"elapsed_ms": 0`. `held` is true when `max_severity` is `Error`.
  - In `audit_vocab.rs`: `pub fn extract_kinds(text: &str) -> Vec<&'static str>` in first-found order, `pub fn kinds_compatible(a: &[&str], b: &[&str]) -> bool`, and the result-format checks named in the map's section 2, stage C.

The 18 rules, their order, their severities and the fields each fills are the table in the map's section 6. Message texts are copied from the TypeScript line the table cites, character for character, including any long dash.

- [ ] **Step 1: Write the failing tests.** One test per rule that builds the smallest request firing that rule and no other, asserting its class, severity and detail keys. Plus:

```rust
#[test] fn rules_run_in_the_toolchains_order() { /* a request firing rules 1, 5, 7, 10, 11 and 18: classes come out in that order */ }
#[test] fn a_mismatch_with_results_is_a_warning_and_without_is_an_error() {}
#[test] fn an_unrealistic_number_is_not_also_reported_for_inline_units() {}
#[test] fn a_birth_date_one_day_after_now_is_not_future_and_two_days_is() { /* now_ms fixed */ }
#[test] fn held_only_when_the_worst_finding_is_an_error() {}
#[test] fn a_request_with_no_findings_has_no_max_severity() {}
```
Remove the ignore mark from `audit_stage`.

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`. `audit_stage` passes on every fixture.
- [ ] **Step 5: Commit** `feat: the 18 audit rules and the hold-back decision`.

### Task 6: Payload, requests and patient

**Files:**
- Create: `src/payload.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Consumes: Tasks 2, 4 and 5.
- Produces:
  - `pub struct PayloadCtx<'a> { pub opts: &'a DecodeOptions, pub cb: &'a Codebook, pub audit: Option<&'a AuditReport>, pub now_iso: &'a str }`
  - `pub struct ObrSet { pub id: u32, pub panel_code: String }` and `pub fn obr_sets(test_orders: &[String]) -> Vec<ObrSet>`
  - `pub struct Linker` with `pub fn new(sets: &[ObrSet], runs: &[(String, f64)]) -> Linker` and `pub fn obr(&self, panel_code: &str, panel_index: f64) -> Option<u32>`
  - `pub struct RegistrationFacts { pub request_type: Option<String>, pub age_years: Option<i64>, pub age_days: Option<i64>, pub newborn: bool }` and `pub fn registration_facts(blob: &[char], site: &SiteProfile) -> RegistrationFacts`
  - `pub struct ObrStatus { pub status: Option<char>, pub authorised_at: Option<Civil>, pub analysis_at: Option<Civil>, pub analyzer_code: Option<String>, pub tester_initials: Option<String>, pub reviewer_initials: Option<String> }` and `pub fn status_by_obr(req: &Request, linker: &Linker, counts: &[(u32, usize)], rejected: &[u32], site: &SiteProfile) -> Vec<(u32, ObrStatus)>` in OBR order
  - `pub fn header_long_datetime(header: &[char], at: usize) -> Option<Civil>` and `header_short_datetime`, years 2000 to 2100 only
  - `pub fn disa_to_iso(s: Option<&str>) -> Option<String>`, `pub fn dob_to_iso(s: Option<&str>) -> Option<String>`
  - `pub fn age_years_between(birth_iso: &str, ref_iso: &str) -> Option<i64>`, `pub fn age_days_between(birth_iso: &str, ref_iso: &str) -> Option<i64>`
  - `pub fn lab_requests(req: &Request, ctx: &PayloadCtx, kept_all: &[Obs]) -> Vec<Value>` and `pub fn patient(req: &Request, ctx: &PayloadCtx, first_request: Option<&Value>) -> Value`

This is steps 3 to 12 of the map's section 4. The trap the map names: the count of results per ordered panel uses the observations before the documentation split.

- [ ] **Step 1: Write the failing tests.**

```rust
#[test] fn ordered_panels_keep_duplicates_and_number_from_one() { /* ["HIVVL", "", "CD4", "HIVVL"] -> ids 1, 2, 3 for HIVVL, CD4, HIVVL */ }
#[test] fn the_second_run_of_a_panel_goes_to_its_second_order() { /* HIVVL ordered twice; runs with index 1 and 2 -> ids 1 and 3 */ }
#[test] fn an_index_above_100_counts_as_that_index_less_100() { /* run index 101 links like index 1 */ }
#[test] fn a_run_with_no_order_left_links_to_nothing() {}
#[test] fn registration_facts_read_single_bytes_and_zero_is_none() { /* byte 333 = 8 -> "E"; byte 414 = 0 -> None; bytes 417, 418 = 44, 1 -> 300; byte 409 = 2 -> newborn */ }
#[test] fn status_is_x_when_rejected_i_when_empty_f_when_reviewed_else_r() {}
#[test] fn a_site_with_no_reviewer_slot_gives_no_status() { /* BLANK profile */ }
#[test] fn a_header_date_outside_2000_to_2100_or_at_midnight_is_none() {}
#[test] fn disa_to_iso_turns_month_day_year_round_and_passes_other_text() { assert_eq!(disa_to_iso(Some("01/23/2019 15:42")), Some("2019-01-23T15:42:00".into())); assert_eq!(disa_to_iso(Some("2019-01-23")), Some("2019-01-23".into())); assert_eq!(disa_to_iso(Some("  ")), None); }
#[test] fn ages_follow_the_calendar_and_a_birth_after_the_reference_is_none() { assert_eq!(age_years_between("2000-03-01", "2020-02-29T10:00:00"), Some(19)); assert_eq!(age_days_between("2020-01-01", "2020-01-02T00:00:00"), Some(1)); assert_eq!(age_days_between("2020-01-02", "2020-01-01T23:00:00"), None); }
#[test] fn received_at_falls_back_to_registered() {}
#[test] fn the_specimen_system_changes_only_for_a_mismatch_with_results() {}
#[test] fn request_attributes_come_in_the_fixed_order_and_only_with_a_value() {}
```

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`.
- [ ] **Step 5: Commit** `feat: the payload's requests and patient`.

### Task 7: Payload, results, isolates and susceptibility tests

**Files:**
- Create: `src/payload_results.rs`
- Modify: `src/payload.rs`, `tests/golden.rs`

**Interfaces:**
- Produces:
  - `pub fn censor(value: f64, low: Option<f64>, high: Option<f64>) -> Option<(f64, &'static str)>`, the tidied limit and `<` or `>`
  - `pub fn isolates(obs: &[Obs], ctx: &PayloadCtx, first_request: Option<&Value>, birth_iso: Option<&str>, linker: &Linker) -> Vec<Value>`
  - `pub fn lab_results(obs: &[Obs], ctx: &PayloadCtx, isolates: &[Value], linker: &Linker) -> Vec<Value>`
  - `pub fn susceptibility_tests(obs: &[Obs], ctx: &PayloadCtx, isolates: &[Value], linker: &Linker) -> Vec<Value>`
  - `pub fn to_payload(req: &Request, ctx: &PayloadCtx) -> Value`, the whole payload, and so the `payload` stage

This is steps 13 to 17 of the map's section 4. `to_payload` runs the 17 steps in the map's order.

- [ ] **Step 1: Write the failing tests.**

```rust
#[test] fn a_value_past_a_limit_becomes_the_limit_with_a_sign() { assert_eq!(censor(5.0, Some(40.0), None), Some((40.0, "<"))); assert_eq!(censor(2e7, None, Some(1e7)), Some((1e7, ">"))); assert_eq!(censor(50.0, Some(40.0), Some(1e7)), None); }
#[test] fn a_limit_is_tidied_to_seven_digits() { /* 6.699999809265137 -> 6.7 */ }
#[test] fn results_sort_by_run_then_panel_code_as_node_sorts_then_slot() {}
#[test] fn the_result_number_restarts_for_each_run() {}
#[test] fn a_coded_value_that_reads_as_a_number_also_gets_a_numeric_value() {}
#[test] fn an_antibiotic_result_joins_the_nearest_isolate_and_a_tie_goes_to_the_lower_run() {}
#[test] fn the_test_method_comes_from_the_units() { /* "" DISK, "mm" DISK, "mg/L" MIC, "ug/mL" MIC, "x" DISK */ }
#[test] fn ages_are_filled_from_the_birth_date_only_when_the_site_has_no_age_bytes() { /* BLANK profile fills; tanzania does not */ }
#[test] fn data_quality_is_absent_with_no_findings_and_carries_now_otherwise() {}
```
Remove the ignore mark from `payload_stage`.

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`. `payload_stage` passes on every fixture.
- [ ] **Step 5: Commit** `feat: the payload's results, isolates and susceptibility tests`.

### Task 8: FHIR

**Files:**
- Create: `src/fhir.rs`
- Modify: `src/text.rs` (the FHIR primitives), `tests/golden.rs`

**Interfaces:**
- Produces:
  - In `text.rs`: `pub fn fhir_id(raw: &str) -> Option<String>`, `pub fn is_tz_offset(s: &str) -> bool`, `pub fn fhir_datetime(raw: Option<&str>, tz: &str) -> Option<String>`, `pub fn fhir_text(raw: Option<&str>) -> Option<String>`. Copy them from `openldr_ce/wasm/openldr-v1-import/src/text.rs` (`fhir_id` :126, `is_tz_offset` :151, `fhir_datetime` :191, `text` :32) with their tests.
  - `pub fn to_fhir(payload: &Value, tz: &str) -> Result<Vec<Value>, &'static str>`
  - `pub fn documentation(req: &Request, payload: &Value, ctx: &PayloadCtx) -> Result<Vec<Value>, &'static str>`
  - `pub fn resources(req: &Request, payload: &Value, ctx: &PayloadCtx) -> Result<Vec<Value>, &'static str>`, the first followed by the second, and so the `fhir` stage

Start from `openldr_ce/wasm/openldr-v1-import/src/mapping.rs`, which ports the same TypeScript for another source. The map's section 5 has the table of which function there does which job, and three real differences: the isolate's second coding, the Organization's address, and the Patient's given names. The input here is a payload, not source rows.

Error codes, one per case the toolchain throws on: `NO_LAB_REQUESTS`, `EMPTY_REQUEST_ID`, `DUPLICATE_ISOLATE`, `BAD_TZ_OFFSET`.

- [ ] **Step 1: Write the failing tests.**

```rust
#[test] fn resources_come_in_the_toolchains_order() { /* Patient, Specimen, Organizations, then ServiceRequest and DiagnosticReport per order, Observations, isolates, ASTs, then Questionnaires and their responses */ }
#[test] fn every_id_derives_from_the_request_id() {}
#[test] fn a_report_lists_its_own_results_then_its_isolates_and_omits_an_empty_list() {}
#[test] fn an_isolate_lists_its_susceptibility_tests() {}
#[test] fn a_payload_with_no_requests_is_an_error() { assert_eq!(to_fhir(&json!({"lab_requests": []}), "+03:00").unwrap_err(), "NO_LAB_REQUESTS"); }
#[test] fn a_request_id_that_cleans_to_nothing_is_an_error() {}
#[test] fn a_bad_offset_is_an_error_even_with_no_dates() {}
#[test] fn the_four_maps_are_exact() { /* gender, report status, request status, priority: every input in the map's section 5 and one unknown */ }
#[test] fn a_local_time_gets_the_sites_offset_and_a_date_alone_does_not() {}
#[test] fn documentation_results_become_one_form_and_one_response_per_form() {}
```
Remove the ignore mark from `fhir_stage`.

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`. `fhir_stage` passes on every fixture, including the ones whose expected value is `{ "error": true }`.
- [ ] **Step 5: Commit** `feat: FHIR resources from a payload`.

### Task 9: The decode entrypoint

**Files:**
- Create: `src/decode.rs`
- Modify: `src/lib.rs`, `scripts/build.mjs`, `README.md`, `examples/decode_file.rs`

**Interfaces:**
- Produces:
  - `pub fn source_decode(input: &Value) -> Result<Value, String>` taking `{ options, now, dictionaries, keys, rows }` and giving `{ "groups": [{ "key", "held", "findings", "resources"?, "error"? }] }`, one group per key, in the order of `keys`
  - The wasm export `source_decode`, and `"source_decode"` added to `payload.entrypoints` in the manifest. `importSource.entrypoints` does not change.
  - `examples/decode_file.rs` writes every stage per request: `{ key, stages: { request, observations, audit, payload, fhir } }`

Rules:

- `now` is text such as `2026-01-01T00:00:00.000Z`. It is required. A missing or unreadable `now` is `Err("now must be a time like 2026-01-01T00:00:00.000Z")`.
- A bad option or a bad dictionary set fails the whole call with its message.
- For each key: decode the request; a failure gives `{ key, held: false, findings: [], error: "<code>" }`. Then audit. `findings` is the report's anomalies as JSON. `held` is `report.held()`.
- When held, the group has no `resources`. The payload and FHIR are not built.
- When not held, `resources` is the FHIR list. A FHIR error gives the group an `error` and no `resources`.
- No finding, error or message holds a row value that the toolchain's own anomaly would not hold.

- [ ] **Step 1: Write the failing tests.**

```rust
#[test] fn one_group_per_key_in_the_order_given() {}
#[test] fn a_held_request_has_findings_and_no_resources() {}
#[test] fn a_clean_request_has_resources_and_held_false() {}
#[test] fn one_bad_request_does_not_fail_its_page() { /* three keys, the middle one has no registration row: its group has error NO_REGISTRATION, the others have resources */ }
#[test] fn a_request_with_no_ordered_panels_is_an_error_not_a_panic() {}
#[test] fn a_missing_now_fails_the_call() {}
#[test] fn an_unknown_site_fails_the_call() {}
#[test] fn the_page_equals_the_stages_run_one_by_one() { /* every fixture merged onto one page: each group's resources equal that fixture's expected fhir */ }
```

- [ ] **Step 2: Run** and see them fail. **Step 3: Implement.** **Step 4: Run** `cargo test`, `cargo clippy --all-targets`, the wasm build and `node scripts/build.mjs`.
- [ ] **Step 5: Add to `README.md`:** the decode options, what `source_decode` takes and gives, and that nothing in OpenLDR CE calls it yet.
- [ ] **Step 6: Commit** `feat: decode a page of requests to FHIR and findings`.

### Task 10: The real-data check, all stages

**Files:**
- Create: `tools/real-data-check/from-copy.mjs`
- Modify: `tools/real-data-check/README.md`, `docs/real-data-check.md`

**Interfaces:**
- Produces: `from-copy.mjs <export file> <dir>`, which turns an export of a CE copy's stored rows (one JSON object per line with `set_name`, `detail_name`, `key`, `seq`, `row`) into `raw.ndjson` and `dict.json`. It connects to nothing.

- [ ] **Step 1: Write `from-copy.mjs`** with a `node --test` file over a made-up export: rows grouped by key, ordered by `seq`, dictionary sets by name, a key with no registration row kept.
- [ ] **Step 2: Try the whole check on made-up data** against a scratch server (`cdr-scratch-s10`, port 14334): generator, `dump.mjs`, `decode_file`, `compare.py`. Expected: every stage identical for every fixture request. Remove the container.
- [ ] **Step 3: Commit** `feat: the real-data check covers every stage and reads a copy's rows`.

The steps below are run by the controller on the restored database, through a login that can only read, made for the run and dropped after.

- [ ] **Step 4: Run the check on at least 20,000 requests.** Expected: zero differing fields at every stage, known cases apart. A difference goes back to the task that owns the stage, with the field name, the count and the value types, and a new made-up fixture that shows it.
- [ ] **Step 5: Run it on rows CE itself copied.** Start a scratch CE on port 3995, copy the dictionaries and at least 2,000 requests with the plugin, export the stored rows, run `from-copy.mjs`, then run the toolchain on the same lab numbers and compare. Expected: zero differing fields. This closes the open point in the design's section 6.10.
- [ ] **Step 6: Measure the decode.** Time `source_decode` natively over pages of 500 requests. Record requests a second and the largest page's time. The wasm build is not timed here, because nothing in CE can call it yet.
- [ ] **Step 7: Record** every run in `docs/real-data-check.md`, delete the data, drop the login, remove the scratch server and its databases. Commit `docs: every stage matches the toolchain on real requests`.

---

## What this plan does not do

- Fix any toolchain fault. The design's section 6.8 lists them. They are the next plan.
- Anything in OpenLDR CE. The check run, the save and the held-back view are part 4. Nothing calls `source_decode` until then.
- Time the wasm build of the decode.
- Sites other than Tanzania.
- The compare with v1. That is part 3.
