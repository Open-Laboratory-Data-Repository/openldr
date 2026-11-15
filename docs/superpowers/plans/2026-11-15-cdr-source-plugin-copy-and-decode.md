# cdr-source plugin: copy and first decode stage. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new plugin repository, `cdr-source`, that lets CE copy a DISA database today, and that decodes the copied rows of one request to the same values as the toolchain.

**Architecture:** One Rust crate built as a wasm plugin and as a native library. It supplies SELECT statements to CE's copy and decodes copied rows with plain functions. Nothing in it opens a connection. The toolchain is the reference: made-up fixtures in the repository and a check on real requests both compare the Rust with the TypeScript.

**Tech Stack:** Rust (edition 2021, `serde_json`, `extism-pdk` on wasm only), target `wasm32-wasip1`. Preact and esbuild for the page. Node 24 and `tsx` for the fixture and check scripts.

**Spec:** `docs/superpowers/specs/2026-11-15-cdr-source-plugin-design.md`. This plan covers steps 1 and 2 of its section 6.9. Steps 3 to 7 (payload, FHIR, audit rules, `source_decode`, the faults) get their own plan once this one is merged, because each stage is checked against the stage before it.

**Where the work happens:** `/home/fredrick/Projects/Repositories/cdr-source`, a new git repository. No file in `openldr_ce` changes. No file in `cdr-toolchain` changes.

## Global Constraints

- The name DISA, a DISA table name, or any of this code never enters `openldr_ce`.
- `cdr-toolchain` is frozen. Read it. Never change it.
- No real patient row in the repository. Fixtures are made up. A tool that reads real rows prints counts and field names, never a value.
- Every SQL statement is one SELECT that runs on SQL Server 2008 R2. No `OFFSET`, `TRY_CONVERT`, `STRING_AGG`, `TRIM`, `CONCAT` or `IIF`.
- CE refuses these bare words in a statement: `set`, `use`, `open`, `close`, `save`, `add`, `return`, `begin`, `if`, `copy`, `call`, `merge`, `create`, `update`, `delete`, `into`, `exec`, `declare`. Every table and column name goes in `[brackets]`.
- A paging key is printable ASCII, 1 to 200 characters. A set name and a detail name match `^[A-Za-z0-9_]{1,40}$`. A statement is at most 20,000 characters.
- The crate never panics on any input. Bad input gives an `Err` with a short code and no row value.
- Dates are plain calendar fields with no zone. The toolchain is always run with `TZ=UTC`.
- Only the controller may query the container `openldr-mssql`. An implementer never connects to it, never opens a file under a `temp/` folder, and never opens a `.env` file.
- A scratch SQL Server container gets `--memory 3g` and `-e MSSQL_MEMORY_LIMIT_MB=2048`, uses the image already on the machine (`mcr.microsoft.com/mssql/server:2025-latest`), and is removed afterwards. One heavy run at a time: no test suite beside a container start.
- Scratch CE servers use ports 3990 to 3995 or 3997, `OPENLDR_SKIP_ENV_FILE=true`, and databases named `sa_scratch_*`. Never send a request to port 3000. Never touch the databases `openldr`, `openldr_target`, `openldr_docs`, `openldr_docs_target` or `keycloak`, or the container `openldr-docs-system-mssql`.
- No `Co-Authored-By` line in any commit.
- Prose follows the `unslop` skill: short sentences, no em dashes, no emoji in headings.

## Review Focus

1. **Bytes that JavaScript calls whitespace, inside binary fields.** Day 9 to 13, minute 32, and byte 0xA0 are all whitespace to `trim()`. A date or a result slot holding them must decode as the toolchain does. Tests in Task 5 and Task 6.
2. **Dictionary codes that differ in case or trailing spaces.** `'abc  '` must find `'ABC'`. Test in Task 5.
3. **A request with rows missing.** No test rows, no text rows, no birth row, or no registration row at all. The first three decode. The last gives `Err("NO_REGISTRATION")`. Test in Task 7.
4. **A record shorter than its layout.** A registration record of 10 bytes, a test record of 80 bytes or fewer. No panic, and fields past the end are empty. Tests in Task 6.
5. **Dates that are not dates.** Month 0 or 13, day 0 or 45, a year below 100. The result follows JavaScript's `new Date(y, m, d)` arithmetic. Test in Task 5.

---

## File structure

```
cdr-source/
  Cargo.toml              one package, [profile.release] as openldr_ce/wasm/Cargo.toml
  rust-toolchain.toml     targets = ["wasm32-wasip1"]
  .gitignore              target/, dist/, node_modules/, tools/real-data-check/data/
  README.md               install, options, what the copy reads
  src/lib.rs              entrypoints and the wasm glue
  src/options.rs          option parsing
  src/queries.rs          copy sets
  src/text.rs             bytes to text, JavaScript trim and substring, base64
  src/dates.rs            DISA dates and JavaScript date arithmetic
  src/sqlcmp.rs           SQL Server string equality
  src/records.rs          one parser per record kind
  src/dict.rs             the dictionaries, built from copied rows
  src/request.rs          one decoded request
  tests/golden.rs         fixtures compared by value
  tests/fixtures/*.json   made-up input and expected output
  tests/generate-fixtures.mts
  examples/decode_file.rs native runner for the real-data check
  tools/real-data-check/  dump.mjs, compare.py, README.md
  ui/                     the page: package.json, tsconfig.json, vitest.config.ts, src/
  scripts/build.mjs       wasm, ui.html and manifest.json into dist/
```

Reference code to copy from, read-only:

- `openldr_ce/wasm/openldr-v1-import/` for the crate shape, `src/lib.rs` glue, `tests/golden.rs`.
- `openldr_ce/scripts/build-v1-import-plugin.mjs` for the build script.
- `openldr_ce/wasm/openldr-v1-import/ui/` for the page.
- `openldr_ce/.superpowers/trial-2026-11-15/` for the trial: `rs/src/main.rs`, `dump.mjs`, `compare.py`. The trial matched the toolchain on 2,001 real requests. It is the starting point for Tasks 5 to 8, not a file to copy whole.

---

### Task 1: Repository, crate and options

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `.gitignore`, `README.md`, `src/lib.rs`, `src/options.rs`

**Interfaces:**
- Produces:
  - `pub struct CopyOptions { pub data_db: String, pub global_db: String, pub dict_db: String }`
  - `pub fn parse_copy_options(v: &serde_json::Value) -> Result<CopyOptions, String>`
  - `pub fn table(db: &str, name: &str) -> String` giving `[db].[dbo].[name]`

- [ ] **Step 1: `git init` the repository** with `main` as its branch, and write `Cargo.toml` (package `cdr-source`, version `0.1.0`, license `Apache-2.0`, `crate-type = ["cdylib", "rlib"]`, `serde_json = "1"`, `extism-pdk = "1"` under `cfg(target_arch = "wasm32")`, release profile `opt-level = "z"`, `lto = true`, `strip = true`).

- [ ] **Step 2: Write the failing tests** in `src/options.rs`:

```rust
#[test] fn defaults_when_no_options() {
    let o = parse_copy_options(&json!(null)).unwrap();
    assert_eq!((o.data_db.as_str(), o.global_db.as_str(), o.dict_db.as_str()), ("DisalabData", "DisaGlobal", "DisalabDict"));
}
#[test] fn names_can_be_set() {
    let o = parse_copy_options(&json!({"dataDb": "D1", "globalDb": "G_2", "dictDb": "X"})).unwrap();
    assert_eq!(o.global_db, "G_2");
}
#[test] fn a_name_that_could_leave_its_brackets_is_refused() {
    for bad in ["a]b", "a b", "", "a;b", "a'b", &"x".repeat(65)] {
        assert_eq!(parse_copy_options(&json!({"dataDb": bad})).unwrap_err(), "dataDb must be 1 to 64 letters, digits or underscores");
    }
}
#[test] fn a_value_that_is_not_text_is_refused() {
    assert_eq!(parse_copy_options(&json!({"dictDb": 5})).unwrap_err(), "dictDb must be 1 to 64 letters, digits or underscores");
}
#[test] fn table_is_bracketed() { assert_eq!(table("DisaGlobal", "PARMDICT"), "[DisaGlobal].[dbo].[PARMDICT]"); }
```

- [ ] **Step 3: Run** `cargo test options` and see it fail to compile.
- [ ] **Step 4: Implement** `parse_copy_options` and `table`. Unknown option names are ignored, as the v1 plugin does.
- [ ] **Step 5: Run** `cargo test` and see 5 pass. Run `cargo build --release --target wasm32-wasip1` and see it finish.
- [ ] **Step 6: Commit** `feat: crate, options and database names`.

### Task 2: What the copy reads

**Files:**
- Create: `src/queries.rs`
- Modify: `src/lib.rs`

**Interfaces:**
- Consumes: `CopyOptions`, `table` from Task 1.
- Produces:
  - `pub fn copy(o: &CopyOptions) -> Value` giving `{ "sets": [...] }`
  - `pub fn import_copy(input: &Value) -> Result<Value, String>` in `lib.rs`, with the wasm glue from the v1 plugin's `lib.rs:55-90`.

The seven sets, in this order. `D`, `G` and `X` stand for the three database names.

| Set | Key query | Detail queries |
|---|---|---|
| `requests` | `SELECT TOP ({{limit}}) [LabNo] FROM [D].[dbo].[REGDAT4] WHERE [LabNo] > {{after}} ORDER BY [LabNo]` | six, below |
| `parameters` | `SELECT TOP ({{limit}}) [CODE] AS [__key], * FROM [G].[dbo].[PARMDICT] WHERE [CODE] > {{after}} ORDER BY [CODE]` | none |
| `panels` | the same on `[G].[dbo].[TESTDICT]` | none |
| `locations` | the same on `[G].[dbo].[LOCNDIC4]` | none |
| `users` | the same on `[X].[dbo].[USERDIC6]` | none |
| `comments` | `SELECT TOP ({{limit}}) K AS [__key], * FROM [G].[dbo].[COMMDICT] WHERE K > {{after}} ORDER BY K`, where `K` is `RIGHT('0000000000' + CAST([CONTEXT] AS varchar(10)), 10) + '\|' + [CODE]` written out in full each time | none |
| `wards` | the same shape on `[G].[dbo].[WARDDICT]`, where `K` is `[CODE1] + '\|' + [CODE2]` | none |

The six detail queries of `requests`:

| Name | Statement |
|---|---|
| `registration` | `SELECT [LabNo] AS [__key], * FROM [D].[dbo].[REGDAT4] WHERE [LabNo] IN ({{keys}}) ORDER BY [LabNo]` |
| `tests` | `SELECT [LABNO] AS [__key], * FROM [D].[dbo].[TESTDATA] WHERE [LABNO] IN ({{keys}}) ORDER BY [LABNO], [TESTCODE], [TESTINDEX]` |
| `texts` | `SELECT [LABNO] AS [__key], * FROM [D].[dbo].[TXT1DATA] WHERE [LABNO] IN ({{keys}}) ORDER BY [LABNO], [TESTCODE], [TESTINDEX], [FRAMEREF]` |
| `audit` | `SELECT [LABNO] AS [__key], * FROM [D].[dbo].[AUDTDATA] WHERE [LABNO] IN ({{keys}}) ORDER BY [LABNO], [AUDDateTime], [OCCURS], [WS]` |
| `births` | `SELECT [LABNO] AS [__key], * FROM [D].[dbo].[RDOBIDX4] WHERE [LABNO] IN ({{keys}}) ORDER BY [LABNO], [DOBDATE]` |
| `taken` | `SELECT RTRIM([INVOICENO]) AS [__key], * FROM [D].[dbo].[RTKNIDX5] WHERE [INVOICENO] IN ({{keys}}) ORDER BY [INVOICENO], [TAKENDATE]` |

Each `ORDER BY` follows the table's own index, which is the order the toolchain reads rows in.

All thirteen statements were run on the restored Tanzania data on 2026-11-15, counting rows only. Each dictionary statement returned its whole table.

There is no `import_checks`. The design lists it, but the copy never calls it and the Copy tab has no step that would. It can be added when a screen needs it.

- [ ] **Step 1: Write the failing tests** in `src/queries.rs`:

```rust
#[test] fn seven_sets_in_order() {
    let names: Vec<_> = sets().iter().map(|s| s["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["requests", "parameters", "panels", "locations", "users", "comments", "wards"]);
}
#[test] fn requests_has_six_details_in_order() { /* registration, tests, texts, audit, births, taken */ }
#[test] fn every_key_query_has_after_and_limit_once_and_orders_by_its_key() { /* count "{{after}}" == 1, "{{limit}}" == 1, contains "ORDER BY" */ }
#[test] fn every_detail_has_keys_once_and_starts_with_the_key_column() { /* count "{{keys}}" == 1, starts_with "SELECT " and contains " AS [__key], * FROM " */ }
#[test] fn the_requests_key_query_is_exact() {
    assert_eq!(set("requests")["keyQuery"]["sql"], "SELECT TOP ({{limit}}) [LabNo] FROM [DisalabData].[dbo].[REGDAT4] WHERE [LabNo] > {{after}} ORDER BY [LabNo]");
}
#[test] fn the_taken_detail_is_exact() { /* the statement in the table above, with DisalabData */ }
#[test] fn the_comments_key_query_is_exact() { /* the full statement, with DisaGlobal */ }
#[test] fn database_names_reach_every_statement() { /* options D1, G1, X1: no statement contains "Disa" */ }
#[test] fn no_statement_holds_a_word_ce_refuses() {
    // After removing every [bracketed name] and every '...' literal, split on non-word characters.
    // None of: set use open close save add return begin if copy call merge create update delete into exec declare
}
#[test] fn names_and_lengths_fit_ce() { /* names match ^[A-Za-z0-9_]{1,40}$, each sql is under 20,000 characters, at most 12 details */ }
#[test] fn import_copy_refuses_a_bad_database_name() { /* Err from Task 1's sentence */ }
```

- [ ] **Step 2: Run** `cargo test queries` and see it fail.
- [ ] **Step 3: Implement** `copy`, `import_copy` and the glue.
- [ ] **Step 4: Run** `cargo test` and see all pass. Build the wasm target.
- [ ] **Step 5: Commit** `feat: copy sets`.

### Task 3: The page

**Files:**
- Create: `ui/package.json`, `ui/tsconfig.json`, `ui/vitest.config.ts`, `ui/src/{main.tsx,App.tsx,CopyPanel.tsx,steps.tsx,api.ts,sdk.ts,options.ts,i18n.ts,styles.css}`, and the tests `ui/src/{CopyPanel.test.tsx,options.test.ts,i18n.test.ts}`

**Interfaces:**
- Consumes: the host operations `import.allowed`, `import.diagnose`, `import.copy.start`, `.list`, `.status`, `.stop`, `.delete`, through `window.openldr.imports`.
- Produces: `ui/src/main.tsx`, the entry the build script bundles.

The page is the v1 plugin's Copy tab alone. Copy these files from `openldr_ce/wasm/openldr-v1-import/ui/src` and cut them down: `CopyPanel.tsx`, `steps.tsx` (keep `SourceStep` and `OptionsStep`), `api.ts` (keep `allowed`, `diagnose`, `copyApi` and the copy helpers), `sdk.ts`, `main.tsx`, `styles.css`, `i18n.ts`. Do not copy `RunPanel.tsx`, `runSteps.tsx`, the import wizard or the tab bar.

- `@openldr/plugin-ui-sdk` is a dev dependency by path: `"file:../../openldr_ce/packages/plugin-ui-sdk"`. It gives types and the test mock, and is not in the bundle.
- `options.ts` holds three fields, `dataDb`, `globalDb`, `dictDb`, each empty by default. An empty field is left out of the options, so the plugin's default applies. `problems()` reports a field that does not match `^[A-Za-z0-9_]{1,64}$`.
- `App.tsx` renders the title and `CopyPanel`. No tabs.
- `i18n.ts` keeps only the keys the page uses, in en, fr and pt, and adds `options.dataDb`, `options.globalDb`, `options.dictDb` and their help lines. The title is "CDR source" in all three.
- Actions stay in the dots menu, and delete stays a type-to-confirm dialog, as in the v1 page.

- [ ] **Step 1: Write the failing tests.** Port `CopyPanel.test.tsx` and `i18n.test.ts` from the v1 page, changing the options the tests type and expect. Add to `options.test.ts`:

```ts
it('leaves an empty field out', () => expect(toOptions({ dataDb: '', globalDb: 'G1', dictDb: '' })).toEqual({ globalDb: 'G1' }));
it('reports a name with a space', () => expect(problems({ dataDb: 'a b', globalDb: '', dictDb: '' })).toEqual({ dataDb: 'problem.dbName' }));
```
and to `i18n.test.ts`: `it('has no key the page never uses', ...)` comparing the bundle's keys with the `t('...')` calls found in `src/*.tsx` and `src/*.ts`.

- [ ] **Step 2: Run** `pnpm install` then `pnpm test` in `ui/` and see failures.
- [ ] **Step 3: Implement** the page.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck` in `ui/` and see both pass.
- [ ] **Step 5: Commit** `feat: the plugin page, copy controls only`.

### Task 4: Build, install, and a real copy

**Files:**
- Create: `scripts/build.mjs`, `package.json` (root, with `esbuild ^0.24.0` and a `build` script)
- Modify: `README.md`

**Interfaces:**
- Produces: `dist/plugin.wasm`, `dist/ui.html`, `dist/manifest.json`.

The manifest, with the two hashes filled in by the script:

```json
{ "schemaVersion": 1, "type": "plugin", "id": "cdr-source", "version": "0.1.0",
  "description": "Copies a laboratory source database into OpenLDR.",
  "license": "Apache-2.0", "compatibility": { "ceVersion": "*" },
  "capabilities": [{ "kind": "host:import" }],
  "payload": { "kind": "plugin", "pluginKind": "sink", "wasmSha256": "<hash>",
    "entrypoints": ["import_copy"], "wasi": true,
    "limits": { "memoryMb": 512, "timeoutMs": 30000 },
    "importSource": { "connectorTypes": ["microsoft-sql"], "entrypoints": { "copy": "import_copy" } },
    "ui": { "entry": "ui.html", "sha256": "<hash>", "nav": { "label": "CDR source", "icon": "database", "section": "apps" }, "uiSdkVersion": "1", "requiredRoles": ["lab_admin"] } } }
```

- [ ] **Step 1: Write `scripts/build.mjs`** after `openldr_ce/scripts/build-v1-import-plugin.mjs`: cargo build for `wasm32-wasip1`, copy `target/wasm32-wasip1/release/cdr_source.wasm`, bundle `ui/src/main.tsx` with the same esbuild options, refuse `</style>` and `</script>`, hash both, write the manifest.
- [ ] **Step 2: Run** `node scripts/build.mjs`. Expected: a line naming `dist/` with two 12-character hashes, and three files in `dist/`.
- [ ] **Step 3: Check the manifest against CE's own parser.** From `openldr_ce`, run a short `tsx` script that reads `../cdr-source/dist/manifest.json` and passes it to `parseArtifactManifest` from `packages/marketplace/src/artifact-manifest.ts`. Read that function's signature first. Expected: it returns without throwing. This changes no file in `openldr_ce`.
- [ ] **Step 4: Commit** `feat: build script and manifest`.

The steps below are run by the controller, not by an implementer. They read the restored Tanzania database in `openldr-mssql` with SELECT only.

- [ ] **Step 5: Start a scratch CE** from a throwaway worktree of `openldr_ce` at `main`, on port 3995, under `env -i`, with `OPENLDR_SKIP_ENV_FILE=true`, `AUTH_ADAPTER=local`, `AUTH_DEV_BYPASS=true`, `BLOB_ADAPTER=fs`, `BLOB_DIR`, `SECRETS_ENCRYPTION_KEY`, `INTERNAL_DATABASE_URL` and `TARGET_DATABASE_URL` on `sa_scratch_cdr_internal` and `sa_scratch_cdr_target`, `MIGRATE_ON_START=true`, and `CLI_ENTRY`. Prove where the CLI lands: `openldr --server-url http://127.0.0.1:3995 plugin list` prints `(no plugins)` and the scratch server's log shows the call.
- [ ] **Step 6: Install and connect.** `plugin install <cdr-source>/dist/plugin.wasm` prints `installed cdr-source@0.1.0`. `connectors add --file <json>` for the SQL Server, `connectors test <id>` prints `Connection OK`, then `import allow cdr-source <id>`.
- [ ] **Step 7: Copy.** `import copy start --plugin cdr-source --connector <id>`. Let the six dictionary sets finish and the `requests` set run for at least 20 pages, then `import copy stop`.
- [ ] **Step 8: Check what arrived**, with counts only:
  - The dictionary sets hold 1,547, 447, 8,754, 69, 5,619 and 208 rows, the table counts measured on 2026-11-15.
  - For the request keys copied, the row counts of the six details equal a `COUNT(*)` of the same keys at the source.
  - Record rows, bytes and seconds per page of 500, and work out the disk and time a full copy of 2,326,075 requests would take.
- [ ] **Step 9: Look at the page** at 1280 wide and at 375 by 812 on the scratch server, in en, fr and pt. Keep one picture of each width.
- [ ] **Step 10: Clean up.** `import copy delete cdr-source <copy> --force`, stop the server, drop the two scratch databases, remove the worktree and the temp folders.
- [ ] **Step 11: Write the numbers** from step 8 into `README.md` under "What a copy costs", and commit `docs: a real copy, measured`.

### Task 5: Text, dates and SQL Server equality

**Files:**
- Create: `src/text.rs`, `src/dates.rs`, `src/sqlcmp.rs`

**Interfaces:**
- Produces, in `text.rs`:
  - `pub type Chars = Vec<char>`
  - `pub fn base64_decode(s: &str) -> Vec<u8>`
  - `pub fn latin1(bytes: &[u8]) -> Chars`, one character per byte
  - `pub fn fix_bytes(s: &[char]) -> Chars`, NUL to space
  - `pub fn substring(s: &[char], start: usize, end: usize) -> &[char]`, JavaScript rules
  - `pub fn js_trim(s: &str) -> &str`
  - `pub fn fix_text(data: &[char], start: usize, end: usize) -> String`, controls and DEL to space, then trim
  - `pub fn is_empty(s: &str) -> bool`, true when `js_trim` leaves nothing
- Produces, in `dates.rs`:
  - `pub struct Civil { pub year: i64, pub month0: i64, pub day: i64, pub hour: i64, pub minute: i64, pub second: i64 }`
  - `pub fn js_date(year: i64, month0: i64, day: i64, hour: i64, minute: i64, second: i64) -> Civil`, as `new Date(...)`, with years 0 to 99 read as 1900 to 1999
  - `pub fn js_set(year: i64, month0: i64, day: i64, hour: i64, minute: i64, second: i64) -> Civil`, the same arithmetic with no 1900 rule
  - `pub fn long_date(s: &[char]) -> Option<Civil>`, `pub fn long_time(s: &[char]) -> Option<(i64, i64)>`, `pub fn long_datetime(s: &[char]) -> Option<Civil>`
  - `pub fn short_datetime(s: &[char]) -> Option<Civil>`
  - `pub fn mmddyyyy_hhmm(c: &Civil) -> String`, `pub fn mmddyyyy(c: &Civil) -> String`, `pub fn ddmmyyyy(c: &Civil) -> String`
- Produces, in `sqlcmp.rs`: `pub fn sql_key(s: &str) -> String`, trailing spaces dropped and upper case, so that two texts SQL Server calls equal give one key.

The toolchain source for each is `cdr-toolchain/packages/disalab/src/lib/core.ts`. The trial's versions are in `main.rs`.

- [ ] **Step 1: Write the failing tests.** Each expected value below was produced by the toolchain's own function.

```rust
// text.rs
#[test] fn trim_strips_what_javascript_strips() { assert_eq!(js_trim("\u{a0}\t a\u{85} \u{feff}"), "a\u{85}"); }
#[test] fn substring_clamps_and_swaps() { let s: Chars = "abcdef".chars().collect(); assert_eq!(substring(&s, 4, 2), &['c', 'd']); assert_eq!(substring(&s, 4, 99), &['e', 'f']); assert_eq!(substring(&s, 9, 12), &[] as &[char]); }
#[test] fn fix_text_turns_controls_into_spaces_then_trims() { let s = latin1(b"\x01AB\x00C\x7f "); assert_eq!(fix_text(&s, 0, 7), "AB C"); }
#[test] fn latin1_keeps_every_byte() { let s = latin1(&[0x90, 0xff, 0x00]); assert_eq!(s, vec!['\u{90}', '\u{ff}', '\0']); }
#[test] fn base64_round_trip() { assert_eq!(base64_decode("AAEC/w=="), vec![0, 1, 2, 255]); }
// dates.rs
#[test] fn long_date_reads_day_month_year() { let c = long_date(&latin1(&[13, 9, 0xE2, 0x07])).unwrap(); assert_eq!((c.year, c.month0, c.day), (2018, 8, 13)); }
#[test] fn a_day_that_is_a_whitespace_byte_is_still_a_day() { assert!(long_date(&latin1(&[10, 12, 0xE2, 0x07])).is_some()); }
#[test] fn an_empty_slot_is_none() { assert!(long_date(&latin1(&[0, 0x20, 0, 0])).is_none()); assert!(long_datetime(&latin1(&[0; 6])).is_none()); }
#[test] fn midnight_reads_as_no_time() { assert!(long_datetime(&latin1(&[1, 2, 0xE2, 0x07, 0, 0])).is_none()); }
#[test] fn month_thirteen_rolls_into_next_year() { let c = long_date(&latin1(&[1, 13, 0xE2, 0x07])).unwrap(); assert_eq!((c.year, c.month0, c.day), (2019, 0, 1)); }
#[test] fn day_zero_is_the_last_day_of_the_month_before() { let c = long_date(&latin1(&[0, 3, 0xE4, 0x07])).unwrap(); assert_eq!((c.year, c.month0, c.day), (2020, 1, 29)); }
#[test] fn a_two_digit_year_is_in_the_1900s() { let c = long_date(&latin1(&[5, 6, 50, 0])).unwrap(); assert_eq!(c.year, 1950); }
#[test] fn long_time_wraps_hours_and_minutes() { assert_eq!(long_time(&latin1(&[61, 25])), Some((1, 1))); }
#[test] fn short_datetime_unpacks_dos_fields() { // 2019-01-23 15:42:52: date 0x4E37, time 0x7D5A
    let c = short_datetime(&latin1(&[0x5A, 0x7D, 0x37, 0x4E])).unwrap(); assert_eq!(mmddyyyy_hhmm(&c), "01/23/2019 15:42"); }
#[test] fn formats_pad_to_two() { let c = js_date(2019, 0, 3, 4, 5, 0); assert_eq!(mmddyyyy_hhmm(&c), "01/03/2019 04:05"); assert_eq!(ddmmyyyy(&c), "03/01/2019"); }
#[test] fn js_set_does_not_apply_the_1900_rule() { assert_eq!(js_set(50, 0, 1, 0, 0, 0).year, 50); }
// sqlcmp.rs
#[test] fn equal_in_sql_server_means_equal_keys() { assert_eq!(sql_key("abc  "), sql_key("ABC")); assert_ne!(sql_key(" abc"), sql_key("abc")); assert_ne!(sql_key("abc"), sql_key("abd")); }
```

- [ ] **Step 2: Run** `cargo test` and see them fail.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `cargo test` and see them pass.
- [ ] **Step 5: Commit** `feat: text, dates and SQL Server equality`.

### Task 6: Records and dictionaries

**Files:**
- Create: `src/records.rs`, `src/dict.rs`

**Interfaces:**
- Consumes: Task 5.
- Produces, in `records.rs`. Every parser takes the record's bytes and never fails:
  - `pub struct Registration`, one public field per value `REGDAT4.Populate` and `REGDAT4.Init` read from the bytes (`REGDAT4.ts:93-156`):
    - `String`: `unique_id`, `reference_number`, `received_by`, `modified_by`, `inner_lab_number`, `nid`, `location`, `ward`, `folder_number`, `name`, `surname`, `first_name`, `sex`, `specimen`, `condition`, `priority`, `therapy`, `notes`, `diagnosis`, `doctor_code`, `doctor`, `receipt`, `paid_by`, `dob_age`
    - `Option<String>`: `registered`, `received_in_lab`, `collected`, `taken`
    - `ordered_panels: Vec<String>` and `raw: Chars`
  - `pub fn registration(bytes: &[u8]) -> Registration`
  - `pub struct TextRow { pub test_code: String, pub test_index: f64, pub frame: f64, pub value: String }` and `pub fn text_value(bytes: &[u8]) -> String` (`TXT1DATA.ts:34-40`)
  - `pub struct AuditRow { pub code: String, pub user: String, pub data: String }` and `pub fn audit(bytes: &[u8]) -> AuditRow` (`AUDTDATA.ts:34-38`)
  - `pub struct Slot { pub code: String, pub type_byte: u32, pub entered: bool, pub raw: String, pub frame: f64 }`
  - `pub fn test_header(bytes: &[u8]) -> Chars`, the first 80 characters, and `pub fn slots(bytes: &[u8]) -> Vec<Slot>` (`TESTDATA.ts:38-52`, `orderitem.ts:98-121`)
- Produces, in `dict.rs`:
  - `pub struct Parameter { pub code: String, pub description: String, pub abbreviation: String, pub context: i64, pub units: String, pub reference: String, pub raw: Chars }` (`PARMDICT.ts:38-52`). `context` is -1 when the toolchain reads it as blank.
  - `pub struct Location { pub code: String, pub description: String, pub address: [String; 4] }`, `pub struct Ward { pub description: Option<String> }` (`WARDDICT.ts:62-84`)
  - `pub struct Dictionaries` with:
    - `pub fn from_rows(v: &Value) -> Result<Dictionaries, String>`, reading the sets `parameters`, `comments`, `locations`, `wards`, `panels`, `users`. A missing set is an empty one.
    - `pub fn parameter(&self, code: &str) -> Option<&Parameter>`
    - `pub fn comment(&self, context: i64, code: &str) -> Option<&str>`, the description of the first row for that context and code
    - `pub fn location(&self, code: &str) -> Option<&Location>`
    - `pub fn ward(&self, facility: &str, ward: &str) -> Option<&str>`, trying the facility and then `@@@@@` (`warddict-resolver.ts:34-70`)

Every lookup goes through `sql_key`. `comment` trims spaces from both ends of the stored code, as the toolchain's `LTRIM(RTRIM([CODE]))` does.

- [ ] **Step 1: Write the failing tests.** Build each record with a small helper that places bytes at an offset in a zero-filled buffer.

```rust
// records.rs
#[test] fn registration_reads_fields_at_their_offsets() {
    // 670 bytes; "A0001" at 148, "M" at 420, "LOC01" at 421, "SMITH,,JOHN" at 348, date 13/09/2018 at 126, time 08:15 at 132
    // specimen == "A0001", sex == "M", location == "LOC01", name == "SMITH,,JOHN", registered == Some("09/13/2018 08:15")
}
#[test] fn registration_lists_ordered_panels_and_skips_blank_slots() { /* "HIVVL" at 187, blank at 194, "CD4  " at 201 -> ["HIVVL", "CD4"] */ }
#[test] fn a_short_registration_gives_empty_fields_and_no_panic() { let r = registration(&[1, 2, 3]); assert_eq!(r.specimen, ""); assert!(r.registered.is_none()); assert!(r.ordered_panels.is_empty()); }
#[test] fn dob_age_subtracts_years_days_and_hours_from_the_collected_time() { /* collected 1 March 2020 10:00 (bytes 1, 3, 0xE4, 7 at 159 and 0, 10 at 163), byte 414 = 1 -> "03/01/2019" */ }
#[test] fn slots_are_twelve_bytes_from_byte_eighty() { /* two slots: codes "HIVVQ" and "RJREA", types 1 and 3, frames 2 and 3 */ }
#[test] fn the_last_slot_is_skipped_when_it_ends_exactly_at_the_end() { /* 80 + 24 bytes -> one slot, as the toolchain's strict less-than */ }
#[test] fn a_payload_that_starts_with_a_whitespace_byte_shifts_as_the_toolchain_does() { /* byte 80 is 0x20 then a slot -> the slot's code is read one byte late */ }
#[test] fn a_test_record_of_eighty_bytes_has_no_slots() { assert!(slots(&[0u8; 80]).is_empty()); assert!(slots(&[]).is_empty()); }
#[test] fn text_value_starts_at_sixteen_and_is_empty_for_a_short_record() { assert_eq!(text_value(&[b'x'; 15]), ""); }
#[test] fn audit_reads_code_user_and_data() {}
// dict.rs
#[test] fn a_parameter_is_found_whatever_its_case_or_padding() { /* stored "HIVVQ", asked "hivvq  " */ }
#[test] fn context_nine_to_twelve_reads_as_blank_like_the_toolchain() { /* byte 121 = 10 -> context == -1; byte 121 = 50 -> 50 */ }
#[test] fn a_comment_is_found_by_context_and_trimmed_code() { /* stored (50, " ECOLI ") found by (50, "ecoli") and not by (51, "ECOLI") */ }
#[test] fn the_first_of_two_rows_with_one_key_wins() {}
#[test] fn a_ward_falls_back_to_the_any_facility_row() {}
#[test] fn a_ward_description_comes_from_the_record_when_the_column_is_empty() { /* byte 14 = 5, then "Ward1" */ }
#[test] fn a_missing_set_is_empty() { assert!(Dictionaries::from_rows(&json!({})).unwrap().parameter("X").is_none()); }
```

- [ ] **Step 2: Run** `cargo test` and see them fail.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** `cargo test` and see them pass.
- [ ] **Step 5: Commit** `feat: record parsers and dictionaries`.

### Task 7: One decoded request, with fixtures

**Files:**
- Create: `src/request.rs`, `tests/golden.rs`, `tests/generate-fixtures.mts`, `tests/fixtures/*.json`
- Modify: `src/lib.rs` (export the modules)

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces:
  - `pub struct PageRows<'a>` with `pub fn new(rows: &'a Value) -> PageRows<'a>` and `pub fn of(&self, detail: &str, key: &str) -> Vec<&'a Map<String, Value>>`. `rows` is `{ "registration": [...], "tests": [...], ... }`, the form `import_map` receives. A row belongs to a key when its `__key` gives the same `sql_key`.
  - `pub struct ResultItem { pub code: String, pub type_byte: u32, pub value: ItemValue, pub raw_value: String, pub description: Option<String>, pub resulted: bool }` and `pub enum ItemValue { Text(String), Number(f64), NotANumber }`
  - `pub struct TestRun { pub datestamp: Option<String>, pub test_code: String, pub test_index: f64, pub header: Chars, pub items: Vec<ResultItem> }`
  - `pub struct Request` holding every value of the toolchain's `SpecimenRecpt` (`Forms/specimenrecpt.ts:12-73`) plus `ward_resolved: Option<String>` and `test_runs: Vec<TestRun>`
  - `pub fn decode_request(key: &str, rows: &PageRows, dict: &Dictionaries) -> Result<Request, &'static str>`. The only error is `"NO_REGISTRATION"`.
  - `impl Request { pub fn to_toolchain_json(&self) -> Value }`, the same keys and values as `JSON.stringify` of the toolchain's `SpecimenRecpt`, plus `WardClinicResolved`.

Rules that differ from the trial:

- Audit rows are sorted here: newest `DATESTAMP` first, ties in the order the copy delivered them. The copy delivers them by the table's own key.
- Text rows and test rows are used in the order the copy delivered them.
- A datetime column arrives as text with no zone, such as `2019-01-23T15:42:52.000`. Where the toolchain's JSON shows a `Date`, the value is that text with `Z` added.

- [ ] **Step 1: Write `tests/generate-fixtures.mts`.** It is run by hand from `cdr-toolchain/apps/cli` with `TZ=UTC node --import tsx <cdr-source>/tests/generate-fixtures.mts <connection>`. It:
  1. builds made-up rows for the cases below, with helper functions that place fields at offsets;
  2. creates the databases `DisalabData`, `DisaGlobal` and `DisalabDict` on the scratch server it is given, with the nine tables and the column types listed in the design's section 2, and inserts the rows;
  3. reads each case's rows back with the plugin's own copy statements, with the tokens filled as CE fills them, and turns each row into the form CE hands a plugin (binary as base64, datetime as text with no zone);
  4. runs the toolchain's `REGDAT4.All`, `SpecimenRecpt.Fetch` and `WardDictResolver.resolve` for each case;
  5. writes `tests/fixtures/<case>.json` as `{ "input": { "key", "rows", "dictionaries" }, "expected": <the toolchain's JSON> }`.

  The cases, at least these fifteen: a plain request with one numeric result; a coded result found in the comment dictionary; a coded result whose parameter has context 10; a result with a text row that replaces its value; a date result; a numeric zero that was entered; a request with no test rows; two runs of one panel; a corrected name in the audit rows; two audit rows with one time; a birth row; a taken date that comes from the index; a ward found only under `@@@@@`; codes that differ in case and padding from their dictionary rows; registration dates with day 10 and minute 32.

- [ ] **Step 2: Start a scratch SQL Server** with the memory cap from the Global Constraints, on port 14331, run the generator against it, and remove the container. Expected: one fixture file per case.
- [ ] **Step 3: Write `tests/golden.rs`** after the v1 plugin's: load every fixture, call `decode_request` and `to_toolchain_json`, compare by value (numbers as numbers, key order ignored, array order kept), and assert at least 15 fixtures. Add:

```rust
#[test] fn a_key_with_no_registration_row_is_an_error() { /* rows = {} -> Err("NO_REGISTRATION") */ }
#[test] fn a_request_with_only_a_registration_row_decodes() { /* no tests, texts, audit, births or taken */ }
#[test] fn rows_of_another_key_are_not_used() { /* two keys on one page; each request has only its own runs */ }
```

- [ ] **Step 4: Run** `cargo test` and see the golden tests fail.
- [ ] **Step 5: Implement** `src/request.rs`.
- [ ] **Step 6: Run** `cargo test` and see every test pass.
- [ ] **Step 7: Commit** `feat: one decoded request, checked against the toolchain on made-up rows`.

### Task 8: The real-data check

**Files:**
- Create: `examples/decode_file.rs`, `tools/real-data-check/{dump.mjs,compare.py,README.md}`, `docs/real-data-check.md`

**Interfaces:**
- Consumes: `decode_request`, `Dictionaries::from_rows`, `queries::copy`.
- Produces: a check anyone with a restored DISA database can run.

- `examples/decode_file.rs <dir>` reads `<dir>/dict.json` and `<dir>/raw.ndjson` (one `{ "key", "rows" }` per line) and writes `<dir>/rs.ndjson` (one `{ "key", "request" }` per line, from `to_toolchain_json`). It prints the count and the time taken.
- `examples/decode_file.rs --copy-sql` prints the plugin's copy sets as JSON, so the dump script uses the plugin's own statements.
- `dump.mjs <dir> <sample size>` reads the connection from the environment, samples every n-th lab number, fetches each request's rows and the dictionaries with the plugin's statements, runs the toolchain on the same request, and writes `raw.ndjson`, `ts.ndjson` and `dict.json`. It prints counts only.
- `compare.py <dir>` prints how many requests and fields are identical, and for each field that differs its name, a count and the two value types. Never a value.
- `data/` under the tool is git-ignored.

- [ ] **Step 1: Write the three programs**, starting from the trial's.
- [ ] **Step 2: Try them on made-up data.** Point `dump.mjs` at the scratch server of Task 7 with its made-up rows, run all three, and see every request identical. Remove the container.
- [ ] **Step 3: Commit** `feat: the real-data check`.

The steps below are run by the controller on the restored Tanzania database.

- [ ] **Step 4: Run the check on at least 20,000 requests.** Expected: every request identical. If a field differs, the controller gives the implementer the field name, the count and the value types, and the fix goes back through Task 6 or 7 with a new made-up fixture that shows it.
- [ ] **Step 5: Record the result** in `docs/real-data-check.md`: the date, the source backup's date, the sample size, requests and fields compared, fields that differ, and the two timings. Delete the `data/` folder. Commit `docs: the decoded request matches the toolchain on real requests`.

---

## What this plan does not do

- `import_checks`. See Task 2.
- The payload, FHIR, the audit rules, `source_decode` and the fault fixes. They are steps 3 to 7 of the design and get the next plan.
- A remote for the repository, and a signed bundle in the marketplace. The operator has not said where the repository goes.
- A full copy of the Tanzania database. Task 4 copies enough pages to measure and then deletes the copy.
