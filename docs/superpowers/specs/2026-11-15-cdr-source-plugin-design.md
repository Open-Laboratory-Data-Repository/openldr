# Migration part 2: the cdr-source plugin

Date: 2026-11-15. Status: written for the operator's approval. Nothing is built.

Parent: `docs/superpowers/specs/2026-11-13-disa-and-v1-migration-design.md`. Read its sections
4, 5, 7 and 8 first. This document covers part 2 of that design and nothing else.

## 1. What this is and why

DISA\*Lab keeps each record as a block of bytes in one column. The frozen `cdr-toolchain`
knows how to read those bytes, turn a request into FHIR, and judge it against 18 audit rules.
That knowledge has to move into CE as a plugin, so that the toolchain can be retired.

Part 2 builds that plugin. It is a Rust plugin named `cdr-source`, in its own repository. It
does two jobs:

1. It tells CE which rows to copy from a DISA server. Part 1 built the copy. No plugin that
   copies DISA exists yet, so no site can start.
2. It turns the copied rows of a request into FHIR resources and audit findings.

Part 2 does not compare with v1 (part 3) and does not run the check or save anything
(part 4).

## 2. What was checked first

Checked on 2026-11-15, on the operator's Tanzania backups restored into the local SQL Server.
The DISA backups are from 2019-01-23 and were taken on SQL Server 2008 R2.

| Fact | Result | How |
|---|---|---|
| Type of the record columns | `image`, in every table read | `sys.columns` |
| Does CE hand `image` to a plugin? | Yes, as base64 | `packages/bootstrap/src/import-sql.ts:89` |
| Are the plain columns beside the bytes filled? | No. All empty in 200,000 requests and 200,000 test rows | `REGDAT4`, `TESTDATA` |
| Is a lab number a safe paging key? | Yes. 10 printable characters, unique, in all 2,326,075 requests | unique index `REGDAT4_IDX0` |
| Largest record | 2,060 bytes (`TESTDATA`). The others are fixed: 670, 96 and 66 bytes | full scan of four tables |
| Is `DATESTAMP` a row version? | No. It is `datetime` | `sys.columns` |
| Are dictionary keys unique and printable? | Yes, for all six dictionaries | counts per table |
| Do lab numbers in the other five tables equal the request key exactly? | Yes. No padding and no lower case on any row that belongs to a request | full scan of each |
| Six lookups for a page of 500 requests | About 290 ms in total on this machine | timed once |

Row counts in the Tanzania DISA backup: 2,326,075 requests, 3,778,852 test rows, 13,705,128
text rows, 27,571,017 audit rows.

Two findings change the work.

**The toolchain's lookups are SQL comparisons.** It finds a dictionary entry with
`WHERE [CODE] = '...'`. SQL Server compares that without regard to case and ignores trailing
spaces. A Rust map lookup does neither unless told to. The port must copy those rules.

**The toolchain has a fault that reaches real results.** A result parameter names a group of
coded answers by a number. The toolchain reads that number as text and trims it, so groups 9
to 12 read as blank (`PARMDICT.ts:41`). 64 of the 1,547 parameters use those groups. In a
sample of 2,001 real requests, 329 results in 108 requests kept the raw code where the
dictionary held a description.

### The trial

The operator asked for a throwaway trial on 2026-11-15. It ported the first stage of the
decoder to Rust, about 500 lines, and ran it beside the toolchain on real requests.

- Sample: every 1,163rd request by lab number, 2,001 requests, 3,149 test rows, 43,894
  results.
- Result: all 2,001 requests identical. 441,197 fields compared, none different.
- Time: the toolchain took 386 seconds, with its lookups going to the database. The Rust
  decode took 0.8 seconds, reading the same rows from a file.

A second run the same evening took every 116th request: 20,053 requests, 32,733 test rows
and 453,595 results.

- 20,051 requests identical. 4,526,506 fields compared, 2 different.
- Both differences are the date of birth, in requests that have two rows in the birth index.
  The toolchain reads those rows with no order and took the later date. The trial took the
  earlier. In a third such request both took the same row. So the toolchain's own answer is
  not fixed for these requests. 378 requests in the whole database have two or more birth
  rows.
- Time: the toolchain took 4,887 seconds on a busy machine. The Rust decode took 2.9 seconds.

The trial covers decoding only: the registration record, test records, text rows, audit rows
and three dictionaries. It does not cover the request payload, FHIR, or the audit rules. The
code is discarded. Its method is kept, in section 6.7.

## 3. Goals, non-goals, anti-goals

Goals:

- A site can start copying its DISA database with this plugin and CE as it is on `main`.
- Given the copied rows of a page of requests and the copied dictionaries, the plugin returns
  for each request its FHIR resources, its audit findings, and whether it is held back.
- No lookup leaves the plugin. Everything comes from the copy.
- The output equals the toolchain's for the same rows. That is proven twice: on made-up rows
  kept in the repository, and on sampled real requests on the build machine.
- After that, each known toolchain fault is fixed as its own change, with a test.

Non-goals:

- The compare against v1. Part 3.
- Running the check, saving, the held-back view and the v1-only list. Part 4.
- Record layouts for Zambia and Mozambique. No DISA data from either is on this machine.
- Top-up passes. Part 1 deferred them and the facts above only settle half the question.
- The toolchain's report writers, its `export --type v1` path and its v2 forms path.

Anti-goals, on top of the parent's:

- A real patient row in the repository. Fixtures are made up.
- A decode that differs from the toolchain without a line in the list in section 6.8.
- The name DISA, or any of this code, inside `openldr_ce`.

## 4. Constraints

- A plugin call has 30 seconds and 512 MB, and cannot open a connection.
- CE checks every statement the plugin supplies. Each must be one SELECT.
- The statements must run on SQL Server 2008 R2. The Tanzania backup comes from that
  version, so `OFFSET`, `TRY_CONVERT`, `STRING_AGG` and `TRIM` are all out.
- A paging key is printable ASCII, 200 characters at most.
- `cdr-toolchain` is frozen. The port reads it and does not change it.
- Only Tanzania's layouts are measured. Zambia has no measured offsets and Mozambique has no
  settings file at all.

## 5. Approaches

1. **Port to Rust, module by module, each proven against the toolchain.** The toolchain
   stays the reference until every stage matches. Cost: about 6,800 lines of TypeScript to
   port. The trial showed the first stage ports cleanly.
2. **Run the toolchain's TypeScript inside the plugin, on a JavaScript engine built to
   wasm.** Less porting. But the TypeScript fetches from the database in the middle of
   decoding, so it would need rewriting anyway. A JavaScript engine in a CE plugin is
   untried, and the operator chose Rust on 2026-11-13.
3. **Write a new decoder from the byte layouts and judge it against v1 only.** It drops rules
   the toolchain measured against 176,287 labelled panels, and the v1 compare does not exist
   until part 3.

The operator picked the first on 2026-11-13 and confirmed "port as is, then fix" on
2026-11-15. The rest of this document is that approach.

## 6. The design

### 6.1 Where it lives

A new repository at `/home/fredrick/Projects/Repositories/cdr-source`. The operator named it
on 2026-11-15 and will create the remote.

- One Rust crate, built both as a wasm plugin and as a native library for tests, as
  `wasm/openldr-v1-import` is. Its only dependencies are `serde_json`, and `extism-pdk` on
  wasm.
- `ui/`, the plugin's page. It starts as a copy of the v1 plugin's page.
- `tests/`, the fixtures and the script that makes them.
- `tools/`, the real-data check of section 6.7.
- A manifest and a build script that produce a bundle for the marketplace.

The crate copies `text.rs` from the v1 plugin (JavaScript `trim` and number printing). It
does not depend on `openldr_ce`.

### 6.2 What the plugin offers CE

| Entrypoint | Input | Output | Used by |
|---|---|---|---|
| `import_copy` | `{ options }` | `{ sets }` | The copy, today |
| `import_checks` | `{ options }` | `{ checks }` | Nothing yet. Left out of the first plan, because the copy never calls it and the Copy tab has no step for it |
| `source_decode` | `{ options, now, dictionaries, keys, rows }` | `{ groups }` | The check run of part 4 |

`source_decode` is new. `dictionaries` holds the copied rows of the six dictionary sets, by
set name. `keys` and `rows` are one page of the `requests` set, in the form `import_map`
already receives. `now` is the time as text, so that a test can fix it.

Each group is `{ key, held, findings, resources, error }`.

- `findings` is the list of audit findings, each with a rule name, a severity and the values
  that broke the rule.
- `held` is true when any finding is an error. This is the toolchain's rule.
- `resources` is present only when `held` is false. A held record carries nothing that
  could be saved by mistake.
- `error` is present when the request could not be decoded at all. It is a short code with
  no row value, as in the v1 plugin's groups. Such a group has no resources. The toolchain
  throws in one known case, a request with no ordered panels (`fhir-transform.ts:623`). My
  call: one bad request must not fail its page.

The dictionaries are small enough to send with every call. Tanzania has 1,547 parameters of
2,017 bytes each, 5,619 coded comments, 8,754 locations, 447 panels, 208 wards and 69 users.
The trial read three of them, 6 MB of JSON, in under 60 ms.

The plugin has no `import_queries` and no `import_map`. A one-pass import from DISA would
save records with no check, which the parent design forbids. The manifest allows a plugin
with `copy` alone.

Part 4 decides how the host calls `source_decode` and what the manifest calls it. Part 2
fixes its input and output.

### 6.3 What the copy reads

One set per request, paged by lab number, plus six dictionaries copied whole.

| Set | Key | Rows |
|---|---|---|
| `requests` | `REGDAT4.LabNo` | `REGDAT4`, `TESTDATA`, `TXT1DATA`, `AUDTDATA`, `RDOBIDX4`, `RTKNIDX5` for the page's keys |
| `parameters` | `PARMDICT.CODE` | the table |
| `panels` | `TESTDICT.CODE` | the table |
| `comments` | group number and code, joined | `COMMDICT`, every group |
| `locations` | `LOCNDIC4.CODE` | the table |
| `wards` | both `WARDDICT` codes, joined | the table |
| `users` | `USERDIC6.CODE` | the table |

- Every detail query reads all columns, key first, as the v1 copy does.
- `RTKNIDX5` holds the lab number in `INVOICENO`, padded to 12 characters. Its key column is
  trimmed so that it equals the page's key.
- The three database names are options, defaulting to `DisalabData`, `DisaGlobal` and
  `DisalabDict`. The connector's login must be able to read all three.
- `RDOBIDX4` and `RTKNIDX5` are indexed by date, so finding a page's rows scans them. On
  Tanzania's data that cost 87 ms and 42 ms a page.

My call: copy `AUDTDATA` whole. The decoder uses only the rows that carry a corrected
patient name. But the rule that picks them lives in the record bytes. Filtering at the source
would put a decoder rule into the copy, and a fix would then mean reading DISA again. The
cost is 27.6 million small rows for Tanzania, which I estimate at 7 GB in the copy.

### 6.4 How a request is decoded

Every step is a plain function over copied rows. Each maps to toolchain code.

| Step | What it does | Toolchain source |
|---|---|---|
| Bytes and text | Byte to character, JavaScript trim, control characters, integers, 4-byte floats | `disalab/src/lib/core.ts`, `bitconverter.ts` |
| Dates | The two DISA date forms and two time forms, with JavaScript's date arithmetic | `core.ts` |
| Records | Registration, test header and result slots, text rows, audit rows, six dictionaries | `DisalabData/*.ts`, `DisaGlobal/*.ts`, `orderitem.ts` |
| Lookups | Dictionaries held in memory, matched the way SQL Server matches | the `WHERE` clauses in those files |
| One request | Joins the records into one request, with facility and ward | `Forms/specimenrecpt.ts`, `compare/warddict-resolver.ts` |
| Code book | Parameter, panel, comment and user lookups, and the organism sorter | `export/codebook.ts` |
| Results | Flattens results, keeps the latest run of a panel, finds a rejection | `compare/result-mapping.ts`, part of it |
| Payload | One entry per ordered panel, status, limits, registration facts | `export/v2-transform.ts` and its helpers |
| FHIR | Patient, Specimen, Organization, ServiceRequest, DiagnosticReport, Observation, and the documentation Questionnaire | `ce-fhir/src/fhir-transform.ts`, `export/fhir-documentation-transform.ts` |
| Audit | The 18 rules and the hold-back decision | `audit/detector.ts` and its helpers |

The toolchain looks things up while it decodes, up to three database calls per result. Here
the dictionaries are loaded once per call and the text rows arrive with the page.

Two rules keep the result the same on every run.

- **Dates have no zone.** The toolchain does its date arithmetic in the zone of the machine it
  runs on. The plugin does the same arithmetic on plain calendar fields. The two agree
  wherever the machine's zone has no daylight saving. So the fixture script and the real-data
  check run the toolchain with `TZ=UTC`, as the trial did.
- **Audit rows are sorted by the plugin.** The toolchain asks SQL Server for a request's audit
  rows newest first and takes the first that carries a corrected name. Two rows with the same
  time come back in no fixed order. The plugin sorts newest first and breaks a tie by the
  table's own key. In Tanzania's data 51 requests have such a tie, out of 5,305 with a
  corrected name. If the real-data check shows the toolchain picked the other row, the
  plugin's rule stays and the case goes on the list in section 6.8.

### 6.5 Site settings and code tables

The operator decided on 2026-11-15 that DISA's code tables stay in the plugin's source. That
covers the organism and specimen word lists, the parameter group numbers, and codes such as
the rejection parameters.

A site's measured byte positions are settings of the same kind. The plugin holds one named
profile per site in source, and an option picks it.

| Option | Meaning |
|---|---|
| `site` | The profile. `tanzania` today |
| `labCode`, `labName` | The testing laboratory |
| `tz` | The site's fixed UTC offset |
| `requestIdPrefix` | Text put before the lab number to make the CE request id |
| `dataDb`, `globalDb`, `dictDb` | Database names |

A profile holds everything in the toolchain's `config/tanzania.yaml`: the documentation
panels and their form codes, the byte positions in the test header and the registration
record, the positions of the reporting limits, and the table of section letters. The
toolchain's `config/request-attributes.yaml` is the same for every site, so it sits in the
crate once, outside any profile.

A site with no profile is refused by name. It is not decoded with Tanzania's positions.

My call: no option overrides a single position. A new site means a new profile and a plugin
release, after its positions are measured. No site needs more than that today.

### 6.6 What is in the repository beside code

- A README that covers install, the options and what each audit rule means. The DISA guide
  cannot live in CE's in-app docs or web docs, because CE core must not name DISA.
- The page, in en, fr and pt, checked at 375 by 812. In part 2 it has the copy controls and
  nothing else.

### 6.7 How it is tested

Three layers. Each says what it proves.

1. **Unit tests**, ported with each module from the toolchain's 236 cases where they apply.
2. **Fixtures.** A script runs the real toolchain code over made-up rows and writes the input
   and the expected output. A Rust test compares by value. This is the v1 plugin's method.
   It proves the Rust equals the TypeScript on the cases someone thought of.
3. **The real-data check.** A tool samples requests from a restored DISA database, runs the
   toolchain and the Rust on the same rows, and counts the fields that differ. It prints
   counts and field names, never a value. A stage is finished when the count is zero on at
   least 20,000 requests. This proves the Rust equals the TypeScript on real records, for
   Tanzania only.

The check runs at four stages: the decoded request, the payload, the FHIR resources and the
audit findings.

None of the three proves the output is right. They prove it equals the toolchain. Part 3 is
what compares with v1.

The fixture script needs the toolchain to run against a database, because the toolchain
cannot decode without one. My call: it loads the made-up rows into a scratch SQL Server and
runs the toolchain against that. A pretend database written in JavaScript would have to copy
SQL Server's comparison rules, and a mistake there would be copied into the Rust. The
scratch server gets `--memory 3g` and `MSSQL_MEMORY_LIMIT_MB=2048`.

### 6.8 Faults to fix after the port matches

Each is a claim until it is checked against the code and the real data. The rows marked
confirmed are the only ones that are.

| Fault | State |
|---|---|
| Groups 9 to 12 read as blank, so 64 parameters lose their coded answers | Confirmed in code and on 329 real results |
| A request with two birth rows gets whichever the database returns first | Confirmed on real data: 2 of 3 sampled cases differed between two reads. The plugin takes the earliest date. Which date is right needs v1, in part 3 |
| A request with two taken-date rows has the same unordered read as two birth rows | Claim, from the whole-branch review of the first build. The plugin takes the earliest |
| The organism sorter's word stems match whole words only, so Plasmodium and the like sort as bacteria | Confirmed by running the toolchain's `classify` on 2026-11-15 |
| Printing a very large number strips the zeros of its exponent | Confirmed by reading `result-mapping.ts:178` |
| The status step subtracts 100 from a run number twice, which changes any run number above 200 | Confirmed by reading `review-status.ts:110` and `obr-sets.ts:122`, during the second build |
| A birth date from the birth index reaches the audit as a long date text with no milliseconds | Confirmed: two fixtures depend on it. The plugin reproduces it |
| Four finding messages name the source system or its tables | Confirmed by the whole-branch review of the second build: `audit.rs:173`, `:373`, `:413`, `:424`, copied from the toolchain. They leave the plugin in `findings`, so they must change before part 4 shows a finding |
| A panel code that holds a tab makes the toolchain throw a TypeError | Confirmed by reading `result-mapping.ts:537-543`. The plugin sorts the code and carries on. The fix gives that request an error code |
| Middle name is never set | Claim, from reading `specimenrecpt.ts` |
| Two age decoders read different bytes | Claim |
| The date of birth index is a `datetime` and may be lost as the taken date once was | Claim. The column type is confirmed |
| Keeping one run per panel code can make an earlier order look unresulted | Claim |
| An unknown specimen code is held back as missing | Claim |
| The result bytes are trimmed before they are cut into slots | Claim |

Each fix is one change with its own test, and it changes the real-data count on purpose. The
change records the new count.

### 6.9 Order of work

1. The repository, `import_copy`, `import_checks`, the page and the bundle. Then a copy of
   the restored Tanzania DISA through a scratch CE. After this a site can start copying.
2. Decoding to one request. The trial's ground, built again test-first.
3. Code book, results and payload.
4. FHIR.
5. Audit rules and the hold-back decision.
6. `source_decode`, the real-data check at all four stages, and a measured decode speed.
7. The faults of section 6.8.

### 6.10 Carried from the first build into the next plan

The first plan (steps 1 and 2 above) was built and reviewed on 2026-11-15. Its whole-branch
review left two things for the next plan to do first.

- **Group a page's rows by key once.** The decode finds a request's rows by scanning every
  row of the page, once per request and per table. For a page of 500 requests that is millions
  of row visits. It costs nothing today, because no entrypoint reaches the decode. Fix it
  before `source_decode` is built.
- **Decode rows that CE itself copied.** The fixtures and the real-data check both build rows
  with a hand copy of CE's own row conversion. The two agree on everything seen so far, but no
  row read back out of a CE copy has been decoded. When `source_decode` exists, run the
  real-data check once on rows read out of a copy.

Also not proven: the copy statements on a real SQL Server 2008 R2. They ran on SQL Server
2025 against databases at compatibility level 100.

### 6.11 What the second build leaves

The second plan (steps 3 to 6 above) was built and reviewed on 2026-11-15. Both points of
6.10 are closed. Rows are grouped once per page, and a page of 500 real requests decodes in
under half a second natively. Rows read back out of a CE copy equal the rows read directly
for 3,000 of 3,000 requests, and decode to the same answers.

On 20,000 real requests of the one site, all five stages equal the toolchain with no field
different. The plugin repository's `docs/real-data-check.md` holds the counts.

One change to 6.2. `source_decode` now fails the whole call when `dictionaries` lacks any of
its six sets or `rows` lacks any of its six details. A missing set used to read as empty,
which loosened the audit and still gave plausible FHIR. A set that is present and empty is
accepted.

Left for later plans:

- **Step 7, the faults of 6.8.** Start with the four finding messages that name the source
  system. They must change before part 4 puts a finding on a screen.
- **The sandbox.** Nothing calls the wasm export `source_decode` yet. Its speed inside CE is
  not measured. Part 4 adds the caller.
- **Text outside printable ASCII.** The plugin's ordering matches Node for printable ASCII
  and differs beyond it. That changes the order of some findings and result ids. Before a
  second site, check that every panel code in its dictionaries and test rows is printable
  ASCII.
- **Smaller items from the whole-branch review**, none of which changes an answer today: the
  real-data tool can overwrite a copy's rows if given the wrong folder, `compare.py` ignores a
  repeated key, number printing does more work than it needs, five tests the entrypoint lacks,
  and helper functions copied between files.
- **`tests/data/classify-golden.json`** holds 659 organism descriptions from one site's
  dictionary, copied from the toolchain's own fixture. It holds no patient data. The operator
  decides whether it stays.

Found in CE itself during the real runs, and not fixed:

- A plugin reinstalled at the same version is not picked up by a running server's copy until
  the server restarts.
- Deleting a copy removes about 1,550 rows a second. A full copy of the one site would take
  about nine hours to delete.

## 7. What is left to the builder

- Module and file names inside the crate.
- How lookups copy SQL Server's comparison, beyond case and trailing spaces.
- The join character in the two joined dictionary keys.
- The exact shape of a finding, as long as it carries the rule, the severity and the values.
- How the bundle is signed and published. Follow what the marketplace repository does for
  the plugins already there.
- Whether the fixture script uses a scratch server or another way to run the toolchain.

## 8. Open questions

For the operator:

1. **The remote.** The repository starts local. Where does it go, and is it private?
2. **Zambia and Mozambique data.** The plugin will refuse both sites until someone measures
   their record layouts. That needs a DISA backup from each.
3. **v1 for part 3.** The May 2020 v1 backup is damaged at about 10%. The January 2019 one
   is restored. It was taken 27 minutes after the DISA backup, so it is the better pair.

Unknown, and not settled by this design:

- Whether Tanzania's positions hold for every lab in Tanzania. The sample was spread across
  the whole table and matched, but it matched the toolchain, not v1.
- How much disk a full DISA copy takes in CE. The first copy in step 1 will show it.
